import { Router, Request, Response } from 'express';
import { hasContinuousText, restoreContinuousSource } from '../../../shared/report-continuous-text';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { validSourceReviews } from '../../../shared/report-source-review.ts';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compileTypst } from '../services/typst-compiler.js';
import { RenderBusyError } from '../services/render-queue.js';
import { execute, topologicalOrder } from '../../../shared/formula-engine.js';
import { renderReportTypst, type ReportRenderContext } from '../../../shared/report-blocks.js';
import {
  flattenMatrixValuesToFlatData,
  applyMatrixCellFormulas,
  applyMatrixSummaryFormulas,
} from '../../../shared/matrix-flatten.ts';
import {
  generateTypst,
  injectReportFieldsIntoTypst,
  resolveBinding,
  flattenDataForDisplay,
  renderContentDoc,
  diffContentDocValues,
  type ReportRenderCtx,
} from '../../../shared/typst-generator.js';
import type { ReportBlock, RecordTemplate, FieldDefinition, ReportContentDoc, ReportMeta } from '../../../shared/types.js';
import { resolveReportMeta } from '../services/external-report-meta.js';
import { headerFooterConfig, integrationsProfile } from '../../../config/index.js';
import { reportImageKeys, pickReportImageData } from '../../../shared/report-image-state';
import { extractRecordConclusion } from '../../../shared/record-conclusion.js';
import { findRecordHeaderChanges } from '../../../shared/record-header-changes.ts';

import { pool } from '../db.js';
import { assertEditLease } from '../services/collaboration.js';

const router = Router();

/** 读操作者：优先 X-Demo-User（URL 编码的 UTF-8），回退 x-user。生产接 SSO 时改这里。 */
function reportActor(req: Request): string | null {
  const raw = (req.header('X-Demo-User') || (req.headers['x-user'] as string) || '').trim();
  if (!raw) return null;
  try { return decodeURIComponent(raw); } catch { return raw; }
}

async function writeReportAudit(reportId: number, action: 'generate' | 'edit', actor: string | null, diff: any[], note?: string) {
  await pool.query(
    `INSERT INTO report_audit_log (report_id, action, actor_name, diff, note) VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [reportId, action, actor, JSON.stringify(diff || []), note || null]
  );
}

const jsonClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

/** 图片数据不应因“编辑其它字段”或前端旧快照漏字段而被覆盖丢失。
 * 只补齐新文档中缺失的图片键；空数组代表用户明确删除，必须保留为空。
 */
function preserveImageState(previous: any, incoming: any): any {
  const next = jsonClone(incoming);
  const mergeSection = (oldSection: any, newSection: any) => {
    if (!oldSection || !newSection) return;
    const oldRaw = oldSection.ctx?.record_raw_data || {};
    const newRaw = newSection.ctx?.record_raw_data || (newSection.ctx = { ...(newSection.ctx || {}), record_raw_data: {} }).record_raw_data;
    const keys = new Set([...reportImageKeys(oldSection), ...reportImageKeys(newSection)]);
    Object.keys(oldRaw).filter(key => key.startsWith('__image_collection__::')).forEach(key => keys.add(key));
    for (const key of keys) if (!(key in newRaw) && key in oldRaw) newRaw[key] = jsonClone(oldRaw[key]);

    const oldFields = new Map<string, any>();
    for (const group of oldSection.groups || []) for (const field of group.fields || []) {
      if (['image', 'report_photo_table', 'report_image_gallery'].includes(field?.type)) oldFields.set(field.id || field.code, field);
    }
    for (const group of newSection.groups || []) for (const field of group.fields || []) {
      const old = oldFields.get(field?.id || field?.code);
      if (!old || !['image', 'report_photo_table', 'report_image_gallery'].includes(field?.type)) continue;
      if (field.image_photos === undefined && old.image_photos !== undefined) field.image_photos = jsonClone(old.image_photos);
      if (field.image_items === undefined && old.image_items !== undefined) field.image_items = jsonClone(old.image_items);
      if (field.photo_table === undefined && old.photo_table !== undefined) field.photo_table = jsonClone(old.photo_table);
      if (field.image_gallery === undefined && old.image_gallery !== undefined) field.image_gallery = jsonClone(old.image_gallery);
    }
  };
  mergeSection(previous?.cover, next?.cover);
  const oldProjects = previous?.projects || [];
  for (let i = 0; i < (next?.projects || []).length; i++) {
    const project = next.projects[i];
    const old = oldProjects.find((p: any) => p.record_data_id && p.record_data_id === project.record_data_id) || oldProjects[i];
    mergeSection(old, project);
  }
  return next;
}

/** 从首页草稿中取图片字段的 ctx 快照，不能覆盖各报告独立的样品/检测数据。 */
function pickCoverImageRawData(cover: any): Record<string, any> {
  return pickReportImageData(cover);
}

router.post('/generate', async (req: Request, res: Response) => {
  const { report_template_id, record_data_ids } = req.body;

  if (!report_template_id) {
    res.status(400).json({ error: 'report_template_id is required' });
    return;
  }

  try {
    // 1. Get report template
    const tplResult = await pool.query(
      `SELECT t.*, cv.typst_source, cv.field_definitions, cv.layout_options
       FROM report_templates t LEFT JOIN report_template_versions cv ON cv.id = t.current_version_id
       WHERE t.id = $1`, [report_template_id]
    );
    if (tplResult.rows.length === 0) {
      res.status(404).json({ error: 'Report template not found' });
      return;
    }
    const template = tplResult.rows[0];

    // 2. Get mappings
    const mapResult = await pool.query(
      'SELECT * FROM report_template_mappings WHERE report_template_id = $1',
      [report_template_id]
    );
    const mappings = mapResult.rows;

    // 3. Get record data (merge all specified records)
    let allData: Record<string, any> = {};
    if (record_data_ids && record_data_ids.length > 0) {
      const rdResult = await pool.query(
        'SELECT raw_data, derived_data FROM record_data WHERE id = ANY($1)',
        [record_data_ids]
      );
      for (const row of rdResult.rows) {
        Object.assign(allData, row.raw_data || {}, row.derived_data || {});
      }
    }

    // 4. Resolve mappings
    const resolvedData: Record<string, any> = {};
    for (const m of mappings) {
      switch (m.source_type) {
        case 'record_data':
          resolvedData[m.placeholder] = allData[m.source_field_code] ?? null;
          break;
        case 'literal':
          resolvedData[m.placeholder] = m.literal_value;
          break;
        case 'system':
          if (m.source_field_code === 'current_date') resolvedData[m.placeholder] = new Date().toISOString().split('T')[0];
          break;
        case 'computed':
          if (m.formula) {
            resolvedData[m.placeholder] = execute(m.formula, { ...allData, ...resolvedData });
          }
          break;
      }
    }

    // 5. Inject data into Typst source
    let typstSource = template.typst_source;
    for (const [key, value] of Object.entries(resolvedData)) {
      if (value !== null && value !== undefined) {
        const typstVal = typeof value === 'number' ? String(value) : `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        typstSource = typstSource.replace(new RegExp(`${key}:\\s*none`, 'g'), `${key}: ${typstVal}`);
      }
    }

    // 6. Compile
    const result = await compileTypst(typstSource);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="report-${report_template_id}.pdf"`,
      'X-Compile-Duration-Ms': String(result.duration_ms),
    });
    res.send(result.pdf);
  } catch (err: any) {
    res.status(500).json({ error: 'Report generation failed', detail: err.message });
  }
});

router.get('/preview/:reportTemplateId', async (req: Request, res: Response) => {
  const { reportTemplateId } = req.params;

  try {
    const tplResult = await pool.query(
      `SELECT cv.typst_source FROM report_templates t
       LEFT JOIN report_template_versions cv ON cv.id = t.current_version_id
       WHERE t.id = $1`, [reportTemplateId]
    );
    if (tplResult.rows.length === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const result = await compileTypst(tplResult.rows[0].typst_source);
    res.set({ 'Content-Type': 'application/pdf' });
    res.send(result.pdf);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 按委托单号生成报告（新流程）
 *
 * Body:
 *  - order_no: string                — 委托单号
 *  - cover_template_id: number       — 首页模板 id
 *  - project_assignments: { record_data_id, project_template_id, enabled?, title?, page_break? }[]
 *      手动指定每条记录用哪个项目模板渲染；可选 overrides：
 *        enabled (默认 true) / title (可选的单次项目章节标题覆盖，默认取委托单项目名) / page_break (默认 true)
 *  - mock_context?: { customer_name, sample_name, received_at }  — 演示阶段的伪委托单信息
 *
 * 返回: { report_id, warnings, pdf_url }
 */
/**
 * 把外部回传的 ReportMeta + 报告模板版式开关合成首页主题的 header_footer 配置。
 * 值来自外部（接口⑦），版式（是否显示页码等）来自报告模板 layout_options.header_footer。
 */
export function buildHeaderFooterConfig(meta: ReportMeta, layout?: Record<string, any>): Record<string, any> {
  // 版式优先级：报告模板自配（layout）> config/header-footer.json 默认（settings）> 主题硬编码默认。
  // 这样新服务器即使数据库没模板配置，也用配置文件的默认（含 header_rule 分割线开关），不再回退主题默认而"乱"。
  const fileDefaults = (headerFooterConfig.apply_to?.cover === false)
    ? {}
    : (headerFooterConfig.settings || {});
  const L: Record<string, any> = { ...fileDefaults, ...(layout || {}) };
  // 注：_键说明 等下划线前缀键是文件里的注释，序列化时主题不认、无副作用；此处只挑已知键透传，自然忽略它们。
  return {
    // 版式（开关 + 页眉标题字号/字距/分隔线）来自模板或配置文件默认
    enabled: L.enabled !== false,
    show_page_number: L.show_page_number !== false,
    title: L.title || '检测报告',   // 页眉居中标题（对齐报告 .doc）
    // 透传版式细调键（缺省由主题取默认，向后兼容）
    ...(L.title_size !== undefined ? { title_size: L.title_size } : {}),
    ...(L.title_size_first !== undefined ? { title_size_first: L.title_size_first } : {}),
    ...(L.title_tracking !== undefined ? { title_tracking: L.title_tracking } : {}),
    ...(L.header_rule !== undefined ? { header_rule: L.header_rule } : {}),
    ...(L.footer_rule !== undefined ? { footer_rule: L.footer_rule } : {}),   // 页脚分割线开关（缺省回退 header_rule）
    // 页眉页脚几何（页眉页脚编辑器「版式微调」）：页面高度/上下边距/间距/行距，透传到生成期
    ...(L.page_height !== undefined ? { page_height: L.page_height } : {}),
    ...(L.top_margin !== undefined ? { top_margin: L.top_margin } : {}),
    ...(L.bottom_margin !== undefined ? { bottom_margin: L.bottom_margin } : {}),
    ...(L.hf_line_gap !== undefined ? { hf_line_gap: L.hf_line_gap } : {}),
    ...(L.header_gap !== undefined ? { header_gap: L.header_gap } : {}),
    ...(L.footer_gap !== undefined ? { footer_gap: L.footer_gap } : {}),
    ...(L.header_leading !== undefined ? { header_leading: L.header_leading } : {}),
    ...(L.footer_leading !== undefined ? { footer_leading: L.footer_leading } : {}),
    ...(L.title_gap !== undefined ? { title_gap: L.title_gap } : {}),
    ...(L.title_dx !== undefined ? { title_dx: L.title_dx } : {}),
    ...(L.title_align !== undefined ? { title_align: L.title_align } : {}),
    ...(L.font !== undefined ? { font: L.font } : {}),
    // 值来自外部接口⑦（ReportMeta）
    company_name: meta.company_name,
    report_no: meta.report_no,
    cover_report_no: meta.cover_report_no,
    verify_code: meta.verify_code,
    issue_date: meta.issue_date,
    company_address: meta.company_address,
    phone: meta.phone,
    fax: meta.fax,
    website: meta.website,         // 页脚联系行末尾「网址：…」（对齐封面 .doc）
    qualification_note: meta.qualification_note,
    report_note: meta.report_note,
  };
}

export async function buildReportTypst(params: {
  order_no: string;
  cover_template_id: number;
  cover_page_template_id?: number | null;   // 可选·真封面（P3）
  project_assignments: any[];
  mock_context: any;
  /** 可选·每报告页眉页脚元数据（接口 1.2 取号）。server 仅使用此值；demo 缺省时使用示例值。 */
  report_meta?: ReportMeta | null;
  /** 可选·首页结构覆盖（order 级首页草稿 content_doc.cover.groups）。提供则用它替换首页模板的 field_definitions，
   *  让取号前的首页编辑（结构/样式/手改的字面量）carry 到本报告；binding/结论表仍按本报告 scope 重解析。 */
  cover_groups_override?: any[] | null;
  /** 可选·本报告编号（接口 1.2 取号）自带的样品清单（requisition.scope.samples）。提供则首页样品清单/样品信息表
   *  【直接用它】，不再经 work_orders.payload 回查/按 assignment 收敛——避免整单其它样品混入或"单样品却出表"。 */
  report_samples?: Array<{ no: string; name: string; sort_no?: string; model?: string; barcode?: string; id?: string }> | null;
  /** 接口 1.2 当前报告范围的完整 SampleList，用于采用取号时更新的材料分单日期。 */
  report_scope_samples?: any[] | null;
  /** 可选·首页草稿（编辑首页）用：首页样品清单/样品信息表【列整单全部样品】（work_orders.payload 全量），
   *  不按 assignment 收敛——因为草稿是【订单级】预览，应显示订单对应的所有样品，而非只审核通过的那几个。 */
  keep_all_order_samples?: boolean;
  /** 可选·取号前（编辑首页草稿）：样品信息表 / 检测结论表出灰字占位而非填数据——取号后各报告按自己 SampleList 生成。 */
  blank_scope?: boolean;
  /** 可选·首页草稿里【文员直接上传】的原样照片（存于 content_doc.cover.ctx.record_raw_data，按字段 code 键）。
   *  首页 image 分区照片写在 ctx 而非 groups，不随 cover_groups_override 走——须单独 carry 到报告首页 ctx，
   *  否则套用/生成后首页原样照片会丢（显示空）。 */
  cover_ctx_photos?: Record<string, any[]> | null;
}): Promise<{
  finalTypst: string;
  contentDoc: ReportContentDoc | null;
  warnings: any[];
  coverTpl: any;
  projects: any[];
  projectSummary: any[];
  equipmentRows: any[];
  assignmentTplIds: number[];
  assignmentRecIds: number[];
}> {
  const { order_no, cover_template_id, cover_page_template_id, project_assignments, mock_context, report_meta, cover_groups_override, report_samples, report_scope_samples, keep_all_order_samples, blank_scope, cover_ctx_photos } = params;
  const warnings: any[] = [];

  // 过滤掉 enabled === false 的项目
  const activeAssignments = project_assignments.filter((a: any) => a.enabled !== false);

  // 载入委托单接口字段（订单级 meta + 样品/材料分单字段），供报告映射 binding(source=order/sample/test) 拉取。
  // 来源：work_orders.payload（接口 PushOrderInfos 1.1 → external.ts/seed 入库）。
  const orderMeta: Record<string, any> = {};
  const methodOrderByTest = new Map<string, { order: number; methods: number[] }>();
  const sampleInfoById = new Map<string, Record<string, any>>();
  const sampleInfoByName = new Map<string, Record<string, any>>();
  const testInfoByKey = new Map<string, Record<string, any>>(); // key = `${sample_external_id}||${test_item_name}`
  let orderPayloadSamples: any[] = [];
  const orderSamples: Array<{ no: string; name: string; sort_no?: string; model?: string; barcode?: string; id?: string }> = []; // 样品清单 + 首页样品信息表（id 仅内部用于按 scope 过滤，不影响渲染）
  try {
    const wo = await pool.query('SELECT payload FROM work_orders WHERE order_no = $1', [order_no]);
    const payload = wo.rows[0]?.payload || {};
    Object.assign(orderMeta, payload.meta || {});
    orderPayloadSamples = Array.isArray(payload.samples) ? payload.samples : [];
    orderPayloadSamples.forEach((smp: any, i: number) => {
      orderSamples.push({
        no: String(smp.sort_no ?? i + 1), name: smp.name ?? '',
        sort_no: smp.sort_no != null ? String(smp.sort_no) : '', model: smp.model ?? '', barcode: smp.barcode ?? '',
        id: smp.id != null ? String(smp.id) : undefined,
      });
    });
    for (const smp of orderPayloadSamples) {
      const sInfo = { sample_name: smp.name, barcode: smp.barcode, sort_no: smp.sort_no, model: smp.model };
      if (smp.id) sampleInfoById.set(smp.id, sInfo);
      if (smp.name) sampleInfoByName.set(smp.name, sInfo);
      for (const t of (smp.test_infos || [])) {
        methodOrderByTest.set(`${smp.id}||${t.name}`, { order: methodOrderByTest.size,
          methods: (t.linked_template_ids || (t.linked_template_id ? [t.linked_template_id] : [])).map(Number) });
        testInfoByKey.set(`${smp.id}||${t.name}`, {
          project_name: t.name, standard: t.standard, main_engine_factory: t.main_engine_factory,
          test_method: t.test_method, test_condition: t.test_condition, sampling_mode: t.sampling_mode,
          sampling_requirement: t.sampling_requirement, limit_name: t.limit_name, limit_content: t.limit_content,
          leader: t.leader, start_date: t.start_date, end_date: t.end_date,
          sample_description: t.sample_description, test_remark: t.test_remark,
          material_uploader: t.material_uploader, remark: t.remark,
        });
      }
    }
    // 检测周期（首页·订单级派生）：跨全单材料分单取 最早 StartDate ~ 最晚 EndDate（日期为 YYYY-MM-DD，字典序即时序）。
    // 缺一侧只显另一侧；两端相同折成单值；都缺则空（binding 落占位）。供 binding source='order' key='test_period'/'test_start'/'test_end'。
    const starts: string[] = [], ends: string[] = [];
    for (const smp of orderPayloadSamples) {
      for (const t of (smp.test_infos || [])) {
        if (t.start_date) starts.push(String(t.start_date));
        if (t.end_date) ends.push(String(t.end_date));
      }
    }
    const minStart = starts.length ? starts.slice().sort()[0] : '';
    const maxEnd = ends.length ? ends.slice().sort().slice(-1)[0] : '';
    orderMeta.test_start = minStart;
    orderMeta.test_end = maxEnd;
    orderMeta.test_period = minStart && maxEnd
      ? (minStart === maxEnd ? minStart : `${minStart} ~ ${maxEnd}`)
      : (minStart || maxEnd || '');
  } catch { /* 委托单缺失不阻断报告生成（binding 取不到落到占位） */ }

  // base 表已不存 field_definitions / typst_source / layout_options（migration 017）
  // 全部从版本表读取，保留原字段名以减少下游改动
  const covRes = await pool.query(
    `SELECT t.*, cv.field_definitions, cv.typst_source, cv.layout_options
     FROM report_templates t
     LEFT JOIN report_template_versions cv ON cv.id = t.current_version_id
     WHERE t.id = $1 AND t.template_kind = $2`,
    [cover_template_id, 'cover']
  );
  if (!covRes.rows.length) throw new Error('首页模板不存在');
  const coverTpl = covRes.rows[0];

  // 首页草稿 carry-over：用 order 级首页草稿的已编辑 groups 替换首页结构（含字段增删/样式/手改字面量）。
  // ctx 仍按本报告 scope 现算（见下方 coverCtx），所以 binding 与结论汇总表会按本报告样品/项目重解析。
  if (Array.isArray(cover_groups_override) && cover_groups_override.length) {
    if (hasContinuousText({ cover: { groups: cover_groups_override } })) {
      throw new Error('生成新报告不能复用已固定的连续正文，请使用保留字段绑定的首页草稿。');
    }
    coverTpl.field_definitions = cover_groups_override;
  }

  // 报告页眉页脚：server 完全使用接口 1.2 数据；demo 才使用示例数据，注入首页主题 config。
  // 整篇报告 cover+projects 共用首页那一个 set page，所以页眉页脚在 cover 设一次即覆盖全文。
  // 注入到 coverTpl.layout_options 后会随 content_doc 一起快照、重渲染走同一份，保证一致（合规留痕）。
  // 报告接口（1.2）页眉页脚/抬头元数据：注入页眉页脚【且】作为 binding source='report_meta' 供封面/首页正文引用。
  let reportMetaResolved: ReportMeta | null = null;
  try {
    const resolved = await resolveReportMeta(order_no, report_meta);
    if (integrationsProfile === 'server' && !report_meta) {
      warnings.push({
        type: 'report_meta_missing',
        detail: 'server 模式未收到报告信息接口数据，页眉页脚不会使用示例值',
      });
    } else if (integrationsProfile === 'server' && !String(resolved.qualification_note || '').trim()) {
      warnings.push({
        type: 'qualification_note_missing',
        detail: '报告信息接口未提供资质备注 QualificationRemark，正式报告资质将留空',
      });
    }
    reportMetaResolved = resolved;
    // 页眉页脚由系统统一写死（config/header-footer.json），不再读模板里的用户自配版式：
    // 编辑器已移除"调整页眉页脚"功能，这里也忽略历史模板里残留的 header_footer 覆盖键。
    coverTpl.layout_options = {
      ...(coverTpl.layout_options || {}),
      header_footer: buildHeaderFooterConfig(resolved),
    };
  } catch (e: any) {
    warnings.push({ type: 'report_meta_failed', detail: e?.message || String(e) });
  }
  const reportMetaCtx = reportMetaResolved || undefined;

  // 可选·真封面模板（P3）：标题页，渲染在最前。按 id 取当前版本 groups。
  let coverPageTpl: any = null;
  if (cover_page_template_id) {
    const cpRes = await pool.query(
      `SELECT t.name, cv.field_definitions, cv.layout_options
         FROM report_templates t LEFT JOIN report_template_versions cv ON cv.id = t.current_version_id
        WHERE t.id = $1`,
      [cover_page_template_id]
    );
    if (cpRes.rows.length && Array.isArray(cpRes.rows[0].field_definitions) && cpRes.rows[0].field_definitions.length) {
      coverPageTpl = cpRes.rows[0];
    } else {
      warnings.push({ type: 'cover_page_missing', detail: `封面模板 ${cover_page_template_id} 不存在或无内容` });
    }
  }

  const useGroupsModel = Array.isArray(coverTpl.field_definitions) && coverTpl.field_definitions.length > 0;

  const assignmentTplIds = activeAssignments.map((a: any) => a.project_template_id).filter(Boolean);
  const assignmentRecIds = activeAssignments.map((a: any) => a.record_data_id).filter(Boolean);

  const projTplMap = new Map<number, any>();
  if (assignmentTplIds.length) {
    const r = await pool.query(
      `SELECT t.*, cv.field_definitions, cv.typst_source, cv.layout_options
       FROM report_templates t
       LEFT JOIN report_template_versions cv ON cv.id = t.current_version_id
       WHERE t.id = ANY($1) AND t.template_kind = $2`,
      [assignmentTplIds, 'project']
    );
    for (const row of r.rows) projTplMap.set(row.id, row);
  }

  const recMap = new Map<number, any>();
  const tplMap = new Map<number, any>();
  if (assignmentRecIds.length) {
    const r = await pool.query(
      `SELECT r.*, b.shared_data AS batch_shared_data
         FROM record_data r LEFT JOIN record_batches b ON b.id=r.record_batch_id
        WHERE r.id = ANY($1)`, [assignmentRecIds]);
    for (const row of r.rows) recMap.set(row.id, row);
    // 关键：渲染时按 record_data.template_version_id 锁定的快照，
    // 而不是模板当前最新版本——保证历史数据可重现（P0 #2）
    const versionIds = Array.from(new Set(r.rows.map(x => x.template_version_id).filter(Boolean)));
    const fallbackTplIds = Array.from(new Set(
      r.rows.filter(x => !x.template_version_id).map(x => x.template_id)
    ));
    if (versionIds.length) {
      const v = await pool.query(
        `SELECT t.id, t.name, t.version, t.source_file, t.parent_template_id, t.current_version_id,
                v.id AS version_id, v.field_definitions, v.layout_options, v.typst_source, v.version_no
         FROM record_template_versions v
         JOIN record_templates t ON t.id = v.template_id
         WHERE v.id = ANY($1)`,
        [versionIds]
      );
      // 用 version_id 作为 key 的辅助 map，让下面按 record_data 找模板内容时直接命中锁定版本
      for (const row of v.rows) tplMap.set(`v:${row.version_id}` as any, row);
    }
    if (fallbackTplIds.length) {
      // 兼容老数据（template_version_id 为 NULL）：fallback 到当前生效版本
      const t = await pool.query(
        `SELECT t.*, cv.field_definitions, cv.layout_options, cv.typst_source
         FROM record_templates t
         LEFT JOIN record_template_versions cv ON cv.id = t.current_version_id
         WHERE t.id = ANY($1)`,
        [fallbackTplIds]
      );
      for (const row of t.rows) tplMap.set(row.id, row);
    }
  }

  // 正式报告按本报告实际选中的样品/项目计算检测周期。接口 1.2 的同名任务优先于
  // 较早入库的 1.1 值，因为取号时 StartDate/EndDate 可能已经补齐。
  if (activeAssignments.length && recMap.size) {
    const scopeSamples = Array.isArray(report_scope_samples) ? report_scope_samples : [];
    const chosen: Array<{ start_date?: string; end_date?: string }> = [];
    const findSample = (samples: any[], record: any) => samples.find((sample: any) =>
      [sample?.id, sample?.name, sample?.barcode, sample?.sort_no]
        .some(value => value != null && String(value) === String(record?.sample_external_id)));
    for (const assignment of activeAssignments) {
      const record = recMap.get(assignment.record_data_id);
      if (!record) continue;
      const fromScope = findSample(scopeSamples, record)?.test_infos?.find((test: any) => test?.name === record.test_item_name);
      const fromOrder = findSample(orderPayloadSamples, record)?.test_infos?.find((test: any) => test?.name === record.test_item_name);
      chosen.push({
        start_date: fromScope?.start_date || fromOrder?.start_date,
        end_date: fromScope?.end_date || fromOrder?.end_date,
      });
    }
    const starts = chosen.map(test => test.start_date).filter(Boolean).map(String).sort();
    const ends = chosen.map(test => test.end_date).filter(Boolean).map(String).sort();
    const minStart = starts[0] || '';
    const maxEnd = ends.length ? ends[ends.length - 1] : '';
    orderMeta.test_start = minStart;
    orderMeta.test_end = maxEnd;
    orderMeta.test_period = minStart && maxEnd
      ? (minStart === maxEnd ? minStart : `${minStart} ~ ${maxEnd}`)
      : (minStart || maxEnd || '');
  }

  const coverNeedsTestPeriod = (coverTpl.field_definitions || []).some((group: any) =>
    (group.fields || []).some((field: any) => field.type === 'daterange'
      && [field.date_range?.start?.key, field.date_range?.end?.key]
        .some((key: any) => key === 'test_start' || key === 'test_end')));
  if (coverNeedsTestPeriod && !orderMeta.test_start && !orderMeta.test_end) {
    warnings.push({
      type: 'test_period_missing',
      detail: '接口 1.1/1.2 的材料分单未提供 StartDate 和 EndDate，首页“检测周期”已留空',
    });
  }

  // 首页样品清单/样品信息表 = **本报告 scope 内的样品**（即各 assignment 原始记录的 sample_external_id，
  // 去重保序）。样品明细从委托单 payload.samples 按【多键】(id/名称/条码/序号) 回查；查不到则用该
  // sample_external_id 兜底成一行——【绝不】退化成"列出整单全部样品"或混入 scope 外的其它样品。
  //   · 拆报告（按样品/项目/取号）：order_samples 精确＝本报告样品，不会冒出别的样品；
  //   · 整单一份 / cover 草稿（含全部审核通过记录）：scope 自然＝全部样品，列全；
  //   · 用户在「调整样品/项目」改 scope → assignments 变 → 本表随之增减（与检测结论表同源同口径）。
  // sample_external_id 与委托单样品的对应在不同接入方可能落在不同字段，故多键匹配（接口 1.1/1.2 样品身份一致）。
  {
    const matchSample = (key: string) => orderSamples.find(s =>
      [s.id, s.name, s.barcode, s.sort_no, s.no].some(v => v != null && String(v).trim() === key));
    const seen = new Set<string>();
    const scoped: typeof orderSamples = [];
    for (const a of activeAssignments) {
      const sid = recMap.get(a.record_data_id)?.sample_external_id;
      const key = sid == null ? '' : String(sid).trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const m = matchSample(key);
      scoped.push(m || { no: key, name: key, sort_no: '', model: '', barcode: '', id: key });
    }
    // 有 scope 才收敛；无 assignment（如纯 cover 预览）保持原 payload 全量，避免清空。
    // keep_all_order_samples（编辑首页草稿·订单级）：跳过收敛，样品信息表列整单全部样品。
    if (scoped.length && !keep_all_order_samples) { orderSamples.length = 0; orderSamples.push(...scoped); }
  }

  // 取号路径：首页样品清单/样品信息表【直接用本报告编号（接口 1.2）自带的样品】，覆盖上面从 work_orders.payload
  // 回查/收敛的结果——回应"样品信息就是直接从对应的报告编号接口的样品抓取"。这样样品数量/名称/零件号严格等于该
  // 报告编号推送的 SampleList：单样品→样品信息表自动折叠（renderSampleTableTypst mode='auto' 且 ≤1 返回空），
  // 多样品才出表；不会再混入整单里别的样品或数量对不上。仅取号自动生成时传入；手动/整单生成不传，保持原 payload 逻辑。
  if (Array.isArray(report_samples) && report_samples.length) {
    orderSamples.length = 0;
    orderSamples.push(...report_samples);
  }
  // 取号前（编辑首页草稿）：清空样品清单——样品信息表/检测结论表已由 blank_scope 出占位，
  // 顺带让 order_samples 绑定（样品清单）也为空，避免整单样品在取号前泄漏到首页。
  if (blank_scope) orderSamples.length = 0;

  let projects: any[] = [];
  const projectSummary: any[] = [];
  // P-Map-7：每项目先收一条原始记录（含 sample_no + 子结论列表），循环后按样品分组排序、跑 index 再展平成 projectSummary。
  const projectRecords: Array<{ sample_no?: string; sample_name: string; name: string; standard: string; conclusions: Array<{ sub_name?: string; value: string; judgment_requirement?: string }> }> = [];
  const allDeviceCodes: Set<string> = new Set();

  const methodRank = (assignment: any): [number, number] => {
    const record = recMap.get(assignment.record_data_id);
    const entry = methodOrderByTest.get(`${record?.sample_external_id}||${record?.test_item_name}`);
    const methodIndex = entry?.methods.indexOf(Number(record?.template_id)) ?? -1;
    return [entry?.order ?? Number.MAX_SAFE_INTEGER, methodIndex < 0 ? Number.MAX_SAFE_INTEGER : methodIndex];
  };
  activeAssignments.sort((a: any, b: any) => {
    const ar = methodRank(a), br = methodRank(b);
    return ar[0] - br[0] || ar[1] - br[1];
  });
  for (const a of activeAssignments) {
    const projTpl = projTplMap.get(a.project_template_id);
    const recData = recMap.get(a.record_data_id);
    if (!projTpl) {
      warnings.push({ type: 'project_template_missing', record_data_id: a.record_data_id });
      continue;
    }
    if (!recData) {
      warnings.push({ type: 'record_missing', project_template_id: a.project_template_id });
      continue;
    }
    if (recData.cancelled_at) {
      warnings.push({ type: 'record_method_cancelled', record_data_id: a.record_data_id });
      continue;
    }
    if (projTpl.linked_record_template_id != null
        && Number(projTpl.linked_record_template_id) !== Number(recData.template_id)) {
      throw new Error(
        `项目模板 ${projTpl.name || projTpl.id} 未关联原始记录模板 ${recData.template_id}，已阻止错误数据拉取`,
      );
    }
    if (a.project_template_version_id != null
        && Number(projTpl.current_version_id) !== Number(a.project_template_version_id)) {
      throw new Error(
        `项目模板 ${projTpl.name || projTpl.id} 的生效版本已变化，请刷新候选后重新确认`,
      );
    }

    // 优先用 record_data.template_version_id 锁定的版本快照渲染（P0 #2）
    // 这样模板后续修改不会影响已录入数据的回放结果
    const rawTpl = recData.template_version_id
      ? tplMap.get(`v:${recData.template_version_id}` as any)
      : tplMap.get(recData.template_id);
    if (!rawTpl) {
      warnings.push({ type: 'record_template_missing', record_data_id: a.record_data_id });
      continue;
    }
    const linkedTpl: RecordTemplate = {
      id: rawTpl.id,
      name: rawTpl.name,
      version: rawTpl.version,
      groups: rawTpl.field_definitions,
      layout_options: rawTpl.layout_options || {},
    };

    const effectiveRaw: Record<string, any> = { ...(recData.batch_shared_data || {}), ...(recData.raw_data || {}) };
    const headerChanges = findRecordHeaderChanges(linkedTpl, effectiveRaw);
    if (headerChanges.length) {
      warnings.push({
        type: 'record_free_grid_header_changed', record_data_id: recData.id,
        tables: [...new Set(headerChanges.map(change => change.table))], changes: headerChanges,
        detail: '数据录入时修改了表头名称（可能包含新增试样表头）。映射仍按稳定标识取值，请核对报告中的表头名称及其对应数据，必要时修改报告。',
      });
    }
    const entryAdjustedTables = linkedTpl.groups.flatMap(group => group.fields || [])
      .filter(field => {
        if (field.type !== 'free_grid') return false;
        const value = effectiveRaw[field.code];
        const instanceTable = value && typeof value === 'object' ? value.__free_table_structure__ : null;
        return !!instanceTable && (
          (instanceTable.rows || []).some((row: any) => row?.entry_added)
          || (instanceTable.columns || []).some((column: any) => column?.entry_added)
        );
      });
    if (entryAdjustedTables.length) {
      warnings.push({
        type: 'record_free_grid_structure_changed',
        record_data_id: recData.id,
        tables: entryAdjustedTables.map(field => field.label || field.code),
        detail: '数据录入时新增了非试样行或列；新增结构已保留在原始记录中，但项目模板不会自动映射这些临时位置。',
      });
    }
    const merged: Record<string, any> = { ...effectiveRaw, ...(recData.derived_data || {}) };
    let flat = flattenMatrixValuesToFlatData(linkedTpl, merged);
    flat = applyMatrixCellFormulas(linkedTpl, flat);
    flat = applyMatrixSummaryFormulas(linkedTpl, flat);
    const computedFields = linkedTpl.groups.flatMap(g => g.fields).filter(f => f.type === 'computed' && f.formula);
    const ordered = topologicalOrder(computedFields.map(f => ({ code: f.code, formula: f.formula! })));
    for (const code of ordered) {
      const f = computedFields.find(x => x.code === code);
      if (f?.formula) { try { flat[code] = execute(f.formula, flat); } catch { flat[code] = null; } }
    }
    // 展平 variant_list / select 自定义等复杂字段，使 binding `record_field` 能取到字符串
    flat = flattenDataForDisplay(linkedTpl, flat);

    // 新模型：结论是“分区模块 + 独立字段”；旧 record_conclusion 复合字段由统一读取器兼容。
    const recordConclusion = extractRecordConclusion(linkedTpl, effectiveRaw);
    const reportableItems = recordConclusion?.items.filter(item => item.status === 'completed' && item.report_enabled) || [];
    const structuredConclusions = reportableItems.map(item => ({
      sub_name: recordConclusion?.mode === 'children' ? item.name : undefined,
      value: item.conclusion || '—',
      judgment_requirement: item.judgment_requirement,
      project_name: recordConclusion?.project_name || '',
    }));
    // 结构化结论存在但本次没有任何可进报告的已完成项：整份方法记录不生成报告项目。
    if (recordConclusion && structuredConclusions.length === 0) {
      warnings.push({ type: 'record_conclusion_no_reportable_item', record_data_id: recData.id, template_id: recData.template_id });
      continue;
    }
    const structuredRecordConclusion = recordConclusion ? {
      mode: recordConclusion.mode,
      project_name: recordConclusion.project_name,
      judgment_requirement: recordConclusion.judgment_requirement,
      conclusion: recordConclusion.conclusion,
      items: structuredConclusions.map(item => ({
        name: item.sub_name,
        judgment_requirement: item.judgment_requirement,
        conclusion: item.value,
      })),
    } : undefined;

    // 收集本项目自己的设备引用（不要混到其它项目）
    const projectDeviceCodes: string[] = [];
    for (const g of linkedTpl.groups) {
      for (const f of g.fields) {
        if (f.type === 'device_ref') {
          const v = effectiveRaw[f.code];
          if (Array.isArray(v)) {
            for (const c of v) {
              if (c) {
                const code = String(c);
                projectDeviceCodes.push(code);
                allDeviceCodes.add(code); // 全单聚合（首页设备汇总用）
              }
            }
          }
        }
      }
    }

    const projGroups: any[] = projTpl.field_definitions || [];
    const projMeta = {
      tester_name: recData.tester_name || null,
      tested_at: recData.tested_at || null,
      reviewer_name: recData.reviewer_name || null,
      reviewed_at: recData.reviewed_at || null,
    };
    // 本项目对应的样品/材料分单接口字段（按 record_data 的 sample_external_id + test_item_name 回查）
    const sampleInfo = sampleInfoById.get(recData.sample_external_id)
      || sampleInfoByName.get(recData.sample_external_id) || {};
    const testInfo = testInfoByKey.get(`${recData.sample_external_id}||${recData.test_item_name}`) || {};
    const projCtx: ReportRenderCtx = {
      order: { order_no, customer_name: mock_context.customer_name, sample_name: mock_context.sample_name, received_at: mock_context.received_at },
      order_meta: orderMeta,
      order_samples: orderSamples,
      sample_info: sampleInfo,
      test_info: testInfo,
      report_meta: reportMetaCtx,
      record_flat_data: flat,
      record_raw_data: effectiveRaw,
      record_conclusion: structuredRecordConclusion,
      record_meta: projMeta,
      linked_record_template: linkedTpl,
    };

    const titleOverride = (a.title || '').trim();
    // 新模型严格以原始记录结论分区的总项目名称为准；工作台 title 与 layout_options.project_name
    // 只在存量（无结构化结论）记录中继续作为兼容来源。
    const structuredProjectName = recordConclusion?.project_name || '';
    const displayName = recordConclusion
      ? (structuredProjectName
        || String(recData.test_item_name || testInfo.project_name || '').trim()
        || linkedTpl.name || projTpl.name)
      : (titleOverride
        || String(recData.test_item_name || testInfo.project_name || '').trim()
        || (projTpl.layout_options as any)?.project_name
        || (linkedTpl.layout_options as any)?.project_name
        || linkedTpl.name || projTpl.name);
    // 新模板优先使用原始记录结构化结论；存量模板继续使用项目报告模板上的单结论绑定。
    const conclDecls: Array<{ sub_name?: string; binding: any }> =
      Array.isArray((projTpl.layout_options as any)?.conclusions) ? (projTpl.layout_options as any).conclusions : [];
    const toStr = (v: any) => (v === null || v === undefined || v === '') ? '—' : String(v);
    const legacyConclusionFields = conclDecls.slice(0, 1)
      .filter(d => d && d.binding)
      .map(d => ({ sub_name: undefined, value: toStr(resolveBinding(d.binding, projCtx)) }));
    const conclusionFields = recordConclusion
      ? structuredConclusions.map(({ sub_name, value, judgment_requirement }) => ({ sub_name, value, judgment_requirement }))
      : legacyConclusionFields;
    const sInfo: any = sampleInfo;
    projectRecords.push({
      sample_no: (sInfo.sort_no != null && sInfo.sort_no !== '') ? String(sInfo.sort_no) : undefined,
      sample_name: sInfo.sample_name || recData.sample_external_id || '',
      name: displayName,
      standard: (projTpl.test_project_codes || []).join(', ') || '—',
      conclusions: conclusionFields.length ? conclusionFields : [{ sub_name: '', value: '—' }],
    });

    projects.push({
      name: displayName,
      title: displayName,
      page_break: a.page_break !== false,
      template_id: projTpl.id,
      record_data_id: recData.id,
      groups: projGroups,
      layout_options: projTpl.layout_options || {},
      record_flat_data: flat,
      record_raw_data: effectiveRaw,
      record_conclusion: structuredRecordConclusion,
      record_meta: projMeta,
      linked_record_template: linkedTpl,
      order_meta: orderMeta,
      sample_info: sampleInfo,
      test_info: testInfo,
      report_meta: reportMetaCtx,
      device_codes: projectDeviceCodes,
      blocks: projTpl.layout_options?.blocks || [],
    });
  }

  // P-Map-7：按样品分组（样品号数值序，样品内保持项目原序），跑 index，展平成 conclusion 表行（每子结论一行）。
  {
    const order = projectRecords.map((_, i) => i);
    order.sort((a, b) => {
      const na = parseFloat(projectRecords[a].sample_no ?? ''), nb = parseFloat(projectRecords[b].sample_no ?? '');
      const va = isNaN(na) ? Infinity : na, vb = isNaN(nb) ? Infinity : nb;
      return va !== vb ? va - vb : a - b; // 同样品按原项目序（显式 index 兜底，稳定）
    });
    let runningIdx = 0;
    for (const oi of order) {
      const pr = projectRecords[oi];
      runningIdx++;
      // 项目序号挂到对应的项目段（与结论汇总表序号一致）——明细段标题渲染为「N) 项目名」
      if (projects[oi]) projects[oi].seq = runningIdx;
      const subs = pr.conclusions.length ? pr.conclusions : [{ sub_name: '', value: '—' }];
      for (const c of subs) {
        projectSummary.push({
          index: runningIdx,
          name: pr.name,
          standard: c.judgment_requirement || pr.standard,
          conclusion: c.value,
          sample_no: pr.sample_no,
          sample_name: pr.sample_name,
          sub_name: c.sub_name || undefined,
        });
      }
    }
    // 项目明细段按与结论汇总表相同的顺序输出（序号才连续一致）
    projects = order.map(oi => projects[oi]);
  }

  // 查全单涉及的所有设备一次，按 asset_code 建索引；首页用全量，项目用各自的子集
  const equipmentMap = new Map<string, any>();
  const allEquipmentRows: any[] = [];
  if (allDeviceCodes.size) {
    const r = await pool.query(
      'SELECT asset_code, name, model, trace_date, expire_date FROM equipment_library WHERE asset_code = ANY($1)',
      [Array.from(allDeviceCodes)]
    );
    const foundCodes = new Set<string>();
    for (const row of r.rows) {
      foundCodes.add(row.asset_code);
      if (!row.trace_date || !row.expire_date) {
        warnings.push({ type: 'equipment_missing_date', asset_code: row.asset_code, name: row.name });
      }
      const td = row.trace_date ? new Date(row.trace_date).toISOString().slice(0, 10) : '';
      const ed = row.expire_date ? new Date(row.expire_date).toISOString().slice(0, 10) : '';
      // 溯源日期 / 到期日期 分列直接取自设备库
      const entry = {
        name: row.name,
        model: row.model || '',
        asset_code: row.asset_code,
        trace_date: td,
        expire_date: ed,
      };
      equipmentMap.set(row.asset_code, entry);
      allEquipmentRows.push(entry);
    }
    for (const c of allDeviceCodes) {
      if (!foundCodes.has(c)) warnings.push({ type: 'equipment_not_found', asset_code: c });
    }
  }

  // 每个项目的设备行 = 自身 device_codes 在 map 中能找到的（保持顺序，去重）
  for (const p of projects) {
    const seen = new Set<string>();
    p.equipment_rows = [];
    for (const code of (p.device_codes || [])) {
      if (seen.has(code)) continue;
      seen.add(code);
      const entry = equipmentMap.get(code);
      if (entry) p.equipment_rows.push(entry);
    }
  }

  let finalTypst = '';
  let contentDoc: ReportContentDoc | null = null;
  if (useGroupsModel) {
    // 报告样品三件套（首页 binding source='report_sample'）：单样品＝该样品值、多样品＝顿号连接兜底。
    const joinSample = (arr: any[]) => arr.map(x => (x == null ? '' : String(x))).filter(s => s.trim()).join('、');
    const reportSample = {
      name: mock_context.sample_name || joinSample(orderSamples.map(s => s.name)),
      sort_no: joinSample(orderSamples.map(s => s.sort_no)),
      model: joinSample(orderSamples.map(s => s.model)),
    };
    // 首页没有单一项目上下文，按本报告 scope 内原始记录做确定性汇总：
    // 检测时间＝最早提交时间，审核时间＝最晚审核时间；人员去重后用顿号合并。
    const scopedRecords = activeAssignments
      .map((assignment: any) => recMap.get(assignment.record_data_id))
      .filter(Boolean);
    const uniqueNames = (key: 'tester_name' | 'reviewer_name') => [...new Set(scopedRecords
      .map((record: any) => String(record[key] || '').trim()).filter(Boolean))].join('、');
    const pickTime = (key: 'tested_at' | 'reviewed_at', mode: 'min' | 'max') => {
      const values = scopedRecords.map((record: any) => record[key]).filter(Boolean);
      if (!values.length) return null;
      return values.slice().sort((a: any, b: any) => {
        const diff = new Date(a).getTime() - new Date(b).getTime();
        return mode === 'min' ? diff : -diff;
      })[0];
    };
    const coverRecordMeta = {
      tester_name: uniqueNames('tester_name') || null,
      tested_at: pickTime('tested_at', 'min'),
      reviewer_name: uniqueNames('reviewer_name') || null,
      reviewed_at: pickTime('reviewed_at', 'max'),
    };
    const coverCtx: ReportRenderCtx = {
      order: {
        order_no,
        customer_name: mock_context.customer_name || '',
        sample_name: reportSample.name,   // 兼容存量绑定 order.sample_name；新绑定用 report_sample.name
        received_at: mock_context.received_at || '',
      },
      order_meta: orderMeta,
      order_samples: orderSamples,
      report_sample: reportSample,
      report_meta: reportMetaCtx,
      record_meta: coverRecordMeta,
      project_summary: projectSummary,
      equipment_rows: allEquipmentRows,
      blank_scope: blank_scope || false,   // 取号前：样品信息表 / 检测结论表出占位
      // 首页原样照片（image 分区，文员直接上传，存于草稿 ctx.record_raw_data）——carry 到本报告首页，
      // 否则首页照片会丢（groups override 不含照片，报告 ctx 又是重算的）。
      ...(cover_ctx_photos && Object.keys(cover_ctx_photos).length ? { record_raw_data: cover_ctx_photos } : {}),
    };
    // 冻结成自包含实例文档：groups 给结构、ctx 给数据快照。
    // 生成与"实例编辑后重渲染"共用 renderContentDoc，保证装配口径一致（P2）。
    contentDoc = {
      // 真封面（P3，可选）：标题/编号/委托信息等，绑定订单信息；渲染在最前一页
      ...(coverPageTpl ? {
        front_cover: {
          name: coverPageTpl.name,
          groups: coverPageTpl.field_definitions,
          layout_options: coverPageTpl.layout_options || {},
          ctx: { order: coverCtx.order, order_meta: orderMeta, order_samples: orderSamples, report_meta: reportMetaCtx, record_meta: coverRecordMeta } as any,
        },
      } : {}),
      cover: {
        name: coverTpl.name,
        groups: coverTpl.field_definitions,
        layout_options: coverTpl.layout_options || {},
        ctx: coverCtx as any,
      },
      projects: projects.map(p => ({
        name: p.name,
        title: p.title || p.name,
        seq: p.seq,
        page_break: p.page_break !== false,
        groups: p.groups,
        layout_options: p.layout_options || {},
        ctx: {
          order: coverCtx.order,
          order_meta: orderMeta,
          order_samples: orderSamples,
          sample_info: p.sample_info,
          test_info: p.test_info,
          report_meta: reportMetaCtx,
          project_summary: projectSummary,
          equipment_rows: p.equipment_rows || [],
          record_flat_data: p.record_flat_data,
          record_raw_data: p.record_raw_data,
          record_conclusion: p.record_conclusion,
          record_meta: p.record_meta,
          source_record_data_id: p.record_data_id,
          linked_record_template: p.linked_record_template,
        } as any,
      })),
    };
    finalTypst = renderContentDoc(contentDoc);
  } else {
    const baseCtx: ReportRenderContext = {
      order: {
        order_no,
        customer_name: mock_context.customer_name || '',
        sample_name: mock_context.sample_name || '',
        received_at: mock_context.received_at || '',
      },
      project_summary: projectSummary,
      equipment_rows: allEquipmentRows,
    };
    finalTypst = renderReportTypst({
      title: `检测报告 ${order_no}`,
      coverBlocks: coverTpl.layout_options?.blocks || [],
      projects: projects.map(p => ({
        name: p.title || p.name,
        blocks: p.blocks,
        record_flat_data: p.record_flat_data,
        linked_record_template: p.linked_record_template,
      })),
      baseCtx,
    });
  }

  if (contentDoc) contentDoc.source_review_revision = randomUUID();
  return {
    finalTypst,
    contentDoc,
    warnings,
    coverTpl,
    projects,
    projectSummary,
    equipmentRows: allEquipmentRows,
    assignmentTplIds,
    assignmentRecIds,
  };
}

/**
 * 生成一份报告并入库（buildReportTypst → 编译 → INSERT reports + 审计）。
 * generate-batch（手动拆分）与外部取号生成（接口 1.2，routes/external.ts）共用，
 * 保证装配 / 入库 / 留痕口径一致。`report_meta` 提供则使用接口元数据；缺省时仅 demo 使用示例，server 保持空白。
 */
export async function generateAndStoreReport(params: {
  order_no: string;
  cover_template_id: number;
  cover_page_template_id?: number | null;
  batch_id: number;
  report_no: string | null;
  sample_label?: string | null;
  project_assignments: any[];
  mock_context: any;
  report_meta?: ReportMeta | null;
  /** 可选·首页草稿结构覆盖（见 buildReportTypst.cover_groups_override）。 */
  cover_groups_override?: any[] | null;
  /** 可选·本报告编号自带样品清单（见 buildReportTypst.report_samples）。 */
  report_samples?: Array<{ no: string; name: string; sort_no?: string; model?: string; barcode?: string; id?: string }> | null;
  /** 可选·接口 1.2 当前报告范围的完整样品/材料分单。 */
  report_scope_samples?: any[] | null;
  /** 可选·首页草稿原样照片（见 buildReportTypst.cover_ctx_photos）。 */
  cover_ctx_photos?: Record<string, any[]> | null;
  actor?: string | null;
}): Promise<{ report_id: number; report_no: string | null; warnings: any[]; compiled: boolean }> {
  const {
    order_no, cover_template_id, cover_page_template_id, batch_id, report_no,
    sample_label = null, mock_context, report_meta = null, cover_groups_override = null, report_samples = null,
    report_scope_samples = null,
    cover_ctx_photos = null, actor = null,
  } = params;
  const project_assignments = Array.isArray(params.project_assignments) ? params.project_assignments : [];
  // Batch generation must carry the same saved cover/photos as requisition generation.
  const draft = cover_groups_override == null && cover_ctx_photos == null
    ? await pool.query(`SELECT content_doc FROM reports WHERE order_no=$1 AND cover_template_id=$2 AND is_cover_draft=true ORDER BY id DESC LIMIT 1`, [order_no, cover_template_id])
    : null;
  const draftCover = draft?.rows[0]?.content_doc?.cover;
  const built = await buildReportTypst({ order_no, cover_template_id, cover_page_template_id, project_assignments, mock_context, report_meta,
    cover_groups_override: cover_groups_override ?? draftCover?.groups,
    report_samples, report_scope_samples, cover_ctx_photos: cover_ctx_photos ?? pickReportImageData(draftCover) });
  const { finalTypst, contentDoc, warnings, coverTpl, projects, assignmentTplIds, assignmentRecIds } = built;

  let compiled = false;
  try { await compileTypst(finalTypst); compiled = true; }
  catch (e: any) { warnings.push({ type: 'compile_failed', detail: e.message }); }

  const scope = {
    sample_label,
    record_data_ids: assignmentRecIds,
    project_template_ids: assignmentTplIds,
    // 组合关系与生成时实际采用的项目模板版本一并快照。不能只保留两个平行 id 数组，
    // 否则同一份原始记录使用多个项目模板时，事后无法准确还原每个章节的数据来源。
    project_assignments: project_assignments.filter((a: any) => a.enabled !== false).map((a: any) => ({
      scope_key: a.scope_key || null,
      record_data_id: Number(a.record_data_id),
      project_template_id: Number(a.project_template_id),
      project_template_version_id: a.project_template_version_id == null
        ? null : Number(a.project_template_version_id),
      title: a.title || null,
      page_break: a.page_break !== false,
    })),
  };
  const docJson = contentDoc ? JSON.stringify(contentDoc) : null;
  const ins = await pool.query(
    `INSERT INTO reports (order_no, cover_template_id, project_template_ids, record_data_ids,
       final_typst, blocks_snapshot, data_snapshot, warnings, generated_by,
       batch_id, report_no, scope, content_doc, content_doc_original, edited)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, $12::jsonb, $13::jsonb, $13::jsonb, false) RETURNING id`,
    [
      order_no, cover_template_id, assignmentTplIds, assignmentRecIds,
      finalTypst,
      JSON.stringify({ cover_groups: coverTpl.field_definitions, projects: projects.map(p => ({ name: p.name, groups: p.groups })) }),
      JSON.stringify({ projects: projects.map(p => ({ name: p.name, record_flat_data: p.record_flat_data })) }),
      JSON.stringify(warnings), actor,
      batch_id, report_no, JSON.stringify(scope),
      docJson,
    ]
  );
  const newId = ins.rows[0].id;
  await writeReportAudit(newId, 'generate', actor, [], `生成报告 ${report_no || ''}`);
  return { report_id: newId, report_no, warnings, compiled };
}

router.post('/generate-by-order', async (req: Request, res: Response) => {
  const { order_no, cover_template_id, cover_page_template_id, project_assignments = [], mock_context = {} } = req.body;
  if (!order_no || !cover_template_id) {
    res.status(400).json({ error: 'order_no 和 cover_template_id 必填' });
    return;
  }

  try {
    const built = await buildReportTypst({ order_no, cover_template_id, cover_page_template_id, project_assignments, mock_context });
    const { finalTypst, warnings, coverTpl, projects, assignmentTplIds, assignmentRecIds } = built;

    let pdfBuffer: Buffer | null = null;
    try {
      const compileResult = await compileTypst(finalTypst);
      pdfBuffer = compileResult.pdf;
    } catch (e: any) {
      warnings.push({ type: 'compile_failed', detail: e.message });
    }

    const insertRes = await pool.query(
      `INSERT INTO reports (order_no, cover_template_id, project_template_ids, record_data_ids,
        final_typst, blocks_snapshot, data_snapshot, warnings, generated_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9) RETURNING id`,
      [
        order_no,
        cover_template_id,
        assignmentTplIds,
        assignmentRecIds,
        finalTypst,
        JSON.stringify({ cover_groups: coverTpl.field_definitions, projects: projects.map(p => ({ name: p.name, groups: p.groups })) }),
        JSON.stringify({ projects: projects.map(p => ({ name: p.name, record_flat_data: p.record_flat_data })) }),
        JSON.stringify(warnings),
        req.headers['x-user'] || null,
      ]
    );

    res.json({
      report_id: insertRes.rows[0].id,
      warnings,
      compiled: !!pdfBuffer,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 按批次生成多份报告（P1：三种拆分粒度的统一落点）
 *
 * 一张委托单按 split_mode 拆成多份报告，共享同一首页模板，每份报告渲染自己的首页
 * （projectSummary / sample_name 自动收敛到本报告 scope——buildReportTypst 已按传入的
 * project_assignments 子集计算，无需额外改动）。
 *
 * Body:
 *  - order_no, cover_template_id
 *  - split_mode: 'single' | 'by_sample' | 'by_project' | 'custom'（仅记录用）
 *  - reports: { report_no?, sample_label?, project_assignments: [...] }[]
 *      每个元素 = 一份报告，project_assignments 结构同 generate-by-order
 *  - mock_context: { customer_name, received_at }（共享；sample_name 用各报告的 sample_label）
 *
 * 返回: { batch_id, reports: [{ report_id, report_no, warnings, compiled }] }
 */
router.post('/generate-batch', async (req: Request, res: Response) => {
  const { order_no, cover_template_id, cover_page_template_id, split_mode = 'single', reports = [], mock_context = {} } = req.body;
  if (!order_no || !cover_template_id) {
    res.status(400).json({ error: 'order_no 和 cover_template_id 必填' });
    return;
  }
  if (!Array.isArray(reports) || reports.length === 0) {
    res.status(400).json({ error: 'reports 不能为空（至少一份报告）' });
    return;
  }
  const actor = (req.headers['x-user'] as string) || null;
  try {
    const batchRes = await pool.query(
      `INSERT INTO report_batches (order_no, cover_template_id, split_mode, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [order_no, cover_template_id, split_mode, actor]
    );
    const batchId = batchRes.rows[0].id;

    const out: any[] = [];
    for (const r of reports) {
      const sample_label = r.sample_label || null;
      const ctx = { ...mock_context, sample_name: sample_label || mock_context.sample_name };
      out.push(await generateAndStoreReport({
        order_no, cover_template_id, cover_page_template_id, batch_id: batchId,
        report_no: r.report_no || null, sample_label,
        project_assignments: r.project_assignments, mock_context: ctx, actor,
      }));
    }

    res.json({ batch_id: batchId, reports: out });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 实时预览：与 generate-by-order 相同输入，但不入库，直接返回 PDF buffer。
 * 用于报告生成工作台的右侧实时渲染。
 */
router.post('/preview', async (req: Request, res: Response) => {
  const { order_no, cover_template_id, cover_page_template_id, project_assignments = [], mock_context = {} } = req.body;
  if (!order_no || !cover_template_id) {
    res.status(400).json({ error: 'order_no 和 cover_template_id 必填' });
    return;
  }
  try {
    const { finalTypst } = await buildReportTypst({ order_no, cover_template_id, cover_page_template_id, project_assignments, mock_context });
    const compileResult = await compileTypst(finalTypst);
    res.set({
      'Content-Type': 'application/pdf',
      'X-Compile-Duration-Ms': String(compileResult.duration_ms),
    });
    res.send(compileResult.pdf);
  } catch (err: any) {
    if (err instanceof RenderBusyError) { res.set('Retry-After', '3').status(503).json({ error: err.message }); return; }
    res.status(500).json({ error: err.message });
  }
});

/** 解析单个 binding 为字符串值 */
function resolveBindingValue(b: any, ctx: ReportRenderContext): string {
  if (!b) return '—';
  switch (b.source) {
    case 'literal': return b.text ?? '';
    case 'order': return ctx.order?.[b.key as keyof NonNullable<ReportRenderContext['order']>] ?? '';
    case 'system': return b.key === 'today' ? new Date().toISOString().slice(0, 10) : new Date().toLocaleString();
    case 'record_field': {
      const v = ctx.record_flat_data?.[b.field_code];
      return v === null || v === undefined || v === '' ? '—' : String(v);
    }
    case 'record_cell': {
      const k = `${b.matrix_code}__s${b.sample_idx}__${b.param_code}`;
      const v = ctx.record_flat_data?.[k];
      return v === null || v === undefined || v === '' ? '—' : String(v);
    }
    case 'record_summary': {
      const k = b.param_code
        ? `${b.matrix_code}__summary__${b.row_id}__${b.param_code}`
        : `${b.matrix_code}__summary__${b.row_id}`;
      const v = ctx.record_flat_data?.[k];
      return v === null || v === undefined || v === '' ? '—' : String(v);
    }
    default: return '—';
  }
}

/** GET /api/reports — 列出已生成的报告 */
router.get('/', async (req: Request, res: Response) => {
  const { order_no } = req.query as { order_no?: string };
  // 首页草稿（is_cover_draft）不属于"已生成报告"，列表永不返回。
  // 被取代的历史版本（superseded_by 非空）也不在列表显示，只在「历史版本」里查看。
  const where: string[] = ['is_cover_draft = false', 'superseded_by IS NULL'];
  const params: any[] = [];
  if (order_no) {
    params.push(order_no);
    where.push(`order_no = $${params.length}`);
  }
  // data_rework_open：是否存在未关闭的 data_entry 返工工单（与 external.ts hasOpenDataEntryRework 同口径）。
  // 数据退回锁定的报告 external_status 也是 'external_revision'，前端须靠本字段与「报告退回(可编辑)」区分
  // ——套用首页/编辑只能作用于可编辑的退回报告，不能碰等待数据重审的锁定报告。
  const r = await pool.query(
    `SELECT id, order_no, cover_template_id, project_template_ids, generated_at, version,
            batch_id, report_no, scope, edited, stale, external_status, external_suggestion,
            jsonb_array_length(warnings) AS warning_count,
            EXISTS (
              SELECT 1 FROM rework_tickets t
               WHERE t.target_stage = 'data_entry' AND t.status <> 'resolved'
                 AND (t.report_id = reports.id OR t.record_data_id = ANY(reports.record_data_ids))
            ) AS data_rework_open
     FROM reports WHERE ${where.join(' AND ')}
     ORDER BY batch_id DESC NULLS LAST, generated_at DESC LIMIT 100`,
    params
  );
  res.json(r.rows);
});

/**
 * 首页草稿（order 级）—— 取号前文员编辑"首页实例"的载体。
 * POST body: { order_no, cover_template_id, cover_page_template_id? }
 * 幂等：该订单已有首页草稿则直接返回其 id；否则按首页模板 + 订单数据渲染一份 cover-only
 * content_doc（空 project_assignments）并入库（is_cover_draft=true），返回 report_id 供 InstanceEditor 编辑。
 */
router.post('/cover-draft', async (req: Request, res: Response) => {
  const { order_no, cover_template_id, cover_page_template_id } = req.body || {};
  if (!order_no || !cover_template_id) { res.status(400).json({ error: 'order_no / cover_template_id 必填' }); return; }
  try {
    // 编辑首页是【订单级·取号前】预览：样品信息表 / 检测结论表的范围由报告编号(接口 1.2)决定，
    // 此时尚未取号 → 这两张表出灰字占位（blank_scope），不填整单数据；取号后各报告编号按自己的
    // SampleList 自动生成（report_samples）。文员在此只排版首页结构 / 图片 / 样式。
    const ord = await pool.query('SELECT customer_name, received_at FROM work_orders WHERE order_no = $1', [order_no]);
    const mock_context = {
      customer_name: ord.rows[0]?.customer_name || '',
      received_at: ord.rows[0]?.received_at || '',
      sample_name: '',
    };
    const buildArgs = {
      order_no, cover_template_id, cover_page_template_id: cover_page_template_id || null,
      project_assignments: [], mock_context,
      blank_scope: true,   // 取号前：样品信息表 / 检测结论表出占位提示
    };

    const existing = await pool.query(
      'SELECT id, edited, cover_template_id FROM reports WHERE order_no = $1 AND is_cover_draft = true LIMIT 1', [order_no]);
    if (existing.rows.length) {
      const ex = existing.rows[0];
      const sameTemplate = String(ex.cover_template_id) === String(cover_template_id);
      // 同一模板且已被文员编辑过：保留其改动、不重建（避免覆盖手改）。
      // 换了首页模板 或 未编辑：按【当前选的模板】+订单记录重建 content_doc——修复"选了别的首页模板却仍用旧模板"的 bug。
      if (ex.edited && sameTemplate) { res.json({ report_id: ex.id, existed: true }); return; }
      const built = await buildReportTypst(buildArgs);
      const docJson = built.contentDoc ? JSON.stringify(built.contentDoc) : null;
      await pool.query(
        `UPDATE reports SET cover_template_id = $5, final_typst = $1, warnings = $2::jsonb, content_doc = $3::jsonb, content_doc_original = $3::jsonb, edited = false WHERE id = $4`,
        [built.finalTypst, JSON.stringify(built.warnings), docJson, ex.id, cover_template_id]);
      res.json({ report_id: ex.id, existed: true, refreshed: true, template_changed: !sameTemplate });
      return;
    }

    const built = await buildReportTypst(buildArgs);
    const docJson = built.contentDoc ? JSON.stringify(built.contentDoc) : null;
    const ins = await pool.query(
      `INSERT INTO reports (order_no, cover_template_id, project_template_ids, record_data_ids,
         final_typst, warnings, report_no, scope, content_doc, content_doc_original, edited, is_cover_draft)
       VALUES ($1,$2,'{}','{}',$3,$4::jsonb,$5,$6::jsonb,$7::jsonb,$7::jsonb,false,true) RETURNING id`,
      [order_no, cover_template_id, built.finalTypst, JSON.stringify(built.warnings),
       `${order_no}-首页草稿`, JSON.stringify({ cover_draft: true }), docJson]
    );
    res.json({ report_id: ins.rows[0].id, existed: false });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/**
 * 订单 → 全部审核通过(reviewed)原始记录 → project_assignments（供首页草稿的结论表展开）。
 * 每条记录用其原始记录模板 id，匹配一个未归档的项目报告模板（linked_record_template_id 相同）。
 * 一个记录模板可能对应多个项目模板，取 id 最小（稳定）；没有对应项目模板的记录跳过。
 */
async function deriveApprovedAssignments(
  order_no: string,
  includeAll = false,
  includeAllLinkedTemplates = false,
): Promise<Array<{ record_data_id: number; project_template_id: number }>> {
  // includeAll（编辑首页草稿·订单级预览）：不限审核状态，覆盖订单下【全部】原始记录 → 结论表列出订单对应的所有测试项目；
  // 缺省（取号生成 / scope-candidates）：仅 reviewed 已审核通过的记录（最终报告只能用审核通过的数据）。
  const recs = await pool.query(
    includeAll
      ? `SELECT id, template_id FROM record_data WHERE order_no = $1 AND cancelled_at IS NULL ORDER BY id`
      : `SELECT id, template_id FROM record_data WHERE order_no = $1 AND audit_status = 'reviewed' AND cancelled_at IS NULL ORDER BY id`,
    [order_no]);
  if (!recs.rows.length) return [];
  const recTplIds = [...new Set(recs.rows.map((r: any) => r.template_id).filter((x: any) => x != null))];
  if (!recTplIds.length) return [];
  // 仅取【当前生效版本已审核通过】的项目模板——未审核（草稿/待审）的项目模板不参与报告生成。
  const projs = await pool.query(
    `SELECT t.id, t.linked_record_template_id,
            t.host_manufacturer_id
     FROM report_templates t
     JOIN report_template_versions cv ON cv.id = t.current_version_id
     WHERE t.template_kind = 'project' AND t.archived_at IS NULL
       AND t.linked_record_template_id = ANY($1) AND cv.status = 'approved'
     ORDER BY t.linked_record_template_id,
              CASE WHEN t.host_manufacturer_id IS NULL THEN 0 ELSE 1 END,
              t.id`,
    [recTplIds]);
  const projByRecTpl = new Map<number, number[]>();
  for (const p of projs.rows) {
    const ids = projByRecTpl.get(p.linked_record_template_id) || [];
    ids.push(p.id);
    projByRecTpl.set(p.linked_record_template_id, ids);
  }
  const assignments: Array<{ record_data_id: number; project_template_id: number }> = [];
  for (const r of recs.rows) {
    const pids = projByRecTpl.get(r.template_id) || [];
    const selectedPids = includeAllLinkedTemplates ? pids : pids.slice(0, 1);
    for (const pid of selectedPids) {
      assignments.push({ record_data_id: r.id, project_template_id: pid });
    }
  }
  return assignments;
}

/** GET /api/reports/:id — 报告详情 */
router.get('/:id', async (req: Request, res: Response) => {
  const r = await pool.query('SELECT * FROM reports WHERE id = $1', [req.params.id]);
  if (!r.rows.length) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(r.rows[0]);
});

/**
 * GET /api/reports/:id/versions — 报告历史版本链。
 * 沿 superseded_by 自指链上溯(被取代的旧版)+下溯(取代它的新版)，返回整条链按时间倒序。
 * 退回修改→重新生成会让旧报告保留为历史版本（superseded_by 指向新版），此处供「历史版本」查看。
 * 历史 PDF 用既有 GET /api/reports/:id/pdf 下载（对任意 id 都能编译 final_typst）。
 */
router.get('/:id/versions', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: '非法 id' }); return; }
  try {
    const r = await pool.query(
      `WITH RECURSIVE up AS (
         SELECT id, report_no, version, generated_at, generated_by, edited, superseded_by FROM reports WHERE id = $1
         UNION ALL
         SELECT p.id, p.report_no, p.version, p.generated_at, p.generated_by, p.edited, p.superseded_by
           FROM reports p JOIN up ON p.superseded_by = up.id
       ), down AS (
         SELECT id, report_no, version, generated_at, generated_by, edited, superseded_by FROM reports WHERE id = $1
         UNION ALL
         SELECT n.id, n.report_no, n.version, n.generated_at, n.generated_by, n.edited, n.superseded_by
           FROM reports n JOIN down ON n.id = down.superseded_by
       )
       SELECT DISTINCT id, report_no, version, generated_at, generated_by, edited, superseded_by FROM (
         SELECT * FROM up UNION SELECT * FROM down
       ) chain ORDER BY generated_at DESC, id DESC`,
      [id],
    );
    if (!r.rows.length) { res.status(404).json({ error: 'Not found' }); return; }
    const versions = r.rows.map((row: any) => ({
      id: row.id, report_no: row.report_no, version: row.version,
      generated_at: row.generated_at, generated_by: row.generated_by, edited: row.edited,
      is_current: row.superseded_by == null,
    }));
    res.json(versions);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/** GET /api/reports/:id/audit — 报告编辑留痕（生成 + 每次编辑的字段级 diff） */
router.get('/:id/audit', async (req: Request, res: Response) => {
  const r = await pool.query(
    `SELECT id, action, actor_name, diff, note, created_at
     FROM report_audit_log WHERE report_id = $1 ORDER BY created_at DESC, id DESC`,
    [req.params.id]
  );
  res.json(r.rows);
});

/** GET /api/reports/:id/pdf — 下载已生成报告 PDF（编译 final_typst） */
router.get('/:id/pdf', async (req: Request, res: Response) => {
  try {
    const r = await pool.query('SELECT order_no, final_typst FROM reports WHERE id = $1', [req.params.id]);
    if (!r.rows.length) { res.status(404).json({ error: 'Not found' }); return; }
    const compileResult = await compileTypst(r.rows[0].final_typst);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="report-${r.rows[0].order_no}.pdf"`,
    });
    res.send(compileResult.pdf);
  } catch (err: any) {
    if (err instanceof RenderBusyError) { res.set('Retry-After', '3').status(503).json({ error: err.message }); return; }
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reports/:id/docx — 下载 DOCX 副本
 *
 * 实现：Typst → PDF → 经 LibreOffice headless 转 DOCX。
 * ⚠️ 这是 PDF 的二次反向转换：复杂表格（rowspan/colspan）、图片排版、
 *    字体可能与 PDF 有差异，仅供文字微调用，正式交付优先 PDF。
 *
 * 依赖：本机安装 LibreOffice（macOS: `brew install --cask libreoffice`，
 *      或环境变量 SOFFICE_BIN 指定 soffice 可执行文件路径）。
 */
const SOFFICE_BIN = process.env.SOFFICE_BIN
  || (process.platform === 'darwin'
    ? '/Applications/LibreOffice.app/Contents/MacOS/soffice'
    : 'soffice');

async function convertPdfToDocx(pdf: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'rpt-docx-'));
  const pdfPath = path.join(dir, 'in.pdf');
  await writeFile(pdfPath, pdf);
  try {
    await new Promise<void>((resolve, reject) => {
      // 关键：用 writer_pdf_import 把 PDF 当作 Writer 文档读取，否则 LibreOffice 默认走 Draw 路径，无 DOCX 导出筛选器
      const args = [
        '--headless',
        '--infilter=writer_pdf_import',
        '--convert-to', 'docx',
        '--outdir', dir,
        pdfPath,
      ];
      const proc = spawn(SOFFICE_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`soffice exited ${code}: ${stderr}`));
      });
    });
    return await readFile(path.join(dir, 'in.docx'));
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

router.get('/:id/docx', async (req: Request, res: Response) => {
  try {
    const r = await pool.query('SELECT order_no, final_typst FROM reports WHERE id = $1', [req.params.id]);
    if (!r.rows.length) { res.status(404).json({ error: 'Not found' }); return; }
    const compileResult = await compileTypst(r.rows[0].final_typst);
    const docx = await convertPdfToDocx(compileResult.pdf);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="report-${r.rows[0].order_no}.docx"`,
    });
    res.send(docx);
  } catch (err: any) {
    if (err instanceof RenderBusyError) { res.set('Retry-After', '3').status(503).json({ error: err.message }); return; }
    res.status(500).json({ error: err.message, hint: '需要本机安装 LibreOffice：brew install --cask libreoffice，或设置 SOFFICE_BIN 环境变量' });
  }
});

/** PUT /api/reports/:id — 二次编辑保存
 *
 * 两种模式：
 *  - 结构化编辑（P2）：传 content_doc → 服务端按实例文档重渲染 final_typst，标记 edited=true。
 *    record_data 永不回写——所有改动只落在 content_doc。
 *  - 原始 Typst 编辑（旧）：传 final_typst / blocks_snapshot 直接覆盖。
 */
router.put('/:id', async (req: Request, res: Response) => {
  if (!await assertEditLease(req, res, 'report_instance', String(req.params.id))) return;
  const { final_typst, blocks_snapshot, content_doc } = req.body;

  if (content_doc) {
    const prev = await pool.query('SELECT content_doc, content_doc_original, is_cover_draft FROM reports WHERE id = $1', [req.params.id]);
    if (!prev.rows.length) { res.status(404).json({ error: '报告不存在' }); return; }
    if (prev.rows[0].is_cover_draft && hasContinuousText(content_doc)) {
      res.status(400).json({ error: '公共首页草稿需要保留字段绑定，请在生成后的报告中编辑连续正文。' }); return;
    }
    // 保存时以当前库中图片为兜底，防止客户端局部编辑快照遗漏图片数据导致整段图片被清空。
    const safeContentDoc = preserveImageState(prev.rows[0].content_doc, content_doc);
    // Reviews refer only to the immutable generation snapshot, never report-edited source ctx.
    safeContentDoc.source_review_revision = prev.rows[0].content_doc_original?.source_review_revision;
    safeContentDoc.source_reviews = validSourceReviews(prev.rows[0].content_doc_original, content_doc.source_reviews);
    let rendered: string;
    try {
      rendered = renderContentDoc(safeContentDoc);
    } catch (e: any) {
      res.status(400).json({ error: '实例文档渲染失败：' + e.message });
      return;
    }
    // 与上一版 content_doc 比较，留痕本次改了哪些字段
    const diff = diffContentDocValues(prev.rows[0].content_doc, safeContentDoc);
    await pool.query(
      `UPDATE reports SET content_doc = $1::jsonb, final_typst = $2, edited = true, version = version + 1
       WHERE id = $3`,
      [JSON.stringify(safeContentDoc), rendered, req.params.id]
    );
    if (diff.length) {
      await writeReportAudit(Number(req.params.id), 'edit', reportActor(req), diff,
        `结构化编辑 ${diff.length} 处`);
    }
    if (JSON.stringify(prev.rows[0].content_doc?.source_reviews || []) !== JSON.stringify(safeContentDoc.source_reviews)) {
      await writeReportAudit(Number(req.params.id), 'edit', reportActor(req), [], `更新原始数据结构核对状态（已核对 ${safeContentDoc.source_reviews.length} 张表）`);
    }
    res.json({ ok: true, edited: true, changes: diff.length, content_doc: safeContentDoc });
    return;
  }

  await pool.query(
    `UPDATE reports SET
       final_typst = COALESCE($1, final_typst),
       blocks_snapshot = COALESCE($2::jsonb, blocks_snapshot),
       version = version + 1
     WHERE id = $3`,
    [final_typst || null, blocks_snapshot ? JSON.stringify(blocks_snapshot) : null, req.params.id]
  );
  res.json({ ok: true });
});

/**
 * POST /api/reports/apply-cover — 把订单【首页草稿】的首页套用到选定的已生成报告并重渲染。
 *  body: { order_no, report_ids: number[] }。
 *  只替换各报告的 cover.groups（结构/图片 image_photos/手改字面量）+ cover 样式 theme_config；
 *  保留各报告自己的 cover.ctx（报告号/样品/结论汇总）、header_footer、projects——binding/结论表按各报告 ctx 重解析，
 *  故"首页编辑应用到所有报告、但每份报告的数据仍是自己的"。哪些报告套用由调用方（前端勾选）决定（可跳过单独编辑过的）。
 */
router.post('/apply-cover', async (req: Request, res: Response) => {
  const { order_no, report_ids } = req.body || {};
  if (!order_no || !Array.isArray(report_ids) || !report_ids.length) {
    res.status(400).json({ error: 'order_no / report_ids 必填' }); return;
  }
  const draftRes = await pool.query(
    'SELECT content_doc FROM reports WHERE order_no = $1 AND is_cover_draft = true LIMIT 1', [order_no]);
  const draftCover = draftRes.rows[0]?.content_doc?.cover;
  if (hasContinuousText({ cover: draftCover })) {
    res.status(400).json({ error: '首页草稿含有固定报告正文，不能批量应用，以免覆盖其他报告的样品信息。' }); return;
  }
  if (!draftCover) { res.status(404).json({ error: '本订单没有首页草稿，无法套用' }); return; }

  const out: Array<{ id: number; ok: boolean; error?: string }> = [];
  for (const rid of report_ids) {
    try {
      const r = await pool.query(
        'SELECT content_doc, external_status FROM reports WHERE id = $1 AND order_no = $2 AND is_cover_draft = false', [rid, order_no]);
      const row = r.rows[0];
      const cd = row?.content_doc;
      if (!cd || !cd.cover) { out.push({ id: rid, ok: false, error: '报告不存在或无实例文档' }); continue; }
      // 兜底：已送审未退回的报告是终态，首页改动不得覆盖它（前端也已过滤，这里防异常调用）。
      // 报告退回(report_edit)的 external_status='external_revision' 且可编辑，可被套用；
      // 数据退回(data_entry)锁定的报告同为 'external_revision' 但不可编辑——一并拦下。
      if (row.external_status === 'submitted_external') {
        out.push({ id: rid, ok: false, error: '已送审报告不可套用首页（如需修改请先退回该报告）' }); continue;
      }
      const lock = await pool.query(
        `SELECT 1 FROM rework_tickets t
          WHERE t.target_stage = 'data_entry' AND t.status <> 'resolved'
            AND (t.report_id = $1 OR t.record_data_id = ANY(SELECT unnest(record_data_ids) FROM reports WHERE id = $1))
          LIMIT 1`, [rid]);
      if (lock.rows.length) {
        out.push({ id: rid, ok: false, error: '该报告正等待实验室数据重新审核，暂不可套用首页' }); continue;
      }
      // 换首页结构/图片/样式，保留本报告的 ctx / 页眉页脚 / 项目段。
      // 首页原样照片（image 分区）存于草稿 cover.ctx.record_raw_data（按字段 code），不在 groups 里——
      // 须把草稿的这些照片并入本报告首页 ctx.record_raw_data，否则套用后首页照片会丢（显示空）。
      const draftCoverPhotos = pickCoverImageRawData(draftCover);
      // 使用全新对象而非原地修改数据库驱动返回的 JSON；项目段始终从原报告完整保留。
      const nextDoc = {
        ...jsonClone(cd),
        cover: {
        ...jsonClone(cd.cover),
        groups: jsonClone(draftCover.groups || []),
        layout_options: {
          ...(cd.cover.layout_options || {}),
          theme_config: draftCover.layout_options?.theme_config ?? cd.cover.layout_options?.theme_config,
        },
        ctx: {
          ...(cd.cover.ctx || {}),
          record_raw_data: { ...((cd.cover.ctx || {}).record_raw_data || {}), ...draftCoverPhotos },
        },
        },
        // 明确保留项目段，防止首页草稿（cover-only）结构被误当作完整文档保存。
        projects: jsonClone(cd.projects || []),
      };
      const safeDoc = preserveImageState(cd, nextDoc);
      const finalTypst = renderContentDoc(safeDoc);
      await pool.query(
        'UPDATE reports SET content_doc = $1::jsonb, final_typst = $2, edited = true, version = version + 1 WHERE id = $3',
        [JSON.stringify(safeDoc), finalTypst, rid]);
      await writeReportAudit(rid, 'edit', reportActor(req), [], '套用首页草稿（结构/图片/样式）');
      out.push({ id: rid, ok: true });
    } catch (e: any) {
      out.push({ id: rid, ok: false, error: e?.message || String(e) });
    }
  }
  res.json({ results: out, applied: out.filter(x => x.ok).length });
});

/**
 * GET /api/reports/:id/scope-candidates — 列出本报告所属订单可纳入的全部「样品 × 项目」候选，
 * 并标记当前报告已包含哪些。供实例编辑器「调整样品/项目」弹窗勾选。
 * 候选来源为整单全部审核通过的原始记录 × 关联项目模板；同时保留当前报告已经使用的组合，
 * 这样旧报告即使来源记录/模板后来变更，也不会在“调整范围”中凭空消失。
 */
router.get('/:id/scope-candidates', async (req: Request, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT r.order_no, r.scope, r.external_status, r.is_cover_draft,
              EXISTS (
                SELECT 1 FROM report_requisitions rq
                 WHERE rq.report_id = r.id AND rq.delivery_status = 'sent'
              ) AS delivered
         FROM reports r WHERE r.id = $1`,
      [req.params.id],
    );
    if (!r.rows.length) { res.status(404).json({ error: 'Not found' }); return; }
    const { order_no, scope, external_status, is_cover_draft, delivered } = r.rows[0];
    // 项目模板的新版只能自动带入“未送审、仍在生成/编辑阶段”的报告。
    // 已回传、外部审核中/已通过，以及外部退回修改的报告都保留生成时的模板快照，
    // 后者只允许用户针对退回意见手动改，不接受模板自动刷新。
    const templateRefreshAllowed = !is_cover_draft && !delivered
      && (!external_status || external_status === 'none');
    const includedRecIds = new Set<number>(((scope?.record_data_ids) || []).map((x: any) => Number(x)));
    const scopedAssignments = Array.isArray(scope?.project_assignments) ? scope.project_assignments : [];
    const hasScopedPairs = scopedAssignments.some((x: any) => x?.record_data_id && x?.project_template_id);
    const includedPairs = new Set<string>(
      scopedAssignments
        .map((x: any) => `${Number(x.record_data_id)}:${Number(x.project_template_id)}`),
    );
    const includedVersionByPair = new Map<string, number | null>(scopedAssignments
      .filter((x: any) => x?.record_data_id && x?.project_template_id)
      .map((x: any) => [
        `${Number(x.record_data_id)}:${Number(x.project_template_id)}`,
        x.project_template_version_id == null ? null : Number(x.project_template_version_id),
      ]));
    const approvedCandidates = await deriveApprovedAssignments(order_no, false, true);
    const currentCandidates = (Array.isArray(scope?.project_assignments) ? scope.project_assignments : [])
      .filter((x: any) => x?.record_data_id && x?.project_template_id)
      .map((x: any) => ({
        record_data_id: Number(x.record_data_id),
        project_template_id: Number(x.project_template_id),
      }));
    // 兼容项目组合快照上线前生成的旧报告：它们只有两组平行 id 数组。
    // 当长度一致时按下标还原；单项目模板时复用这一模板，避免旧报告的调整弹窗变成空白。
    if (!currentCandidates.length) {
      const legacyRecIds = Array.isArray(scope?.record_data_ids) ? scope.record_data_ids : [];
      const legacyTplIds = Array.isArray(scope?.project_template_ids) ? scope.project_template_ids : [];
      legacyRecIds.forEach((recordId: any, index: number) => {
        const templateId = legacyTplIds[index] ?? (legacyTplIds.length === 1 ? legacyTplIds[0] : null);
        if (recordId && templateId) currentCandidates.push({
          record_data_id: Number(recordId), project_template_id: Number(templateId),
        });
      });
    }
    const pairMap = new Map<string, { record_data_id: number; project_template_id: number }>();
    [...approvedCandidates, ...currentCandidates].forEach((candidate) => {
      pairMap.set(`${Number(candidate.record_data_id)}:${Number(candidate.project_template_id)}`, candidate);
    });
    // 即使某条已审核原始记录尚未关联/生效项目模板，也要作为“待配置项目”展示。
    // 用户可先把它纳入报告范围（首页样品信息随之更新），待模板就绪后再补充项目明细页。
    const allReviewed = await pool.query(
      `SELECT id, sample_external_id, test_item_name FROM record_data
        WHERE order_no=$1 AND audit_status='reviewed' AND cancelled_at IS NULL ORDER BY id`, [order_no]);
    const recordsWithTemplate = new Set(approvedCandidates.map(c => Number(c.record_data_id)));
    for (const record of allReviewed.rows) {
      if (!recordsWithTemplate.has(Number(record.id))) {
        pairMap.set(`${Number(record.id)}:0`, { record_data_id: Number(record.id), project_template_id: 0 });
      }
    }
    const candidates = [...pairMap.values()];
    if (!candidates.length) { res.json({ order_no, candidates: [] }); return; }

    const recIds = candidates.map(c => c.record_data_id);
    const projIds = [...new Set(candidates.map(c => c.project_template_id))];
    const recRes = await pool.query(
      `SELECT rd.id, rd.tester_name, rd.sample_external_id, rd.test_item_name, rt.name AS method_name FROM record_data rd LEFT JOIN record_templates rt ON rt.id=rd.template_id WHERE rd.id = ANY($1)`, [recIds]);
    const recById = new Map<number, any>(recRes.rows.map((x: any) => [Number(x.id), x]));
    const projRes = await pool.query(
      `SELECT t.id, t.name, t.current_version_id, cv.layout_options
         FROM report_templates t
         LEFT JOIN report_template_versions cv ON cv.id = t.current_version_id
        WHERE t.id = ANY($1)`, [projIds]);
    const projById = new Map<number, any>(projRes.rows.map((x: any) => [Number(x.id), x]));
    // 样品名/样品号：从委托单 payload.samples 按 sample_external_id 回查（与 buildReportTypst 同口径）
    const wo = await pool.query('SELECT payload FROM work_orders WHERE order_no = $1', [order_no]);
    const samples: any[] = Array.isArray(wo.rows[0]?.payload?.samples) ? wo.rows[0].payload.samples : [];
    const sampleById = new Map<string, any>();
    const sampleByName = new Map<string, any>();
    for (const s of samples) { if (s.id != null) sampleById.set(String(s.id), s); if (s.name) sampleByName.set(String(s.name), s); }

    const out = candidates.map(c => {
      const rec = recById.get(Number(c.record_data_id)) || {};
      const proj = projById.get(Number(c.project_template_id)) || {};
      const sid = rec.sample_external_id;
      const sInfo = sampleById.get(String(sid)) || sampleByName.get(String(sid)) || {};
      const pendingTemplate = Number(c.project_template_id) === 0;
      const projName = rec.test_item_name
        || (pendingTemplate ? '测试项目' : ((proj.layout_options?.project_name) || proj.name || `项目#${c.project_template_id}`));
      const pairKey = `${Number(c.record_data_id)}:${Number(c.project_template_id)}`;
      const pendingNowReady = Array.isArray(scope?.selected_record_data_ids)
        && scope.selected_record_data_ids.map(Number).includes(Number(c.record_data_id))
        && !scopedAssignments.some((a: any) => Number(a.record_data_id) === Number(c.record_data_id) && Number(a.project_template_id) > 0)
        && approvedCandidates.find(a => Number(a.record_data_id) === Number(c.record_data_id))?.project_template_id === c.project_template_id;
      const included = hasScopedPairs
        ? includedPairs.has(pairKey) || pendingNowReady
        : includedRecIds.has(Number(c.record_data_id))
          || (Array.isArray(scope?.selected_record_data_ids) && scope.selected_record_data_ids.map(Number).includes(Number(c.record_data_id)));
      const selectedVersionId = includedVersionByPair.get(pairKey) ?? null;
      const currentVersionId = proj.current_version_id == null ? null : Number(proj.current_version_id);
      return {
        record_data_id: c.record_data_id,
        project_template_id: c.project_template_id,
        project_name: projName,
        sample_name: sInfo.name || rec.sample_external_id || '',
        sample_no: sInfo.sort_no != null ? String(sInfo.sort_no) : '',
        test_item_name: rec.test_item_name || '',
        tester_name: rec.tester_name || '',
        method_name: rec.method_name || '',
        needs_template: pendingTemplate,
        included,
        project_template_version_id: currentVersionId,
        selected_project_template_version_id: selectedVersionId,
        // 历史报告未记录版本 id 时也视为需刷新：自动重建一次后即会补齐快照。
        template_updated: templateRefreshAllowed && included && !pendingTemplate && !!currentVersionId
          && selectedVersionId !== currentVersionId,
      };
    });
    res.json({
      order_no,
      candidates: out,
      template_refresh_allowed: templateRefreshAllowed,
      template_refresh_blocked_reason: templateRefreshAllowed ? null : '报告已送审或已进入外部流程，保留生成时的项目模板快照',
    });
  } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
});

/**
 * POST /api/reports/:id/rescope — 调整本报告纳入的样品/项目并按新范围重算。
 *  body: { assignments: [{ record_data_id, project_template_id, enabled?, title?, page_break? }] }
 * 行为：用新 assignments 重跑 buildReportTypst（首页结构沿用本报告当前 cover.groups，故版面/图片/手改首页字面量保留；
 *      但 ctx 重解析 → 首页检测结论表、设备表、各项目段按新范围重算）。这是「重算」语义：会丢弃本报告对【项目段】
 *      的手动逐字编辑（前端已弹窗确认）。重算后 edited 复位、原始快照(content_doc_original)同步为新基线。
 */
router.post('/:id/rescope', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: '非法 id' }); return; }
  const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : null;
  const refreshFromTemplate = req.body?.refresh_from_template === true;
  if (!assignments) { res.status(400).json({ error: 'assignments 必填' }); return; }
  const selected = assignments.filter((a: any) => a && a.enabled !== false && a.record_data_id);
  if (!selected.length) { res.status(400).json({ error: '至少选择一个样品/项目' }); return; }
  const enabled = selected.filter((a: any) => Number(a.project_template_id) > 0);
  try {
    const r = await pool.query(
      `SELECT r.order_no, r.cover_template_id, r.content_doc, r.scope,
              r.external_status, r.is_cover_draft,
              EXISTS (
                SELECT 1 FROM report_requisitions rq
                 WHERE rq.report_id = r.id AND rq.delivery_status = 'sent'
              ) AS delivered
         FROM reports r WHERE r.id = $1`, [id]);
    if (!r.rows.length) { res.status(404).json({ error: 'Not found' }); return; }
    const row = r.rows[0];
    if (refreshFromTemplate && (row.is_cover_draft || row.delivered
        || (row.external_status && row.external_status !== 'none'))) {
      res.status(409).json({
        error: '该报告已送审或已进入外流程，不会因项目模板变化而修改',
        code: 'submitted_report_template_snapshot_locked',
      });
      return;
    }
    // 非模板自动刷新的人工调整也不能越过正常送审终态；
    // external_revision 是外部明确退回后的可编辑例外，但上面已禁止它被“模板自动刷新”。
    if (!refreshFromTemplate && (row.external_status === 'submitted_external'
        || row.external_status === 'external_approved'
        || (row.delivered && row.external_status !== 'external_revision'))) {
      res.status(409).json({ error: '已送审报告不能调整样品/项目范围' });
      return;
    }
    // 只接受本订单当前可用（审核通过）的组合，或本报告已有的历史组合；避免客户端任意拼接记录/模板。
    const approved = await deriveApprovedAssignments(row.order_no, false, true);
    const reviewedRecords = await pool.query(
      `SELECT id, sample_external_id FROM record_data WHERE order_no=$1 AND audit_status='reviewed' AND cancelled_at IS NULL`, [row.order_no]);
    const reviewedRecordIds = new Set(reviewedRecords.rows.map((x: any) => Number(x.id)));
    const existing = Array.isArray(row.scope?.project_assignments) ? row.scope.project_assignments : [];
    const legacyExisting = existing.length ? [] : (Array.isArray(row.scope?.record_data_ids) ? row.scope.record_data_ids : [])
      .map((recordId: any, index: number) => {
        const templateIds = Array.isArray(row.scope?.project_template_ids) ? row.scope.project_template_ids : [];
        const templateId = templateIds[index] ?? (templateIds.length === 1 ? templateIds[0] : null);
        return templateId ? { record_data_id: recordId, project_template_id: templateId } : null;
      })
      .filter(Boolean);
    const allowed = new Set([...approved, ...existing, ...legacyExisting]
      .filter((a: any) => a?.record_data_id && a?.project_template_id)
      .map((a: any) => `${Number(a.record_data_id)}:${Number(a.project_template_id)}`));
    if (enabled.some((a: any) => !allowed.has(`${Number(a.record_data_id)}:${Number(a.project_template_id)}`))
      || selected.some((a: any) => !reviewedRecordIds.has(Number(a.record_data_id)))) {
      res.status(409).json({ error: '所选样品/项目不在本订单可用范围内，请刷新后重试' }); return;
    }
    // 重算已确认覆盖人工正文：恢复来源绑定，不能保留冻结的旧样品文字。
    const coverGroups = row.content_doc?.cover?.groups?.map(restoreContinuousSource) || null;
    // 沿用本报告原有订单级展示值（客户名/样品名/收样日期），避免重算后这些 order 级字段被清空。
    const prevOrder = row.content_doc?.cover?.ctx?.order || {};
    const mockContext = {
      customer_name: prevOrder.customer_name,
      sample_name: prevOrder.sample_name,
      received_at: prevOrder.received_at,
    };
    const selectedRecordIds = [...new Set(selected.map((a: any) => Number(a.record_data_id)))];
    const selectedRecordRows = reviewedRecords.rows.filter((record: any) => selectedRecordIds.includes(Number(record.id)));
    const orderRes = await pool.query('SELECT payload FROM work_orders WHERE order_no=$1', [row.order_no]);
    const orderSamples: any[] = Array.isArray(orderRes.rows[0]?.payload?.samples) ? orderRes.rows[0].payload.samples : [];
    const selectedSampleIds = new Set(selectedRecordRows.map((record: any) => String(record.sample_external_id)));
    const reportSamples = orderSamples.filter((sample: any) => selectedSampleIds.has(String(sample?.id)) || selectedSampleIds.has(String(sample?.name)))
      .map((sample: any, index: number) => ({
        no: sample?.sort_no != null ? String(sample.sort_no) : String(index + 1), name: sample?.name || '',
        sort_no: sample?.sort_no != null ? String(sample.sort_no) : '', model: sample?.model || '',
        barcode: sample?.barcode || '', id: sample?.id != null ? String(sample.id) : undefined,
      }));
    // Template refresh and scope changes preserve each retained project's
    // instance pagination choice unless the request explicitly changes it.
    for (const assignment of enabled) {
      if (typeof assignment.page_break === 'boolean') continue;
      const project = row.content_doc?.projects?.find((p: any) =>
        Number(p.ctx?.source_record_data_id) === Number(assignment.record_data_id));
      assignment.page_break = project?.page_break !== false;
    }
    const built = await buildReportTypst({
      order_no: row.order_no,
      cover_template_id: row.cover_template_id,
      project_assignments: enabled,
      mock_context: mockContext,
      // 重建只能复用这份报告生成时冻结的接口 1.2 元数据，不能在 server 模式掉回示例值或清空页眉页脚。
      report_meta: row.content_doc?.cover?.ctx?.report_meta || null,
      cover_groups_override: coverGroups,
      report_samples: reportSamples,
    });
    const { finalTypst, contentDoc, warnings, assignmentTplIds, assignmentRecIds } = built;

    let compiled = false;
    try { await compileTypst(finalTypst); compiled = true; }
    catch (e: any) { warnings.push({ type: 'compile_failed', detail: e.message }); }

    const versionRows = assignmentTplIds.length ? await pool.query(
      'SELECT id, current_version_id FROM report_templates WHERE id = ANY($1)', [assignmentTplIds],
    ) : { rows: [] as any[] };
    const currentVersionByTemplate = new Map<number, number | null>(versionRows.rows.map((template: any) => [
      Number(template.id), template.current_version_id == null ? null : Number(template.current_version_id),
    ]));
    const scope = {
      sample_label: row.scope?.sample_label ?? null,
      record_data_ids: assignmentRecIds,
      project_template_ids: assignmentTplIds,
      project_assignments: enabled.map((a: any) => ({
        record_data_id: Number(a.record_data_id),
        project_template_id: Number(a.project_template_id),
        project_template_version_id: currentVersionByTemplate.get(Number(a.project_template_id)) ?? null,
        title: a.title || null,
        page_break: a.page_break !== false,
      })),
      selected_record_data_ids: selectedRecordIds,
    };
    const docJson = contentDoc ? JSON.stringify(contentDoc) : null;
    await pool.query(
      `UPDATE reports SET content_doc = $1::jsonb, content_doc_original = $1::jsonb, final_typst = $2,
         scope = $3::jsonb, project_template_ids = $4, record_data_ids = $5, edited = false, version = version + 1, warnings = $7::jsonb
       WHERE id = $6`,
      [docJson, finalTypst, JSON.stringify(scope), assignmentTplIds, assignmentRecIds, id, JSON.stringify(warnings)]);
    await writeReportAudit(id, 'edit', reportActor(req), [], `调整样品/项目范围并重算（${assignmentRecIds.length} 个项目）`);
    res.json({ ok: true, warnings, compiled });
  } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
});

/** POST /api/reports/preview-content-doc — 实例编辑实时预览（不入库） */
router.post('/preview-content-doc', async (req: Request, res: Response) => {
  const { content_doc } = req.body;
  if (!content_doc) { res.status(400).json({ error: 'content_doc 必填' }); return; }
  try {
    const rendered = renderContentDoc(content_doc);
    const compileResult = await compileTypst(rendered);
    res.set({ 'Content-Type': 'application/pdf', 'X-Compile-Duration-Ms': String(compileResult.duration_ms) });
    res.send(compileResult.pdf);
  } catch (err: any) {
    if (err instanceof RenderBusyError) { res.set('Retry-After', '3').status(503).json({ error: err.message }); return; }
    res.status(500).json({ error: err.message });
  }
});

export default router;
