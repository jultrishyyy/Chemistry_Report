/**
 * mock-data.ts — 为模板编辑器预览生成示例数据
 *
 * 规则：
 * - 如果字段有 example_value，优先使用
 * - 否则按字段类型自动生成合理的示例值
 * - 矩阵字段生成完整的 cells + 公式计算结果
 */
import type { RecordTemplate, FieldDefinition, DataMatrixConfig } from './types';
import { matrixDataKey, createEmptyMatrixValue, flattenMatrixValuesToFlatData, applyMatrixCellFormulas, applyMatrixSummaryFormulas, applyPerCellFormulas } from './matrix-flatten';
import { execute, topologicalOrder } from './formula-engine';
import { sampleAxesKey } from './free-grid-samples';
import { formatDateByPrecision } from './date-precision';
import { freeGridTextDefault } from './free-grid-defaults';

/**
 * 示例图片目录【占位符】（不写死任何机器路径，可跨服务器部署）。
 *
 * mock 数据把图片 `server_path` 设成 `${MOCK_IMAGE_DIR}/xxx.png`，这串最终被嵌进 typst 源码里。
 * 由于 typst 源码是在【浏览器端】用本 shared 代码生成的，浏览器无从得知服务器上 samples 目录的真实位置，
 * 所以这里只放一个占位符；真正的磁盘绝对路径在【服务端编译 typst 时】由 typst-compiler 把本占位符替换成
 * 该服务器上的 `samples/sample-images` 绝对路径（见 server/src/services/typst-compiler.ts 的 resolveSamplePaths）。
 */
export const MOCK_IMAGE_DIR = '__SAMPLE_IMAGES__';

/** 一张示例照片（ImageItem 形状）。供模板编辑器预览的图片表/图库填样图。 */
export function mockPhotoItem(fname = 'before.png', alt = '示例-原样照片.png') {
  return { name: fname, server_path: `${MOCK_IMAGE_DIR}/${fname}`, url: '', original_name: alt };
}

function randomNum(min: number, max: number, decimals = 1): number {
  const v = min + Math.random() * (max - min);
  return Number(v.toFixed(decimals));
}

function mockFieldValue(field: FieldDefinition, idx = 0): any {
  if (field.example_value !== undefined && field.example_value !== null && field.example_value !== '') {
    return field.example_value;
  }

  switch (field.type) {
    case 'number':
      return randomNum(10, 100);
    case 'text':
      return field.default_value || `示例文本${idx ? idx : ''}`;
    case 'textarea':
      return field.default_value || '示例多行文本内容';
    case 'date':
      return formatDateByPrecision(new Date(), field.date_precision || 'day', field.date_separator || '-');
    case 'select':
      return field.options?.[0] || '选项A';
    case 'checkbox':
      return field.options?.slice(0, 2) || ['选项A', '选项B'];
    case 'device_ref':
      // 预览期示例设备：对象带 name+code，展平时显示「设备名称：管理编号」（真实录入只存管理编号数组，
      // 由 deviceMap 反查名称）。
      return [
        { code: 'SHHX2018-G244(1-2)', name: '固相萃取真空装置' },
        { code: 'HX2007-G025', name: '电子分析天平' },
      ];
    case 'computed':
      return null; // will be computed later
    case 'image': {
      // 示例图片：按 image_phase（存量）或字段名里的关键字挑样图，缺省 before
      const lbl = field.label || '';
      const fname = (field.image_phase === 'during' || lbl.includes('中')) ? 'during.png'
        : (field.image_phase === 'after' || lbl.includes('后')) ? 'after.png' : 'before.png';
      return [{ name: fname, server_path: `${MOCK_IMAGE_DIR}/${fname}`, url: '', original_name: `示例-${lbl}.png` }];
    }
    case 'variant_list': {
      if (!field.variants?.length) return [];
      const v = field.variants[0];
      const values: Record<string, any> = {};
      if (v.render === 'inline_fields' && v.fields) {
        for (const sf of v.fields) {
          values[sf.code] = mockFieldValue(sf);
        }
      }
      return [{ variant_id: v.id, values }];
    }
    case 'data_matrix':
      return null; // handled separately
    default:
      return field.default_value || '';
  }
}

function mockMatrixValue(cfg: DataMatrixConfig): any {
  const v = createEmptyMatrixValue(cfg);
  for (let si = 0; si < v.sample_ids.length; si++) {
    const sid = v.sample_ids[si];
    for (const p of v.parameters) {
      const hasColFormula = !!(p.cell_formula?.trim());
      if (hasColFormula) continue;
      // Leave last row partially empty to demonstrate dash display
      if (si === v.sample_ids.length - 1 && Math.random() > 0.5) continue;
      if (cfg.cell_type === 'number') {
        v.cells[matrixDataKey(sid, p.code)] = randomNum(5, 95);
      } else {
        v.cells[matrixDataKey(sid, p.code)] = '示例';
      }
    }
  }
  return v;
}

/**
 * 预览用：给 report_photo_table 字段（首页·原样照片表）填一张示例照片（仅当字段本身没有真实照片时）。
 * 照片存在字段定义里（field.photo_table.photos），所以用克隆模板的方式注入，供模板编辑器「示例数据」预览
 * 看到带样图的图片表。真实报告渲染不经过此函数（照片由文员上传，没传则显示「（无图片）」）。
 */
export function withMockPhotoTables(template: RecordTemplate): RecordTemplate {
  const mock = { name: 'before.png', server_path: `${MOCK_IMAGE_DIR}/before.png`, url: '', original_name: '示例-原样照片.png' };
  return {
    ...template,
    groups: (template.groups || []).map(g => ({
      ...g,
      fields: (g.fields || []).map(f => {
        if (f.type === 'report_photo_table' && !(f.photo_table?.photos?.length)) {
          return { ...f, photo_table: { ...(f.photo_table || {}), photos: [mock] } };
        }
        return f;
      }),
    })),
  };
}

/** 统一自由网格 free_grid 的预览示例值：按格类型生成（数字/选择/文字）；
 *  记录侧样品带（无 matrix_code）时按 N 个示例样品展开为 `${rowId}::${colId}::s${i}` + `__sample_count__`。 */
function mockFreeGridValue(ft: FieldDefinition['free_table']): Record<string, any> {
  const gv: Record<string, any> = {};
  if (!ft) return gv;
  const inputs = ft.input_cells || {};
  const types = ft.cell_types || {};
  const opts = ft.cell_options || {};
  // 记录侧样品带（多带·同轴，无 matrix_code = 自引用）：每带按 N 个示例样品展开成员行/列
  const norm = ft.sample_bands?.length
    ? ft.sample_bands.filter(b => b?.refs?.length)
    : (ft.sample_band?.ref ? [{ id: 'legacy', axis: ft.sample_band.axis, refs: [ft.sample_band.ref], matrix_code: ft.sample_band.matrix_code }] : []);
  const selfBands = norm.filter(b => !b.matrix_code);
  const bandOfAxisId = new Map<string, { id: string; axis: string; refs: string[]; cross_refs?: string[] }>();
  for (const b of selfBands) for (const rid of b.refs) if (!bandOfAxisId.has(rid)) bandOfAxisId.set(rid, b);
  const numFmt = ft.cell_number_fmt || {};
  const rounding = ft.cell_rounding || {};
  const hasTableNumFmt = !!ft.default_number_fmt;
  const hasTableRounding = !!ft.default_rounding;
  let ni = 0; // 数字示例计数器：让不同格/不同样品的示例数字有差异（不用随机，保证可复现）
  const exampleFor = (key: string): string => {
    const o = opts[key]; // 选择框格（含表头选择框）：用首个选项，否则预览会空白无法渲染
    if (o && o.length) return o[0];
    const t = types[key];
    if (t === 'text') return freeGridTextDefault(ft, key) || '示例';
    // 保留足够原始精度和 5 临界位，让修约与显示格式变化在预览里肉眼可见；实际修约/格式化由统一渲染器完成。
    if (t === 'number' || numFmt[key] || rounding[key] || hasTableNumFmt || hasTableRounding) {
      const base = 10.125 + (ni++ * 6.37125) % 88;
      return base.toFixed(5);
    }
    return '示例';
  };
  // 多个模板试样行／列各用 s0 槽位；单行／列原型生成三个不同槽位。显式轴列表决定显示数量。
  const countForBand = (b: { refs: string[] }) => (b.refs.length > 1 ? 1 : 3);
  // 录入格 + 选择框格（后者含未标为录入的表头选择框，需一并给示例值）
  const numericFixed = Object.keys(ft.fixed_text_cells || {}).filter(key =>
    types[key] === 'number' && !(ft.cells?.[key] || '').trim());
  const keysToFill = new Set([...Object.keys(inputs), ...Object.keys(opts), ...numericFixed]);
  for (const key of keysToFill) {
    const [rid, cid] = key.split('::');
    const b = bandOfAxisId.get(rid) || bandOfAxisId.get(cid);   // 行带 refs=行 id 命中 rid；列带 refs=列 id 命中 cid
    const inExactBand = !!b && (b.axis === 'row'
      ? (!b.cross_refs?.length || b.cross_refs.includes(cid))
      : (!b.cross_refs?.length || b.cross_refs.includes(rid)));
    if (b && inExactBand) { const N = countForBand(b); for (let i = 0; i < N; i++) gv[`${rid}::${cid}::s${i}`] = exampleFor(key); }
    else gv[key] = exampleFor(key);
  }
  for (const b of selfBands) {
    // Use the same explicit sample slots as record entry. Multiple template axes
    // are individual samples, not a single block containing every axis.
    const entries = b.refs.length > 1 ? b.refs.map(ref => ({ ref, sample: 0 }))
      : Array.from({ length: countForBand(b) }, (_, sample) => ({ ref: b.refs[0], sample }));
    gv[sampleAxesKey(b.id)] = entries;
    gv[`__sample_count__::${b.id}`] = entries.length;
  }
  return gv;
}

/** 生成「原始（嵌套）」示例数据 = record_data.raw_data 的形状（字段 code → 原始值/矩阵值对象）。
 *  与 generateMockData 不同：后者返回展平+派生后的显示数据；本函数返回未展平的原始录入值。 */
export function generateMockRawData(template: RecordTemplate): Record<string, any> {
  const data: Record<string, any> = {};
  for (const g of (template.groups || [])) {
    for (const f of g.fields) {
      if (f.type === 'spacer') {
        continue; // 版式间隔无数据
      } else if (f.type === 'data_matrix' && f.matrix) {
        data[f.code] = mockMatrixValue(f.matrix);
      } else if (f.type === 'free_grid') {
        // 统一网格：仅录入格填示例值（按格类型：数字给示例数字/选择给首个选项/文字给"示例"）
        data[f.code] = mockFreeGridValue(f.free_table);
      } else if (f.type !== 'computed') {
        data[f.code] = mockFieldValue(f);
      }
    }
  }
  return data;
}

export function generateMockData(template: RecordTemplate): Record<string, any> {
  // 容错：groups 缺失（如关联了尚无字段的原始记录）时归一为空数组，避免下游 flatten/公式迭代崩溃
  const t: RecordTemplate = template.groups ? template : { ...template, groups: [] };
  const data = generateMockRawData(t);

  // Flatten matrix values and compute formulas
  let flat = flattenMatrixValuesToFlatData(t, data);
  flat = applyMatrixCellFormulas(t, flat);
  flat = applyPerCellFormulas(t, flat);
  flat = applyMatrixSummaryFormulas(t, flat);

  // Compute derived fields
  const allFields = (t.groups || []).flatMap(g => g.fields);
  const computedFields = allFields.filter(f => f.type === 'computed' && f.formula);
  const ordered = topologicalOrder(computedFields.map(f => ({ code: f.code, formula: f.formula! })));
  const result: Record<string, any> = { ...flat };
  for (const code of ordered) {
    const field = computedFields.find(f => f.code === code);
    if (field?.formula) {
      try {
        result[code] = execute(field.formula, result);
      } catch {
        result[code] = '—';
      }
    }
  }

  // Merge computed values back
  for (const f of computedFields) {
    if (f.example_value !== undefined && f.example_value !== null && f.example_value !== '') {
      result[f.code] = f.example_value;
    } else {
      data[f.code] = result[f.code];
    }
  }

  // Return the full flat data (includes matrix flat keys + scalar fields + computed)
  return result;
}
