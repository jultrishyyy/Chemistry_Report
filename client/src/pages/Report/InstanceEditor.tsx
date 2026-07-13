/**
 * 报告结构化编辑（P2）
 *
 * 生成后的报告是一份自包含「实例文档」(content_doc = cover + projects，每个 groups + 冻结 ctx)。
 * 文员在这里像填表一样改任意字段的值、增删字段、增删结果表的行——
 * 所有改动只落在 content_doc，永不回写 record_data。
 *
 * 实现要点：改值 = 把该字段/单元格的 binding 改为 {source:'literal', text}，
 * 再调 /preview-content-doc（不入库）实时预览，保存走 PUT {content_doc}（服务端重渲染）。
 */
import { useEffect, useState, useRef, useMemo, useCallback, Fragment, type ReactNode } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Button, message, Spin, Tag, Space, Alert, Input, InputNumber, Card, Empty, Tooltip, Divider, Popover, Dropdown, List,
  Select as AntSelect, Upload, Segmented, ColorPicker, Modal, Checkbox,
} from 'antd';
import {
  SaveOutlined, ArrowLeftOutlined, PlusOutlined, DeleteOutlined, RollbackOutlined,
  WarningOutlined, FontColorsOutlined, ArrowUpOutlined, ArrowDownOutlined, LinkOutlined,
  BoldOutlined, ItalicOutlined, AlignLeftOutlined, AlignCenterOutlined, AlignRightOutlined, BgColorsOutlined, SettingOutlined, TableOutlined,
  VerticalAlignBottomOutlined, UnorderedListOutlined, DoubleLeftOutlined, EyeOutlined, DownloadOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { resolveBinding, flattenContentDocValues, diffContentDocValues, renderContentDoc, buildFreeTableFromField, formatDateRange } from '../../../../shared/typst-generator';
import type { FieldDefinition, FieldGroup, CellBinding, StyleOverride } from '../../../../shared/types';
import FormatPanel from '../../components/FieldEditor/FormatPanel';
import DocumentStylePanel from '../../components/FieldEditor/DocumentStylePanel';
import { isSignatureGroup } from '../../components/FieldEditor/section-presets';
import TypstViewer, { type TypstViewerHandle } from '../../components/TypstViewer';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import EditorSplit from '../../components/EditorSplit';
import ReadonlyRecordViewer from '../../components/ReadonlyRecordViewer';
import ImageLayoutControls from '../../components/FieldEditor/ImageLayoutControls';
import ImageSectionPanel from '../../components/FieldEditor/ImageSectionPanel';
import ImageSectionNotes from '../../components/FieldEditor/ImageSectionNotes';
import { migrateGalleryGroups } from '../../components/FieldEditor/migrateImageGallery';

const API = '/api';

interface Section {
  name: string;
  title?: string;
  page_break?: boolean;
  groups: FieldGroup[];
  layout_options?: Record<string, any>;
  ctx: any;
}
interface ContentDoc {
  cover: Section;
  projects: Section[];
}

const lit = (text: string): CellBinding => ({ source: 'literal', text });
const NORMAL_TYPES = new Set(['text', 'number', 'date', 'textarea', 'select', 'checkbox']);
// 设备表 / 图片表仍自动（结构编辑见后续）；检测结论表已可编辑（见 ConclusionTableEditor），不在此列。
const REPORT_AUTO_TYPES = new Set(['report_image_gallery']);
// 三类报告表共用统一「自由编辑表格」（free_table 置位后走同一个纯文本网格编辑器）
const TABLE_FREE_TYPES = new Set(['report_result_table', 'report_conclusion_table', 'report_equipment_table', 'report_sample_table']);
// 不设「字段间距」的字段类型（表格/图片/空行——它们间距随文档样式·字段间距，不单独配）
const FIELD_GAP_EXCLUDED = new Set(['report_result_table', 'report_conclusion_table', 'report_equipment_table', 'report_sample_table', 'report_photo_table', 'report_image_gallery', 'image', 'data_matrix', 'spacer']);
// 支持「表格上方标签 + 表格下方备注」编辑卡（与图片同款）的报告表格类型。
const LABELCAP_TYPES = new Set(['report_result_table', 'report_equipment_table', 'report_sample_table', 'report_conclusion_table', 'report_photo_table', 'report_image_gallery']);

let uid = 0;
const newId = (p: string) => `${p}_${Date.now()}_${uid++}`;

/** 新建"内容"字段（分区里插入 / 顶部工具栏「添加内容」共用同一份定义，避免两处漂移）。 */
type InsertKind = 'spacer' | 'paragraph' | 'heading' | 'note' | 'photo_table' | 'image';
function makeContentField(kind: InsertKind): FieldDefinition {
  const code = newId(kind);
  if (kind === 'heading') return { id: code, code, label: '小标题', type: 'text', hide_label: true, style: { weight: 'bold', size: '13pt' }, binding: lit('小标题') } as FieldDefinition;
  if (kind === 'paragraph') return { id: code, code, label: '段落', type: 'text', hide_label: true, rich: true, binding: lit('') } as FieldDefinition;
  if (kind === 'spacer') return { id: code, code, label: '空行', type: 'spacer', hide_label: true, spacer_height: '1em' } as FieldDefinition;
  if (kind === 'photo_table') return { id: code, code, label: '原样照片表', type: 'report_photo_table', hide_label: true, photo_table: { caption_label: '样品描述', caption_text: '见原始样品照片。', header: '原始样品', cols: 1 } } as FieldDefinition;
  if (kind === 'image') return { id: code, code, label: '图片', type: 'image', image_layout: 'loose', allow_multiple: true } as FieldDefinition;
  return { id: code, code, label: '说明', type: 'text', binding: lit('') } as FieldDefinition;
}
/** 「添加内容」下拉的可选项（工具栏 + 分区内插入点共用）。 */
const INSERT_MENU_ITEMS = [
  { key: 'note', label: '说明字段（标签：值）' },
  { key: 'paragraph', label: '段落（正文，无标签）' },
  { key: 'heading', label: '小标题（加粗大字）' },
  { key: 'spacer', label: '空行 / 间距（↕ 留白）' },
  { key: 'photo_table', label: '原样照片表（上传照片）' },
  { key: 'image', label: '图片（每行一张/多张）' },
];

/**
 * 统一「字段配置块」外壳：左侧彩色强调条 + 浅灰标题栏（标题/类型标签/计数提示/右侧操作）+ 留白正文。
 * 让结果表 / 结论表 / 图库 / 照片表等特殊编辑器视觉一致、不再是各写各的拼贴框。
 */
function EditorBlock({ title, tag, hint, extra, accent = '#1677ff', children }: {
  title: ReactNode; tag?: ReactNode; hint?: ReactNode; extra?: ReactNode; accent?: string; children: ReactNode;
}) {
  return (
    <div style={{ border: '1px solid #eef0f4', borderRadius: 8, marginBottom: 8, background: '#fff', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#f7f9fc',
        borderBottom: '1px solid #eef0f4', borderLeft: `3px solid ${accent}`, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#33415c' }}>{title}</span>
        {tag}
        {hint && <span style={{ fontSize: 11, color: '#9aa4b2' }}>{hint}</span>}
        <div style={{ flex: 1 }} />
        {extra}
      </div>
      <div style={{ padding: 10 }}>{children}</div>
    </div>
  );
}

// 首页（报告封面，无原始记录）图片落盘子目录名，与后端 services/upload-paths.ts 的 COVER_DIR 一致。
const COVER_DIR = '_首页';

/**
 * 文员端·统一图片编辑（原样照片 photo_table / 项目图片 gallery 共用同一 UI）。
 *  - 标题模式：共用标题（一个标题 + 直接上传/选来源）/ 每张一个标题（每行：表内标题 + 单张图，可加行）。
 *  - 排版：每行 N 张 / 尺寸 / 单数独占(第一/最后，默认第一) / 行(独立框/粘连)。默认尺寸 7×6。
 *  - gallery：每张绑定原始记录 image 字段（来源），照片写 ctx.record_raw_data 快照。
 *  - photo_table：直接上传，照片写 field.photo_table（随 cover_groups_override carry）。
 */
/** 存量兼容：把 content_doc 里旧 `report_image_gallery` 图片分区就地迁成 image 字段分区（复用共享 migrateGalleryGroup）。 */
function normalizeContentDoc(cd: any): any {
  if (!cd) return cd;
  const mgGroups = (obj: any) => obj ? { ...obj, groups: migrateGalleryGroups(obj.groups || []) } : obj;
  return { ...cd, cover: mgGroups(cd.cover), projects: (cd.projects || []).map(mgGroups) };
}

/** 统一上传：图片落 <根>/<订单号>/_首页/<字段名>，返回 {server_path,...}。供 PhotoLayoutEditor / ImageSectionEditor 共用。 */
async function uploadImageFile(file: File, orderNo: string | undefined, fieldName: string): Promise<any | null> {
  try {
    const fd = new FormData(); fd.append('file', file);
    if (orderNo) fd.append('order_no', orderNo);
    fd.append('record_dir', COVER_DIR);
    fd.append('field_name', fieldName);
    const res = await fetch('/api/images/upload', { method: 'POST', body: fd });
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  } catch (e: any) { message.error('上传失败：' + (e.message || '')); return null; }
}

function PhotoLayoutEditor({ field, ctx, orderNo, kind, headerExtra, onMutate, onMutateCtx }: {
  field: FieldDefinition; ctx: any; orderNo?: string; kind: 'gallery' | 'photo_table' | 'image_field'; headerExtra?: ReactNode;
  onMutate: (fn: (f: FieldDefinition) => void) => void; onMutateCtx: (fn: (ctx: any) => void) => void;
}) {
  const hasSource = kind === 'gallery';
  const isImageField = kind === 'image_field';   // 首页 image 字段：配置散落在 field 顶层（image_*），照片在 field.image_photos
  const hasCaption = kind === 'photo_table';      // 仅原样照片表带「加粗标签 + 说明文字」说明行
  const cfgKey = hasSource ? 'image_gallery' : 'photo_table';
  // 统一 cfg 视图：image_field 映射到 field 顶层 image_* 属性；其余读 field[cfgKey] 子对象。
  const cfg: any = isImageField
    ? { title_mode: field.image_title_mode, cols: field.image_cols, width_cm: field.image_size?.width_cm, height_cm: field.image_size?.height_cm, solo: field.image_solo, seamless: field.image_seamless, header_follow: field.image_header_follow, inset_x: field.image_inset_x, inset_y: field.image_inset_y, title_inset_y: field.image_title_inset_y, photos: field.image_photos, items: field.image_items }
    : ((field as any)[cfgKey] || {});
  const setCfg = isImageField
    ? (patch: any) => onMutate(f => {
        if ('cols' in patch) f.image_cols = patch.cols;
        if ('width_cm' in patch) f.image_size = { ...(f.image_size || {}), width_cm: patch.width_cm };
        if ('height_cm' in patch) f.image_size = { ...(f.image_size || {}), height_cm: patch.height_cm };
        if ('solo' in patch) f.image_solo = patch.solo;
        if ('seamless' in patch) f.image_seamless = patch.seamless;
        if ('header_follow' in patch) f.image_header_follow = patch.header_follow;
        if ('inset_x' in patch) f.image_inset_x = patch.inset_x;
        if ('inset_y' in patch) f.image_inset_y = patch.inset_y;
        if ('title_inset_y' in patch) f.image_title_inset_y = patch.title_inset_y;
        if ('title_mode' in patch) f.image_title_mode = patch.title_mode;
        if ('photos' in patch) f.image_photos = patch.photos;
        if ('items' in patch) f.image_items = patch.items;
      })
    : (patch: any) => onMutate(f => { (f as any)[cfgKey] = { ...((f as any)[cfgKey] || {}), ...patch }; });
  const titleMode: 'shared' | 'per' = cfg.title_mode || (hasSource ? 'per' : 'shared');
  const sharedTitle = hasSource ? (cfg.shared_title ?? '') : (isImageField ? (field.label ?? '') : (cfg.header ?? ''));
  const setSharedTitle = (v: string) => isImageField ? onMutate(f => { f.label = v; }) : setCfg(hasSource ? { shared_title: v } : { header: v });

  const recImgFields: any[] = (ctx?.linked_record_template?.groups || []).flatMap((g: any) => g.fields || []).filter((f: any) => f.type === 'image');
  const rawData: any = ctx?.record_raw_data || {};
  const photosOf = (code: string): any[] => Array.isArray(rawData[code]) ? rawData[code] : [];
  const imgOptions = recImgFields.map(f => ({ value: f.code, label: `${f.label || f.code}（${photosOf(f.code).length} 张）` }));
  const photoSrc = (p: any) => p ? (p.url || p.server_path) : undefined;

  const upload = (file: File, fieldName: string) => uploadImageFile(file, orderNo, fieldName);

  // gallery 来源照片（单张：替换/删除，写 ctx）
  const galReplace = async (code: string, file: File) => { if (!code) { message.warning('请先绑定来源'); return false; } const d = await upload(file, recImgFields.find(f => f.code === code)?.label || code); if (d) onMutateCtx(c => { const rd = c.record_raw_data || (c.record_raw_data = {}); rd[code] = [d]; }); return false; };
  const galClear = (code: string) => onMutateCtx(c => { if (c.record_raw_data) c.record_raw_data[code] = []; });

  // 共用模式·直接多图上传（photo_table → field.photo_table.photos；image_field → field.image_photos）
  const ptPhotos: any[] = Array.isArray(cfg.photos) ? cfg.photos : [];
  const ptAdd = async (file: File) => {
    const d = await upload(file, field.label || field.code);
    if (d) {
      if (isImageField) onMutate(f => { f.image_photos = [...(Array.isArray(f.image_photos) ? f.image_photos : []), d]; });
      else onMutate(f => { const c = ((f as any).photo_table = { ...((f as any).photo_table || {}) }); c.photos = [...(Array.isArray(c.photos) ? c.photos : []), d]; });
    }
    return false;
  };
  const ptDel = (i: number) => setCfg({ photos: ptPhotos.filter((_: any, k: number) => k !== i) });
  const ptMove = (i: number, dir: -1 | 1) => { const t = i + dir; if (t < 0 || t >= ptPhotos.length) return; const n = [...ptPhotos]; [n[i], n[t]] = [n[t], n[i]]; setCfg({ photos: n }); };

  // 每张一个标题模式的行（items）
  const items: any[] = Array.isArray(cfg.items) ? cfg.items : [];
  const setItems = (next: any[]) => setCfg({ items: next });
  const updItem = (id: string, patch: any) => setItems(items.map(it => it.id === id ? { ...it, ...patch } : it));
  const addItem = () => setItems([...items, hasSource ? { id: newId('gi'), source_field_code: recImgFields[0]?.code || '', label: '' } : { id: newId('pi'), label: '', photos: [] }]);
  const rmItem = (id: string) => setItems(items.filter(it => it.id !== id));
  const mvItem = (idx: number, dir: -1 | 1) => { const t = idx + dir; if (t < 0 || t >= items.length) return; const n = [...items]; [n[idx], n[t]] = [n[t], n[idx]]; setItems(n); };
  const itemReplace = async (id: string, file: File) => { const d = await upload(file, field.label || field.code); if (d) updItem(id, { photos: [d] }); return false; };
  const itemClear = (id: string) => updItem(id, { photos: [] });

  // 标题模式切换（photo_table 尽量保留已上传照片）
  const switchMode = (mode: 'shared' | 'per') => {
    if (mode === titleMode) return;
    if (!hasSource && mode === 'per' && !items.length && ptPhotos.length) setCfg({ title_mode: 'per', items: ptPhotos.map((p: any, i: number) => ({ id: `pi_${i}_${p.server_path || ''}`.slice(0, 40), label: '', photos: [p] })) });
    else if (!hasSource && mode === 'shared' && !ptPhotos.length && items.length) setCfg({ title_mode: 'shared', photos: items.flatMap(it => Array.isArray(it.photos) ? it.photos : []) });
    else setCfg({ title_mode: mode });
  };

  // 单张照片（替换/删除）——纯渲染函数，避免子组件重挂载
  const singlePhoto = (src: string | undefined, onReplace: (file: File) => any, onClear: () => void) => (
    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
      {src ? (
        <div style={{ position: 'relative', width: 64, height: 64, border: '1px solid #ddd', borderRadius: 4, overflow: 'hidden' }}>
          <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={onClear} style={{ position: 'absolute', top: 0, right: 0, padding: 0, width: 18, height: 18, background: 'rgba(255,255,255,0.85)' }} />
        </div>
      ) : <div style={{ width: 64, height: 64, border: '1px dashed #ccc', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 11 }}>无图</div>}
      <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => onReplace(file as File)}>
        <Button size="small" icon={<PlusOutlined />}>{src ? '替换' : '上传'}</Button>
      </Upload>
    </div>
  );

  return (
    <EditorBlock title={`${field.label || (hasSource ? '检测图片' : isImageField ? '图片' : '原样照片')} · 排版`} accent="#722ed1" extra={headerExtra}
      tag={<Tag color="purple">{hasSource ? '图库' : isImageField ? '文员上传' : '原样照片'}</Tag>}>
      <ImageLayoutControls value={cfg} onChange={setCfg} onTitleModeChange={switchMode} />

      {titleMode === 'shared' ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#888' }}>共用标题</span>
            <Input size="small" style={{ width: 180 }} placeholder="表内标题(空=不显示)" value={sharedTitle}
              onChange={(e) => setSharedTitle(e.target.value)} />
            {hasCaption && <>
              <Input size="small" style={{ width: 130 }} placeholder="加粗标签(如样品描述)" value={cfg.caption_label ?? ''} onChange={(e) => setCfg({ caption_label: e.target.value })} />
              <Input size="small" style={{ width: 180 }} placeholder="说明文字(如见原始样品照片。)" value={cfg.caption_text ?? ''} onChange={(e) => setCfg({ caption_text: e.target.value })} />
            </>}
          </div>
          {hasSource ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map((it, idx) => (
                <div key={it.id} style={{ border: '1px solid #eee', borderRadius: 6, padding: 6, background: '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: '#999' }}>{idx + 1}</span>
                    <span style={{ fontSize: 11, color: it.source_field_code ? '#389e0d' : '#d48806' }}><LinkOutlined /> 来源</span>
                    <AntSelect size="small" style={{ width: 180 }} value={it.source_field_code || undefined} options={imgOptions} status={it.source_field_code ? undefined : 'warning'} placeholder="绑定来源" onChange={(v) => updItem(it.id, { source_field_code: v })} />
                    <div style={{ flex: 1 }} />
                    <Button size="small" type="text" disabled={idx === 0} onClick={() => mvItem(idx, -1)}><ArrowUpOutlined /></Button>
                    <Button size="small" type="text" disabled={idx === items.length - 1} onClick={() => mvItem(idx, 1)}><ArrowDownOutlined /></Button>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => rmItem(it.id)} />
                  </div>
                  {it.source_field_code && singlePhoto(photoSrc(photosOf(it.source_field_code)[0]), (file) => galReplace(it.source_field_code, file), () => galClear(it.source_field_code))}
                </div>
              ))}
              <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addItem} disabled={!recImgFields.length}>添加来源</Button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {ptPhotos.map((p, i) => (
                <div key={i} style={{ position: 'relative', width: 64, height: 64, border: '1px solid #ddd', borderRadius: 4, overflow: 'hidden' }}>
                  <img src={photoSrc(p)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => ptDel(i)} style={{ position: 'absolute', top: 0, right: 0, padding: 0, width: 18, height: 18, background: 'rgba(255,255,255,0.85)' }} />
                  {ptPhotos.length > 1 && (
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.8)' }}>
                      <span onClick={() => ptMove(i, -1)} style={{ cursor: 'pointer', fontSize: 12, padding: '0 5px' }}>‹</span>
                      <span onClick={() => ptMove(i, 1)} style={{ cursor: 'pointer', fontSize: 12, padding: '0 5px' }}>›</span>
                    </div>
                  )}
                </div>
              ))}
              <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => ptAdd(file as File)}>
                <Button size="small" icon={<PlusOutlined />} style={{ width: 64, height: 64 }} title="上传照片" />
              </Upload>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((it, idx) => (
            <div key={it.id} style={{ border: '1px solid #eee', borderRadius: 6, padding: 6, background: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: '#999' }}>{idx + 1}</span>
                {hasSource && <>
                  <span style={{ fontSize: 11, color: it.source_field_code ? '#389e0d' : '#d48806' }}><LinkOutlined /> 来源</span>
                  <AntSelect size="small" style={{ width: 160 }} value={it.source_field_code || undefined} options={imgOptions} status={it.source_field_code ? undefined : 'warning'} placeholder="绑定来源" onChange={(v) => updItem(it.id, { source_field_code: v })} />
                </>}
                <Input size="small" style={{ width: 160 }} placeholder="表内标题(空=不显示)" value={it.label ?? ''} onChange={(e) => updItem(it.id, { label: e.target.value })} />
                <div style={{ flex: 1 }} />
                <Button size="small" type="text" disabled={idx === 0} onClick={() => mvItem(idx, -1)}><ArrowUpOutlined /></Button>
                <Button size="small" type="text" disabled={idx === items.length - 1} onClick={() => mvItem(idx, 1)}><ArrowDownOutlined /></Button>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => rmItem(it.id)} />
              </div>
              {hasSource
                ? (it.source_field_code && singlePhoto(photoSrc(photosOf(it.source_field_code)[0]), (file) => galReplace(it.source_field_code, file), () => galClear(it.source_field_code)))
                : singlePhoto(photoSrc((it.photos || [])[0]), (file) => itemReplace(it.id, file), () => itemClear(it.id))}
            </div>
          ))}
          <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addItem} disabled={hasSource && !recImgFields.length}>添加{hasSource ? '来源' : '图片'}</Button>
        </div>
      )}
    </EditorBlock>
  );
}


/**
 * 生成报告·图片分区编辑（section_role='images' + image 字段）——与原始记录/项目模板同一心智：
 * 每个 image 字段＝一个图位；照片写 ctx.record_raw_data[image_source_code||code]（模板绑定的来源先带出，文员可直接改）。
 * 不显示「来源」；每张标题模式每图一行(左=表内标题输入)、共用标题模式无逐图标题；底部永远「添加图片」（空、可上传）。
 * 版式/大标题/上方标签/下方备注在分区右上角「图片版式 / 格式(A)」两个 Popover 里（在 GroupEditor 头部）。
 */
function ImageSectionEditor({ group, ctx, orderNo, onMutateGroup, onMutateCtx }: {
  group: FieldGroup; ctx: any; orderNo?: string;
  onMutateGroup: (fn: (g: FieldGroup) => void) => void;
  onMutateCtx: (fn: (ctx: any) => void) => void;
}) {
  const titleMode = (group.image_layout?.title_mode) || 'per';
  const codeOf = (f: FieldDefinition) => f.image_source_code || f.code;
  const photosOf = (f: FieldDefinition) => { const a = ctx?.record_raw_data?.[codeOf(f)]; return Array.isArray(a) ? a : []; };
  const setPhotos = (f: FieldDefinition, photos: any[]) => onMutateCtx(c => { const rd = c.record_raw_data || (c.record_raw_data = {}); rd[codeOf(f)] = photos; });
  const photoSrc = (p: any) => p ? (p.url || p.server_path) : undefined;
  const addPhoto = async (f: FieldDefinition, file: File) => { const d = await uploadImageFile(file, orderNo, f.label || f.code); if (d) setPhotos(f, [...photosOf(f), d]); return false; };
  const delPhoto = (f: FieldDefinition, i: number) => setPhotos(f, photosOf(f).filter((_: any, k: number) => k !== i));
  const imgIdxs = group.fields.map((f, i) => ({ f, i })).filter(x => x.f.type === 'image');
  const setLabel = (i: number, v: string) => onMutateGroup(g => { g.fields[i].label = v; });
  const removeField = (i: number) => onMutateGroup(g => { g.fields.splice(i, 1); });
  const moveField = (i: number, dir: -1 | 1) => onMutateGroup(g => { const t = i + dir; if (t < 0 || t >= g.fields.length) return; const n = g.fields; [n[i], n[t]] = [n[t], n[i]]; });
  const addImageField = () => onMutateGroup(g => { const c = newId('img'); g.fields.push({ id: c, code: c, label: '', type: 'image' } as FieldDefinition); });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {imgIdxs.map(({ f, i }, ord) => {
        const photos = photosOf(f);
        return (
          <div key={f.id} style={{ border: '1px solid #eee', borderRadius: 6, padding: 6, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: '#999' }}>{ord + 1}</span>
              {titleMode === 'per' && (
                <Input size="small" style={{ width: 200 }} placeholder="表内标题(空=不显示)" value={f.label ?? ''}
                  onChange={(e) => setLabel(i, e.target.value)} />
              )}
              <div style={{ flex: 1 }} />
              <Button size="small" type="text" disabled={ord === 0} onClick={() => moveField(i, -1)}><ArrowUpOutlined /></Button>
              <Button size="small" type="text" disabled={ord === imgIdxs.length - 1} onClick={() => moveField(i, 1)}><ArrowDownOutlined /></Button>
              <Tooltip title="删除本图位"><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeField(i)} /></Tooltip>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {photos.map((p: any, k: number) => (
                <div key={k} style={{ position: 'relative', width: 64, height: 64, border: '1px solid #ddd', borderRadius: 4, overflow: 'hidden' }}>
                  <img src={photoSrc(p)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => delPhoto(f, k)}
                    style={{ position: 'absolute', top: 0, right: 0, padding: 0, width: 18, height: 18, background: 'rgba(255,255,255,0.85)' }} />
                </div>
              ))}
              <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => addPhoto(f, file as File)}>
                <Button size="small" icon={<PlusOutlined />} style={{ width: 64, height: 64 }} title="上传照片" />
              </Upload>
            </div>
          </div>
        );
      })}
      <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addImageField}>添加图片</Button>
    </div>
  );
}

/** 首页 image 图片字段：套用统一图片编辑器（kind='image_field'，无来源；所有项均在面板内编辑，无「详细编辑」抽屉）。 */
function ImageFieldEditor({ field, orderNo, onMutate }: { field: FieldDefinition; orderNo?: string; onMutate: (fn: (f: FieldDefinition) => void) => void }) {
  return (
    <PhotoLayoutEditor field={field} ctx={undefined} orderNo={orderNo} kind="image_field" onMutate={onMutate} onMutateCtx={() => {}} />
  );
}

/** 首页·样品信息表：自动从委托单样品(ctx.order_samples)列出 样品编号/样品名称/零件号。列名可改；单样品(mode=auto)出报告时自动折叠，由首页直接字段显示。 */
function SampleTableEditor({ field, ctx, onMutate }: { field: FieldDefinition; ctx: any; onMutate: (fn: (f: FieldDefinition) => void) => void }) {
  const cfg: any = field.sample_table || {};
  const samples: any[] = Array.isArray(ctx?.order_samples) ? ctx.order_samples : [];
  const autoCollapse = (cfg.mode || 'auto') === 'auto' && samples.length <= 1; // 单样品 auto：出报告时自动折叠本表
  const notice = samples.length === 1
    ? <Alert type={autoCollapse ? 'info' : 'warning'} showIcon style={{ marginBottom: 6 }}
        message={autoCollapse
          ? '当前仅 1 个样品：本表出报告时会【自动折叠】，由首页「样品名称 / 零件号」字段直接显示，无需手动删除。（如需强制出表，到模板把「单/多样品」改为「始终显示」）'
          : '当前仅 1 个样品，且本表设为「始终显示」，会照样列出 1 行。改回「自动」可让单样品自动折叠。'} />
    : samples.length === 0 ? <div style={{ fontSize: 12, color: '#bbb', marginBottom: 6 }}>暂无样品（生成报告时按委托单自动列出）</div> : null;
  return <AutoTableBlock title={field.label || '样品信息表'} tag={<Tag color="blue">自动</Tag>} field={field} ctx={ctx} onMutate={onMutate} notice={notice} />;
}

export default function ReportInstanceEditor() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const id = searchParams.get('id');
  // 只读查看（已送审报告 / 历史版本）：隐藏保存/工具栏/调整/退回等编辑入口，左侧结构区禁交互，仅看结构 + 右侧 PDF。
  const readOnly = searchParams.get('readonly') === '1';
  const [doc, setDoc] = useState<ContentDoc | null>(null);
  // 最新 doc（ref 每次渲染同步）：保存时取它，防输入控件 onBlur 提交与点「保存」的竞态
  const docRef = useRef<ContentDoc | null>(null);
  docRef.current = doc;
  const [original, setOriginal] = useState<ContentDoc | null>(null);
  const [meta, setMeta] = useState<{ report_no?: string; order_no?: string; version?: number; edited?: boolean; coverOnly?: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // 未保存守卫：只读态豁免；「返回」与刷新/关页都受保护（此前返回直接跳走，未保存改动静默丢失）
  const { confirmLeave } = useUnsavedGuard(() => !readOnly && dirty);
  // 「应用到已生成报告」：套用本首页草稿到选定的已生成报告
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyTargets, setApplyTargets] = useState<any[]>([]);
  const [applySel, setApplySel] = useState<number[]>([]);
  const [applying, setApplying] = useState(false);
  const [applyInRework, setApplyInRework] = useState(false);   // 套用对话框是否处于「报告退回」场景（只套退回报告）
  const [applyPending, setApplyPending] = useState<any[]>([]);  // 已取号但尚未生成的报告——生成时自动套用当前首页，仅在弹窗中列出
  // ── 调整样品/测试项目范围（重选 → 重算；会丢弃项目段手改，首页结构/图片保留）──
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeCands, setScopeCands] = useState<any[]>([]);
  const [scopeSel, setScopeSel] = useState<Set<number>>(new Set());   // 选中的 record_data_id
  const [scopeLoading, setScopeLoading] = useState(false);
  const [rescoping, setRescoping] = useState(false);
  const [scopeSearch, setScopeSearch] = useState('');                 // 样品/项目搜索
  const [scopeCollapsed, setScopeCollapsed] = useState<Set<string>>(new Set());   // 收起的样品分组 key
  // ── 退回原始记录（文员发现数据有误 → 退回给主检重录重审）──
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnRecs, setReturnRecs] = useState<any[]>([]);   // 本报告引用的原始记录（scope-candidates 中 included）
  const [returnLoading, setReturnLoading] = useState(false);
  const [viewerRec, setViewerRec] = useState<{ id: number; subtitle: string } | null>(null);
  // 当前聚焦的字段（供顶部"浮动格式条"操作）
  const [focused, setFocused] = useState<{ key: string; gi: number; fi: number; label: string } | null>(null);
  // 右侧 PDF 预览句柄：选中左侧字段时把预览滚到对应位置（正向跳转，需 enableSync）。
  const viewerRef = useRef<TypstViewerHandle>(null);
  // 文字格式（加粗/斜体/字号/颜色）作用对象：字段名(label_style) 或 字段值(value_style)
  const [styleTarget, setStyleTarget] = useState<'label' | 'value'>('value');
  // 左侧大纲导航（可收起，持久化）——像原始记录模板编辑器一样快速跳到某段/某分区。
  const [outlineOpen, setOutlineOpen] = useState<boolean>(() => { try { return localStorage.getItem('instOutlineOpen') !== '0'; } catch { return true; } });
  const toggleOutline = () => setOutlineOpen(v => { const n = !v; try { localStorage.setItem('instOutlineOpen', n ? '1' : '0'); } catch { /* ignore */ } return n; });

  // 右侧预览：客户端用与模板编辑器同一套 renderContentDoc 算出 typst 源，交给 TypstViewer 渲染
  // （服务端 /preview-content-doc 也是调 renderContentDoc，口径一致）。TypstViewer 内部编译+保滚动+下载。
  const { source: typstSource, error: previewError } = useMemo(() => {
    if (!doc) return { source: '', error: null as string | null };
    // 首页草稿（cover-draft）：只渲染首页，不出项目检测明细页（projects 仍保留在 doc 里供结论表 ctx，
    // 但首页编辑只关心首页内容）。取号后的完整报告才渲染 cover + projects。
    const renderDoc = meta?.coverOnly ? { ...doc, projects: [] } : doc;
    try { return { source: renderContentDoc(renderDoc as any), error: null as string | null }; }
    catch (e: any) { return { source: '', error: (e?.message || String(e)) as string | null }; }
  }, [doc, meta?.coverOnly]);

  const loadReport = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API}/reports/${id}`);
      const cd = normalizeContentDoc(res.data.content_doc);
      if (!cd) { message.error('该报告没有可编辑的实例文档（可能是旧版报告）'); return; }
      setDoc(cd);
      setOriginal(normalizeContentDoc(res.data.content_doc_original) || cd);
      setMeta({ report_no: res.data.report_no, order_no: res.data.order_no, version: res.data.version, edited: res.data.edited, coverOnly: !!res.data.is_cover_draft });
      setDirty(false);
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { loadReport(); }, [loadReport]);

  // 与生成时的原始快照对比，找出"偏离原始数据"的字段
  const originalValues = original ? flattenContentDocValues(original) : {};
  const divergence = original && doc ? diffContentDocValues(original, doc) : [];
  const divergedPaths = new Set(divergence.map(d => d.path));

  /** 任意修改后：标脏 + 触发预览 */
  const mutate = (fn: (d: ContentDoc) => void) => {
    if (readOnly) return;   // 只读查看：任何改动都不生效（防御；UI 也已隐藏编辑入口 + 禁交互）
    setDoc(prev => {
      if (!prev) return prev;
      const next: ContentDoc = JSON.parse(JSON.stringify(prev));
      fn(next);
      docRef.current = next;   // 渲染前先同步 ref，保证同一事件里紧跟的保存拿到新值
      return next;
    });
    setDirty(true);
  };

  // ── 调整样品/测试项目范围 ──
  const openScope = async () => {
    setScopeOpen(true); setScopeLoading(true); setScopeSearch(''); setScopeCollapsed(new Set());
    try {
      const res = await axios.get(`${API}/reports/${id}/scope-candidates`);
      const cands: any[] = res.data?.candidates || [];
      setScopeCands(cands);
      setScopeSel(new Set(cands.filter(c => c.included).map(c => Number(c.record_data_id))));
    } catch { message.error('加载候选样品/项目失败'); setScopeCands([]); }
    finally { setScopeLoading(false); }
  };
  const toggleScope = (recId: number) => setScopeSel(prev => {
    const n = new Set(prev); if (n.has(recId)) n.delete(recId); else n.add(recId); return n;
  });
  // 候选按【样品】分组：一个样品 → 其下多个测试项目（每项 = 一条审核通过的原始记录）。
  // 搜索命中样品名 → 显示该样品全部项目；命中项目名 → 只显示匹配的项目。
  const scopeGroups = useMemo(() => {
    const q = scopeSearch.trim().toLowerCase();
    const map = new Map<string, { key: string; sample_no?: string; sample_name: string; items: any[] }>();
    for (const c of scopeCands) {
      const key = `${c.sample_no ?? ''}||${c.sample_name ?? ''}`;
      if (!map.has(key)) map.set(key, { key, sample_no: c.sample_no, sample_name: c.sample_name || '样品', items: [] });
      map.get(key)!.items.push(c);
    }
    let groups = [...map.values()];
    if (q) {
      groups = groups.map(g => {
        const sampleHit = g.sample_name.toLowerCase().includes(q) || String(g.sample_no ?? '').toLowerCase().includes(q);
        const items = sampleHit ? g.items : g.items.filter(c =>
          String(c.project_name ?? '').toLowerCase().includes(q) || String(c.test_item_name ?? '').toLowerCase().includes(q));
        return { ...g, items };
      }).filter(g => g.items.length);
    }
    return groups;
  }, [scopeCands, scopeSearch]);
  // 样品级勾选：选/清该样品下全部测试项目。
  const setSampleGroup = (items: any[], on: boolean) => setScopeSel(prev => {
    const n = new Set(prev);
    for (const c of items) { const rid = Number(c.record_data_id); if (on) n.add(rid); else n.delete(rid); }
    return n;
  });
  const toggleScopeCollapse = (key: string) => setScopeCollapsed(prev => {
    const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n;
  });

  // ── 退回原始记录：列出本报告引用的原始记录，文员选其一查看并退回给主检 ──
  const openReturn = async () => {
    setReturnOpen(true); setReturnLoading(true);
    try {
      const res = await axios.get(`${API}/reports/${id}/scope-candidates`);
      setReturnRecs((res.data?.candidates || []).filter((c: any) => c.included));
    } catch { message.error('加载本报告原始记录失败'); setReturnRecs([]); }
    finally { setReturnLoading(false); }
  };
  const doRescope = async () => {
    if (!scopeSel.size) { message.warning('至少选择一个样品/项目'); return; }
    setRescoping(true);
    try {
      const assignments = scopeCands.map(c => ({
        record_data_id: c.record_data_id,
        project_template_id: c.project_template_id,
        enabled: scopeSel.has(Number(c.record_data_id)),
      }));
      const res = await axios.post(`${API}/reports/${id}/rescope`, { assignments });
      if (res.data?.warnings?.length) message.warning(`已更新本报告，但有 ${res.data.warnings.length} 条提示`);
      else message.success('已按新范围更新本报告');
      setScopeOpen(false);
      await loadReport();
    } catch (e: any) { message.error('更新失败：' + (e.response?.data?.error || e.message)); }
    finally { setRescoping(false); }
  };

  // ── 顶部"浮动格式条"：作用于当前聚焦字段 ──
  const groupAt = (d: ContentDoc, key: string, gi: number) =>
    (key === 'cover' ? d.cover : d.projects[Number(key.slice(4))]).groups[gi];
  const focusedField = (): FieldDefinition | null => {
    if (!focused || !doc) return null;
    try { return groupAt(doc, focused.key, focused.gi).fields[focused.fi] || null; } catch { return null; }
  };
  const setFocusedStyle = (patch: Record<string, any>) => {
    if (!focused) return;
    mutate(d => {
      const f = groupAt(d, focused.key, focused.gi).fields[focused.fi];
      const next: any = { ...(f.style || {}), ...patch };
      Object.keys(next).forEach(k => { if (next[k] == null || next[k] === '') delete next[k]; });
      f.style = Object.keys(next).length ? next : undefined;
    });
  };
  const fStyle = (): any => focusedField()?.style || {};
  // 文字样式写进 label_style / value_style（块级 f.style 不渲染加粗/斜体/颜色，必须写到这两套文字样式上）
  const partKey = (part: 'label' | 'value') => (part === 'label' ? 'label_style' : 'value_style');
  const partStyle = (part: 'label' | 'value'): any => (focusedField() as any)?.[partKey(part)] || {};
  const setFocusedPart = (part: 'label' | 'value', patch: Record<string, any>) => {
    if (!focused) return;
    mutate(d => {
      const f: any = groupAt(d, focused.key, focused.gi).fields[focused.fi];
      const k = partKey(part);
      const next: any = { ...(f[k] || {}), ...patch };
      Object.keys(next).forEach(key => { if (next[key] == null || next[key] === '') delete next[key]; });
      f[k] = Object.keys(next).length ? next : undefined;
    });
  };
  const bumpPartSize = (part: 'label' | 'value', delta: number) => {
    const cur = parseFloat(String(partStyle(part).size || '')) || 11;
    setFocusedPart(part, { size: `${Math.max(6, Math.min(48, cur + delta))}pt` });
  };
  const clearFocusedAll = () => {
    if (!focused) return;
    mutate(d => { const f: any = groupAt(d, focused.key, focused.gi).fields[focused.fi]; f.style = undefined; f.label_style = undefined; f.value_style = undefined; });
  };
  const hasAnyStyle = () => { const f: any = focusedField(); return !!(f && (f.style || f.label_style || f.value_style)); };
  // 「添加内容」：在选中字段下方插入一个内容字段（未选中则追加到当前段末尾兜底）。替代各分区末尾的「在末尾插入内容」。
  const insertContentAtFocused = (kind: InsertKind) => {
    if (!focused) { message.info('先选中一个字段，新内容会插在它下方'); return; }
    mutate(d => {
      const arr = groupAt(d, focused.key, focused.gi).fields;
      arr.splice(focused.fi + 1, 0, makeContentField(kind));
    });
  };
  // 「强制分页」：切换选中字段的 page_break_before——本字段从新的一页开始。
  const toggleFocusedPageBreak = () => {
    if (!focused) return;
    mutate(d => { const f = groupAt(d, focused.key, focused.gi).fields[focused.fi]; f.page_break_before = f.page_break_before ? undefined : true; });
  };
  // 顶部公共栏：对当前选中字段做 上移/下移/删除/有名无名/整字段格式（替代每行的小按钮，列表更干净）
  const moveFocused = (dir: -1 | 1) => {
    if (!focused) return;
    let moved = false;
    mutate(d => {
      const arr = groupAt(d, focused.key, focused.gi).fields;
      const j = focused.fi + dir;
      if (j < 0 || j >= arr.length) return;
      [arr[focused.fi], arr[j]] = [arr[j], arr[focused.fi]];
      moved = true;
    });
    if (moved) setFocused(f => (f ? { ...f, fi: f.fi + dir } : f));
  };
  const deleteFocused = () => {
    if (!focused) return;
    mutate(d => { groupAt(d, focused.key, focused.gi).fields.splice(focused.fi, 1); });
    setFocused(null);
  };
  const toggleFocusedHideLabel = () => {
    if (!focused) return;
    mutate(d => { const f = groupAt(d, focused.key, focused.gi).fields[focused.fi]; f.hide_label = f.hide_label ? undefined : true; });
  };
  const setFocusedFullStyle = (style: StyleOverride | undefined) => {
    if (!focused) return;
    mutate(d => { groupAt(d, focused.key, focused.gi).fields[focused.fi].style = style; });
  };
  // 字段级「字段间距」（仅普通文字字段；覆盖文档样式·字段间距，留空＝跟随文档）
  const setFocusedFieldGap = (gap: string | undefined) => {
    if (!focused) return;
    mutate(d => { (groupAt(d, focused.key, focused.gi).fields[focused.fi] as any).field_gap = gap; });
  };
  // 选中字段是否可上移/下移（末尾/首位禁用）
  const focusedFieldsLen = (): number => {
    if (!focused || !doc) return 0;
    try { return groupAt(doc, focused.key, focused.gi).fields.length; } catch { return 0; }
  };

  const handleSave = async (): Promise<boolean> => {
    const d = docRef.current;   // 最新状态（防 onBlur 提交与点保存的竞态）
    if (!d || !id) return false;
    setSaving(true);
    try {
      await axios.put(`${API}/reports/${id}`, { content_doc: d });
      message.success('已保存');
      setDirty(false);
      setMeta(m => m ? { ...m, edited: true, version: (m.version || 1) + 1 } : m);
      return true;
    } catch (e: any) {
      message.error('保存失败：' + (e.response?.data?.error || e.message));
      return false;
    } finally {
      setSaving(false);
    }
  };

  // 打开「应用到已生成报告」：先保存草稿（服务端按 DB 里的草稿套用），再拉本单已生成报告列表
  const openApply = async () => {
    if (!meta?.order_no) { message.warning('缺少订单号'); return; }
    if (dirty) { await handleSave(); }
    try {
      // 取【本单全部取号报告】(requisitions)＋【已生成报告】(reports)：取号报告才是"应用"的对象全集，
      // 已生成的立即重渲染套用，尚未生成的（无 report_id）在生成时自动套用当前首页（external 生成 carry）。
      const [repRes, reqRes] = await Promise.all([
        axios.get(`${API}/reports`, { params: { order_no: meta.order_no } }),
        axios.get(`${API}/external/requisitions`, { params: { order_no: meta.order_no } }),
      ]);
      const list = (repRes.data || []) as any[];
      const reqs = (reqRes.data || []) as any[];
      if (!list.length && !reqs.length) { message.info('本订单还没有取号报告'); return; }
      // 报告退回场景：首页改动只能套用到【被退回且可编辑】的报告——数据退回(data_entry)锁定的
      // 报告 external_status 同为 external_revision 但正等待数据重审、不可编辑，须排除（后端也拦）。
      // 正常场景：可套用到未送审的报告，但【已送审未退回】(submitted_external) 是终态、不可被首页覆盖。
      const anyRevision = list.some(r => r.external_status === 'external_revision');
      const reworked = list.filter(r => r.external_status === 'external_revision' && !r.data_rework_open);
      const inRework = anyRevision;
      const eligible = inRework
        ? reworked
        : list.filter(r => r.external_status !== 'submitted_external' && !r.data_rework_open);
      // 尚未生成的取号报告（无 report_id）：生成时自动套用当前首页；退回场景不涉及待生成，故仅正常场景列出。
      const pending = inRework ? [] : reqs.filter((rq: any) => !rq.report_id);
      setApplyPending(pending);
      // 全是待生成、没有可立即套用的已生成报告：无需弹窗勾选，保存首页即已覆盖全部（生成时自动套用）。
      if (!inRework && !eligible.length && pending.length) {
        message.success(`已保存首页；本订单 ${pending.length} 份取号报告将在生成时自动套用当前首页`);
        return;
      }
      if (!eligible.length) {
        message.info(inRework
          ? '被退回的报告正等待实验室数据重新审核，暂不可应用首页'
          : '本订单的报告都已送审，不能再用首页覆盖（如需修改请先退回该报告）');
        return;
      }
      setApplyInRework(inRework);
      setApplyTargets(eligible);
      // 退回场景：默认全选被退回报告（本就是要改它们）；正常场景：默认勾「未单独编辑过」的
      setApplySel(inRework ? eligible.map(r => r.id) : eligible.filter(r => !r.edited).map(r => r.id));
      setApplyOpen(true);
    } catch (e: any) { message.error('加载报告列表失败：' + (e.response?.data?.error || e.message)); }
  };
  const runApply = async () => {
    if (!meta?.order_no || !applySel.length) { setApplyOpen(false); return; }
    setApplying(true);
    try {
      const res = await axios.post(`${API}/reports/apply-cover`, { order_no: meta.order_no, report_ids: applySel });
      message.success(`已应用到 ${res.data.applied} 份已生成报告`
        + (applyPending.length ? `；另 ${applyPending.length} 份取号报告将在生成时自动套用` : ''));
      // 有报告被服务端跳过（已送审 / 数据退回锁定 等）时明确告知原因——否则看起来像"没生效"。
      const failed = ((res.data.results || []) as any[]).filter(r => !r.ok);
      if (failed.length) message.warning(`${failed.length} 份报告未应用：${failed[0].error}`, 6);
      setApplyOpen(false);
    } catch (e: any) { message.error('应用失败：' + (e.response?.data?.error || e.message)); }
    finally { setApplying(false); }
  };

  if (loading) return <Spin style={{ margin: '100px auto', display: 'block' }} />;
  if (!doc) return (
    <div style={{ padding: 24 }}>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/report')}>返回委托单列表</Button>
      <Empty style={{ marginTop: 40 }}
        description="此报告没有可编辑的实例文档。结构化编辑只支持新版（含 content_doc）的报告——请重新「生成报告」后再编辑。" />
    </div>
  );

  // 首页草稿只编辑首页；完整报告才列出各项目段
  const sections: Array<{ key: string; section: Section; path: 'cover' | number }> = [
    { key: 'cover', section: doc.cover, path: 'cover' },
    ...(meta?.coverOnly ? [] : doc.projects.map((p, i) => ({ key: `proj${i}`, section: p, path: i as number }))),
  ];

  // 返回：回到本单的报告详情页（工作台）；缺 order_no 才退回报告列表。有未保存改动时经守卫确认。
  const goBack = () => confirmLeave(
    () => navigate(meta?.order_no ? `/report/order/${encodeURIComponent(meta.order_no)}` : '/report'),
    handleSave,
  );

  // 大纲跳转：左侧编辑区滚到该段/分区锚点，同时右侧 PDF 预览滚到对应分区标记。
  const scrollToAnchor = (elId: string) => document.getElementById(elId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const outlineGoGroup = (secKey: string, gi: number, g: any) => {
    scrollToAnchor(`grp-${secKey}-${gi}`);
    if (g?.id) viewerRef.current?.scrollToMarker(`${secKey}::${g.id}`, `${secKey}::${g.id}`);
  };

  return (
    // height:100% 而非 100vh——本页在 AppNav 下方的 flex:1 容器内，用 100vh 会比容器高、导致整页滚动、顶栏被滚走。
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部工具条：sticky 固定，下滑不消失 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 30, padding: '8px 16px', borderBottom: '1px solid #d9d9d9', background: '#fff', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={goBack}>返回</Button>
        <Tooltip title={outlineOpen ? '收起大纲' : '展开大纲'}>
          <Button icon={<UnorderedListOutlined />} type={outlineOpen ? 'primary' : 'default'} ghost={outlineOpen} onClick={toggleOutline} />
        </Tooltip>
        <h3 style={{ margin: 0 }}>{readOnly ? '报告查看' : '报告结构化编辑'}</h3>
        {meta && <Tag color="blue" style={{ fontFamily: 'monospace' }}>{meta.report_no || meta.order_no}</Tag>}
        {readOnly && <Tag icon={<EyeOutlined />} color="default">只读查看</Tag>}
        {!readOnly && meta?.edited && <Tag color="orange">已编辑</Tag>}
        {!readOnly && divergence.length > 0 && (
          <Tag icon={<WarningOutlined />} color="red">偏离原始 {divergence.length} 处</Tag>
        )}
        {!readOnly && dirty && <Tag color="red">未保存</Tag>}
        <div style={{ flex: 1 }} />
        {!readOnly && meta?.coverOnly && (
          <Tooltip title="把本首页（结构/图片/样式）应用到本订单已取号的报告里——已生成的可勾选覆盖，尚未生成的取号报告会在生成时自动套用当前首页">
            <Button icon={<SettingOutlined />} onClick={openApply}>应用到已取号报告</Button>
          </Tooltip>
        )}
        {!readOnly && !meta?.coverOnly && meta?.order_no && (
          <Tooltip title="重新选择本报告包含的样品 / 测试项目；确认后按新范围重算（首页检测结论表随之变化）">
            <Button icon={<SettingOutlined />} onClick={openScope}>调整样品/项目</Button>
          </Tooltip>
        )}
        {!readOnly && !meta?.coverOnly && meta?.order_no && (
          <Tooltip title="发现某条原始记录数据有误？退回给主检（实验室工程师），主检在「实验室录入」修改并重走审核；通过后本报告按新数据重新生成">
            <Button danger icon={<RollbackOutlined />} onClick={openReturn}>退回原始记录</Button>
          </Tooltip>
        )}
        {!readOnly && <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>保存</Button>}
        {readOnly && (
          <Tooltip title="下载本报告 PDF">
            <Button icon={<DownloadOutlined />} onClick={() => id && window.open(`${API}/reports/${id}/pdf`, '_blank')}>PDF</Button>
          </Tooltip>
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', padding: 12, minHeight: 0 }}>
        <EditorSplit
          left={
        /* 左：可收起大纲 + 结构化编辑表单 */
        <div style={{ display: 'flex', height: '100%', gap: 8 }}>
        {outlineOpen && (
          <div style={{ width: 178, flexShrink: 0, overflowY: 'auto', borderRight: '1px solid #e3e8f1', paddingRight: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 2px 6px 6px' }}>
              <span style={{ fontSize: 11, color: '#8a94a6', fontWeight: 700, letterSpacing: 0.5 }}>大纲</span>
              <Tooltip title="收起大纲">
                <Button size="small" type="text" icon={<DoubleLeftOutlined />} onClick={toggleOutline} style={{ color: '#8a94a6' }} />
              </Tooltip>
            </div>
            {sections.map(({ key, section }) => (
              <div key={key} style={{ marginBottom: 8 }}>
                <div onClick={() => scrollToAnchor(`sec-${key}`)} title={key === 'cover' ? '首页' : (section.title || section.name)}
                  style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, color: key === 'cover' ? '#1366d9' : '#3d5aa8',
                    padding: '3px 6px', borderRadius: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {key === 'cover' ? '首页' : (section.title || section.name)}
                </div>
                {section.groups.map((g, gi) => (
                  <div key={g.id || gi} onClick={() => outlineGoGroup(key, gi, g)} title={g.label || '未命名分区'}
                    className="inst-outline-item"
                    style={{ cursor: 'pointer', fontSize: 11.5, color: g.label ? '#5a6577' : '#aab2c4',
                      padding: '2px 6px 2px 16px', borderRadius: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {g.label || '未命名分区'}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <Card size="small" style={{ height: '100%', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
          styles={{ body: { flex: 1, overflowY: 'auto', padding: 12 } }}>
          {/* 文档级样式：统一影响整份报告 PDF 的字体/字号/行距/标题等（写 cover.layout_options.theme_config，与模板编辑器同款面板） */}
          {!readOnly && <div style={{ marginBottom: 10 }}>
            <DocumentStylePanel editorMode="report-cover"
              template={{ id: 0, name: meta?.report_no || '报告', version: 1, groups: [], layout_options: doc.cover.layout_options || {} } as any}
              onChange={(t) => mutate(d => { d.cover.layout_options = (t.layout_options || {}) as any; })} />
          </div>}
          {/* 字段工具栏：选中某字段后，对其字段名/字段值文字与块级版式操作。只读查看时隐藏。 */}
          {!readOnly && <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#d3e0f7', border: '1px solid #9db9ec',
            borderRadius: 6, boxShadow: '0 1px 4px rgba(22,93,255,0.14)',
            padding: '6px 8px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#888', marginRight: 2, whiteSpace: 'nowrap' }}>
              {focused ? <b>{focused.label || '字段'}</b> : <span style={{ color: '#bbb' }}>点某字段选中后可编辑</span>}
            </span>
            <Tooltip title="加粗/斜体/字号/颜色作用到 字段名 还是 字段值">
              <Segmented size="small" disabled={!focused} value={styleTarget} onChange={(v) => setStyleTarget(v as 'label' | 'value')}
                options={[{ label: '字段名', value: 'label' }, { label: '字段值', value: 'value' }]} />
            </Tooltip>
            <Tooltip title={`加粗（${styleTarget === 'label' ? '字段名' : '字段值'}）`}>
              <Button size="small" disabled={!focused} icon={<BoldOutlined />}
                type={partStyle(styleTarget).weight === 'bold' ? 'primary' : 'default'}
                onClick={() => setFocusedPart(styleTarget, { weight: partStyle(styleTarget).weight === 'bold' ? undefined : 'bold' })} /></Tooltip>
            <Tooltip title={`斜体（${styleTarget === 'label' ? '字段名' : '字段值'}）`}>
              <Button size="small" disabled={!focused} icon={<ItalicOutlined />}
                type={partStyle(styleTarget).italic ? 'primary' : 'default'}
                onClick={() => setFocusedPart(styleTarget, { italic: partStyle(styleTarget).italic ? undefined : true })} /></Tooltip>
            <Tooltip title="字号 +"><Button size="small" disabled={!focused} onClick={() => bumpPartSize(styleTarget, 1)}>A+</Button></Tooltip>
            <Tooltip title="字号 −"><Button size="small" disabled={!focused} onClick={() => bumpPartSize(styleTarget, -1)}>A−</Button></Tooltip>
            <Tooltip title={`文字颜色（${styleTarget === 'label' ? '字段名' : '字段值'}）`}>
              <ColorPicker size="small" disabled={!focused} allowClear
                value={partStyle(styleTarget).color || '#000000'}
                presets={[{ label: '常用', colors: ['#000000', '#595959', '#cf1322', '#d48806', '#389e0d', '#1677ff', '#722ed1'] }]}
                onChangeComplete={(c) => setFocusedPart(styleTarget, { color: c.toHexString() })}
                onClear={() => setFocusedPart(styleTarget, { color: undefined })}>
                <Button size="small" disabled={!focused} icon={<BgColorsOutlined />} />
              </ColorPicker></Tooltip>
            <Divider type="vertical" style={{ margin: '0 3px' }} />
            <Tooltip title="左对齐"><Button size="small" disabled={!focused} icon={<AlignLeftOutlined />} type={fStyle().align === 'left' ? 'primary' : 'default'} onClick={() => setFocusedStyle({ align: fStyle().align === 'left' ? undefined : 'left' })} /></Tooltip>
            <Tooltip title="居中"><Button size="small" disabled={!focused} icon={<AlignCenterOutlined />} type={fStyle().align === 'center' ? 'primary' : 'default'} onClick={() => setFocusedStyle({ align: fStyle().align === 'center' ? undefined : 'center' })} /></Tooltip>
            <Tooltip title="右对齐"><Button size="small" disabled={!focused} icon={<AlignRightOutlined />} type={fStyle().align === 'right' ? 'primary' : 'default'} onClick={() => setFocusedStyle({ align: fStyle().align === 'right' ? undefined : 'right' })} /></Tooltip>
            <Tooltip title="是否在报告里显示字段名（『字段名：内容』 ↔ 只显示内容；表/图则为显示/隐藏标题）">
              <Button size="small" disabled={!focused} type={focusedField() && !focusedField()?.hide_label ? 'primary' : 'default'} ghost={!!(focusedField() && !focusedField()?.hide_label)}
                onClick={toggleFocusedHideLabel}>显示字段名</Button></Tooltip>
            <Popover trigger="click" placement="bottom" title="块级版式（字体 / 行距 / 字距 / 段前后）"
              content={focused ? (
                <div style={{ maxWidth: 300 }}>
                  <FormatPanel value={focusedField()?.style} onChange={setFocusedFullStyle} variant="block-extra" />
                  {/* 字段间距：仅普通文字字段（表格/图片不设，其间距随文档样式·字段间距）。 */}
                  {!FIELD_GAP_EXCLUDED.has(focusedField()?.type || '') && (
                    <div style={{ borderTop: '1px dashed #eee', paddingTop: 6, marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Tooltip title="本字段与相邻字段之间的留白（覆盖「文档样式 · 字段间距」，仅本字段）。留空＝跟随文档默认。">
                        <span style={{ fontSize: 12, color: '#888', width: 56 }}>字段间距</span>
                      </Tooltip>
                      <InputNumber size="small" style={{ width: 110 }} min={0} max={120} step={1} addonAfter="pt" placeholder="跟随文档"
                        value={(focusedField() as any)?.field_gap != null ? parseFloat(String((focusedField() as any).field_gap)) : undefined}
                        onChange={(v) => setFocusedFieldGap(v != null ? `${v}pt` : undefined)} />
                    </div>
                  )}
                </div>
              ) : null}>
              <Tooltip title="块级版式：字体/行距/段前后间距/边距/字段间距（对齐已在上方）"><Button size="small" disabled={!focused} icon={<FontColorsOutlined />}>版式▾</Button></Tooltip>
            </Popover>
            <Tooltip title="清除该字段的全部格式（字段名/字段值/块级）"><Button size="small" type="text" danger disabled={!focused || !hasAnyStyle()} onClick={clearFocusedAll}>清除</Button></Tooltip>
            <Divider type="vertical" style={{ margin: '0 3px' }} />
            <Tooltip title="上移选中字段"><Button size="small" disabled={!focused || focused.fi <= 0} icon={<ArrowUpOutlined />} onClick={() => moveFocused(-1)} /></Tooltip>
            <Tooltip title="下移选中字段"><Button size="small" disabled={!focused || focused.fi >= focusedFieldsLen() - 1} icon={<ArrowDownOutlined />} onClick={() => moveFocused(1)} /></Tooltip>
            <Tooltip title="删除选中字段"><Button size="small" danger disabled={!focused} icon={<DeleteOutlined />} onClick={deleteFocused} /></Tooltip>
            <Tooltip title="强制分页：本字段从新的一页开始（在它前面插入分页）">
              <Button size="small" disabled={!focused} icon={<VerticalAlignBottomOutlined />}
                type={focusedField()?.page_break_before ? 'primary' : 'default'}
                onClick={toggleFocusedPageBreak}>分页</Button></Tooltip>
            <div style={{ flex: 1 }} />
            <Dropdown trigger={['click']} disabled={!focused}
              menu={{ items: INSERT_MENU_ITEMS, onClick: ({ key }) => insertContentAtFocused(key as InsertKind) }}>
              <Tooltip title="在选中字段下方添加内容（说明/段落/小标题/空行/照片/图片）">
                <Button size="small" type="primary" ghost disabled={!focused} icon={<PlusOutlined />}>添加内容 ▾</Button>
              </Tooltip>
            </Dropdown>
          </div>}
          {/* 只读查看：整块提示 + 结构区禁交互（pointerEvents:none），仅浏览结构，用大纲/右侧 PDF 查看。 */}
          {readOnly && (
            <Alert type="info" showIcon style={{ marginBottom: 8 }}
              message="只读查看：本报告已送审 / 为历史版本，仅可查看，不能修改。右侧为渲染 PDF，可下载。" />
          )}
          {/* 点空白区域取消选中（仅当点到本容器自身、不是某字段时） */}
          <div onClick={(e) => { if (!readOnly && e.target === e.currentTarget) setFocused(null); }}
            style={{ minHeight: '100%', pointerEvents: readOnly ? 'none' : undefined }}>
          {sections.map(({ key, section }) => (
            <div key={key} id={`sec-${key}`} style={{ marginBottom: 22, paddingTop: key === 'cover' ? 0 : 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '2px 0 12px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', height: 26, padding: '0 14px', borderRadius: 6,
                  background: key === 'cover' ? '#1366d9' : '#3d5aa8', color: '#fff',
                  fontSize: 12.5, fontWeight: 700, letterSpacing: 0.3, boxShadow: '0 1px 3px rgba(20,60,140,0.22)' }}>
                  {key === 'cover' ? '首页' : (section.title || section.name)}
                </span>
                <div style={{ flex: 1, height: 2, borderRadius: 2, background: 'linear-gradient(to right, #b9c8e4, #eef1f6)' }} />
              </div>
              {section.groups.map((g, gi) => (
                <div key={g.id || gi} id={`grp-${key}-${gi}`}>
                <GroupEditor
                  group={g}
                  locked={isSignatureGroup(g)}
                  ctx={section.ctx}
                  orderNo={meta?.order_no}
                  sectionKey={key}
                  originalValues={originalValues}
                  divergedPaths={divergedPaths}
                  onFieldValue={(fi, val) => mutate(d => {
                    const grp = (key === 'cover' ? d.cover : d.projects[Number(key.slice(4))]).groups[gi];
                    grp.fields[fi].binding = lit(val);
                  })}
                  onInsertAt={(index, kind) => mutate(d => {
                    const grp = (key === 'cover' ? d.cover : d.projects[Number(key.slice(4))]).groups[gi];
                    grp.fields.splice(Math.max(0, Math.min(index, grp.fields.length)), 0, makeContentField(kind as InsertKind));
                  })}
                  onRemoveField={(fi) => mutate(d => {
                    const grp = (key === 'cover' ? d.cover : d.projects[Number(key.slice(4))]).groups[gi];
                    grp.fields.splice(fi, 1);
                  })}
                  onMoveField={(fi, dir) => mutate(d => {
                    const arr = (key === 'cover' ? d.cover : d.projects[Number(key.slice(4))]).groups[gi].fields;
                    const jj = fi + dir;
                    if (jj < 0 || jj >= arr.length) return;
                    [arr[fi], arr[jj]] = [arr[jj], arr[fi]];
                  })}
                  onResultCell={(fi, rowId, colId, val) => mutate(d => {
                    const grp = (key === 'cover' ? d.cover : d.projects[Number(key.slice(4))]).groups[gi];
                    setResultCell(grp.fields[fi], rowId, colId, val);
                  })}
                  onAddRow={(fi) => mutate(d => {
                    const grp = (key === 'cover' ? d.cover : d.projects[Number(key.slice(4))]).groups[gi];
                    addResultRow(grp.fields[fi]);
                  })}
                  onRemoveRow={(fi, rowId) => mutate(d => {
                    const grp = (key === 'cover' ? d.cover : d.projects[Number(key.slice(4))]).groups[gi];
                    removeResultRow(grp.fields[fi], rowId);
                  })}
                  onGroupStyle={(style) => mutate(d => {
                    const grp = (key === 'cover' ? d.cover : d.projects[Number(key.slice(4))]).groups[gi];
                    grp.style = style;
                  })}
                  onMutateGroup={(fn) => mutate(d => {
                    const grp = (key === 'cover' ? d.cover : d.projects[Number(key.slice(4))]).groups[gi];
                    fn(grp);
                  })}
                  onFieldStyle={(fi, style) => mutate(d => {
                    const grp = (key === 'cover' ? d.cover : d.projects[Number(key.slice(4))]).groups[gi];
                    grp.fields[fi].style = style;
                  })}
                  onMutateField={(fi, fn) => mutate(d => {
                    const grp = (key === 'cover' ? d.cover : d.projects[Number(key.slice(4))]).groups[gi];
                    fn(grp.fields[fi]);
                  })}
                  onReorderField={(from, to) => mutate(d => {
                    const arr = (key === 'cover' ? d.cover : d.projects[Number(key.slice(4))]).groups[gi].fields;
                    if (from < 0 || from >= arr.length || to < 0 || to >= arr.length) return;
                    const [m] = arr.splice(from, 1);
                    arr.splice(to, 0, m);
                  })}
                  onFocusField={(fi) => {
                    setFocused({ key, gi, fi, label: g.fields[fi]?.label || '' });
                    // 选中字段 → 右侧预览滚到该字段。marker code 已按段前缀（renderContentDoc.prefixPosMarkers），
                    // 用 `${sectionKey}::${code}` 精确定位本段，避免首页/各项目段同 code 撞车跳错位置。
                    const code = g.fields[fi]?.code;
                    if (code) viewerRef.current?.scrollToMarker(`${key}::${code}`, `${key}::${g.id}`);
                  }}
                  onDeselect={() => setFocused(null)}
                  selectedFi={focused && focused.key === key && focused.gi === gi ? focused.fi : null}
                  onMutateCtx={(fn) => mutate(d => {
                    const sec = key === 'cover' ? d.cover : d.projects[Number(key.slice(4))];
                    if (!sec.ctx) sec.ctx = {};
                    fn(sec.ctx);
                  })}
                />
                </div>
              ))}
            </div>
          ))}
          </div>
        </Card>
        </div>
          }
          right={
        /* 右：实时预览——与模板编辑器同款 TypstViewer（内置编译/下载 PDF/保滚动位置，改动后不回到顶部）。
           去掉了「实时预览」标题栏（无功能、占高度）；enableSync 开启「左侧字段→右侧预览」定位。 */
        <Card size="small"
          style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
          styles={{ body: { flex: 1, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' } }}>
          {previewError && <Alert type="error" banner showIcon message="预览失败" description={previewError} />}
          <TypstViewer ref={viewerRef} enableSync source={typstSource} mode="view" height="100%"
            downloadName={`${meta?.report_no || meta?.order_no || '报告'}.pdf`} />
        </Card>
          }
        />
      </div>

      <Modal title="把首页应用到已取号报告" open={applyOpen} onCancel={() => setApplyOpen(false)}
        onOk={runApply} okText={`应用到选中的 ${applySel.length} 份`} okButtonProps={{ disabled: !applySel.length, loading: applying }}>
        {applyInRework && (
          <div style={{ fontSize: 12, color: '#a8071a', background: '#fff1f0', border: '1px solid #ffccc7', borderRadius: 4, padding: '6px 10px', marginBottom: 10 }}>
            本订单有报告被退回。首页改动<b>只会应用到被退回的报告</b>——已送审未退回的报告已冻结，不在此列、不受影响。
          </div>
        )}
        <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
          勾选要应用本首页（结构 / 图片 / 样式）的<b>已生成</b>报告。每份报告的<b>报告号 / 样品 / 结论值不变</b>（按各报告数据重算），只换首页排版与图片。尚未生成的取号报告会在生成时自动套用当前首页，无需在此勾选。
          {!applyInRework && <><br />标「已编辑」的报告曾被单独改过——应用会覆盖其首页改动，缺省不勾选。</>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <Button size="small" onClick={() => setApplySel(applyTargets.map(r => r.id))}>全选</Button>
          <Button size="small" onClick={() => setApplySel([])}>全不选</Button>
        </div>
        <Checkbox.Group style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}
          value={applySel} onChange={(v) => setApplySel(v as number[])}>
          {applyTargets.map(r => (
            <Checkbox key={r.id} value={r.id}>
              <Space size={6}>
                <span style={{ fontFamily: 'monospace' }}>{r.report_no || `#${r.id}`}</span>
                {r.scope?.sample_label && <Tag>{r.scope.sample_label}</Tag>}
                {r.edited && <Tag color="orange">已编辑</Tag>}
              </Space>
            </Checkbox>
          ))}
        </Checkbox.Group>
        {applyPending.length > 0 && (
          <div style={{ marginTop: 12, borderTop: '1px dashed #eee', paddingTop: 10 }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>
              另有 <b>{applyPending.length}</b> 份取号报告尚未生成（待数据录入），将在生成时<b>自动套用当前首页</b>，无需在此勾选：
            </div>
            <Space size={[6, 6]} wrap>
              {applyPending.map(rq => (
                <Tag key={rq.id} style={{ fontFamily: 'monospace' }}>
                  {rq.report_number}{rq.sample_name ? ` · ${rq.sample_name}` : ''}
                </Tag>
              ))}
            </Space>
          </div>
        )}
      </Modal>

      <Modal title="调整本报告的样品 / 测试项目" open={scopeOpen} onCancel={() => setScopeOpen(false)}
        width={600} onOk={doRescope} okText="确认" okButtonProps={{ disabled: !scopeSel.size, loading: rescoping }}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
          勾选本报告要包含的样品与测试项目（来自本订单下审核通过的原始记录）：勾选<b>样品</b>即选中它的<b>全部测试项目</b>，
          也可只勾其中几项。确认后本报告按新范围更新——<b>首页样品信息 / 检测结论表随之增减</b>，各项目明细页同步。
          <br /><span style={{ color: '#bbb' }}>注：已对项目段做过的手动逐字修改会重置（首页结构 / 图片 / 样式保留）。</span>
        </div>
        {scopeLoading ? <Spin style={{ display: 'block', margin: '24px auto' }} />
          : scopeCands.length === 0 ? <Empty description="本订单暂无可纳入的审核通过记录" />
          : (
            <>
              <Input.Search allowClear placeholder="搜索样品或测试项目" value={scopeSearch}
                onChange={e => setScopeSearch(e.target.value)} style={{ marginBottom: 8 }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: '#999' }}>已选 {scopeSel.size} / {scopeCands.length} 项</span>
                <Space size={4}>
                  <Button size="small" onClick={() => setScopeSel(new Set(scopeCands.map(c => Number(c.record_data_id))))}>全选</Button>
                  <Button size="small" onClick={() => setScopeSel(new Set())}>全不选</Button>
                </Space>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflow: 'auto' }}>
                {scopeGroups.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配的样品 / 项目" />
                  : scopeGroups.map(g => {
                    const selCount = g.items.filter(c => scopeSel.has(Number(c.record_data_id))).length;
                    const allOn = selCount === g.items.length && selCount > 0;
                    const someOn = selCount > 0 && !allOn;
                    const collapsed = scopeCollapsed.has(g.key);
                    return (
                      <div key={g.key} style={{ border: '1px solid', borderColor: selCount ? '#91caff' : '#f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: selCount ? '#f0f7ff' : '#fafafa' }}>
                          <Checkbox checked={allOn} indeterminate={someOn}
                            onChange={e => setSampleGroup(g.items, e.target.checked)} onClick={e => e.stopPropagation()} />
                          <span onClick={() => toggleScopeCollapse(g.key)}
                            style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                            <span style={{ fontSize: 11, color: '#999', width: 12, display: 'inline-block' }}>{collapsed ? '▸' : '▾'}</span>
                            <Tag color="blue" style={{ margin: 0 }}>{g.sample_no ? `${g.sample_no}# ` : ''}{g.sample_name}</Tag>
                            <span style={{ fontSize: 12, color: '#999' }}>{selCount}/{g.items.length} 项</span>
                          </span>
                        </div>
                        {!collapsed && (
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            {g.items.map(c => {
                              const checked = scopeSel.has(Number(c.record_data_id));
                              return (
                                <label key={`${c.record_data_id}_${c.project_template_id}`}
                                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 6px 34px', cursor: 'pointer',
                                    borderTop: '1px solid #f5f5f5', background: checked ? '#f6ffed' : '#fff' }}>
                                  <Checkbox checked={checked} onChange={() => toggleScope(Number(c.record_data_id))} />
                                  <span style={{ fontWeight: 600 }}>{c.project_name}</span>
                                  {c.test_item_name && <span style={{ fontSize: 12, color: '#999' }}>· {c.test_item_name}</span>}
                                  <div style={{ flex: 1 }} />
                                  {c.tester_name && <span style={{ fontSize: 11, color: '#bbb' }}>主检 {c.tester_name}</span>}
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </>
          )}
      </Modal>

      {/* 退回原始记录：列本报告引用的原始记录，选一条查看并退回给主检 */}
      <Modal title="退回原始记录给主检（实验室工程师）" open={returnOpen} onCancel={() => setReturnOpen(false)} footer={null} width={560}>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }}
          message="选择本报告中数据有误的原始记录退回"
          description="退回后该记录回到「已退回」，主检需在「实验室录入」修改并重新提交审核；审核通过后本报告会被标记为「源数据已更新」需重新生成。退回未关闭前本报告不可送审。" />
        {returnLoading ? <Spin /> : !returnRecs.length ? <Empty description="本报告没有可退回的原始记录" /> : (
          <List size="small" dataSource={returnRecs} rowKey={(c: any) => c.record_data_id}
            renderItem={(c: any) => (
              <List.Item actions={[
                <Button key="r" size="small" danger icon={<RollbackOutlined />}
                  onClick={() => { setReturnOpen(false); setViewerRec({ id: Number(c.record_data_id), subtitle: `${c.sample_name || ''} · ${c.test_item_name || c.project_name || ''}` }); }}>
                  查看并退回
                </Button>,
              ]}>
                <List.Item.Meta
                  title={`${c.sample_no ? c.sample_no + ' ' : ''}${c.sample_name || ''} · ${c.test_item_name || c.project_name || ''}`}
                  description={`主检：${c.tester_name || '—'}`} />
              </List.Item>
            )} />
        )}
      </Modal>

      {/* 只读查看选中的原始记录 + 退回（复用录入进度同款查看器；reportId 让工单挂到本报告） */}
      <ReadonlyRecordViewer
        recordId={viewerRec?.id ?? null}
        open={!!viewerRec}
        subtitle={viewerRec?.subtitle}
        reportId={id ? Number(id) : null}
        onClose={() => setViewerRec(null)}
        onRejected={() => {
          message.success('已退回，主检将在「实验室录入」看到待返工；本报告待数据重审通过后重新生成');
          goBack();
        }}
      />

    </div>
  );
}

// ─── 结果表编辑辅助（改 content_doc 的 result_table 结构）─────────────
function setResultCell(field: FieldDefinition, rowId: string, colId: string, val: string) {
  const rt = field.result_table; if (!rt) return;
  rt.cells = rt.cells || [];
  const c = rt.cells.find(x => x.rowId === rowId && x.colId === colId);
  if (c) c.binding = lit(val);
  else rt.cells.push({ rowId, colId, binding: lit(val) });
}
function addResultRow(field: FieldDefinition) {
  const rt = field.result_table; if (!rt) return;
  const rid = newId('row');
  rt.rows = rt.rows || [];
  rt.rows.push({ id: rid, label: '' });
}
function removeResultRow(field: FieldDefinition, rowId: string) {
  const rt = field.result_table; if (!rt) return;
  rt.rows = (rt.rows || []).filter(r => r.id !== rowId);
  rt.cells = (rt.cells || []).filter(c => c.rowId !== rowId);
}

// ─── 富文本小编辑器（Markdown 子集：**粗** *斜* - 列表，空行分段）──────────
function RichTextEditor({ initial, onChange }: { initial: string; onChange: (v: string) => void }) {
  const ref = useRef<any>(null);
  const taEl = (): HTMLTextAreaElement | undefined => ref.current?.resizableTextArea?.textArea;
  const apply = (fn: (v: string, s: number, e: number) => { v: string; pos: number }) => {
    const ta = taEl(); if (!ta) return;
    const { v, pos } = fn(ta.value, ta.selectionStart, ta.selectionEnd);
    ta.value = v; onChange(v);
    ta.focus(); ta.setSelectionRange(pos, pos);
  };
  const wrap = (mk: string) => apply((v, s, e) => {
    const sel = v.slice(s, e) || '文字';
    return { v: v.slice(0, s) + mk + sel + mk + v.slice(e), pos: s + mk.length + sel.length + mk.length };
  });
  const bullet = () => apply((v, s) => {
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    return { v: v.slice(0, ls) + '- ' + v.slice(ls), pos: s + 2 };
  });
  return (
    <div>
      <Space size={2} style={{ marginBottom: 2 }}>
        <Button size="small" style={{ fontWeight: 'bold' }} onClick={() => wrap('**')}>B</Button>
        <Button size="small" style={{ fontStyle: 'italic' }} onClick={() => wrap('*')}>I</Button>
        <Button size="small" onClick={bullet}>• 列表</Button>
        <span style={{ fontSize: 11, color: '#aaa' }}>**粗** *斜* - 列表 · 空行分段</span>
      </Space>
      <Input.TextArea ref={ref} size="small" autoSize={{ minRows: 2, maxRows: 8 }}
        defaultValue={initial} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// ─── 可拖拽重排的字段行（HTML5 drag，带拖柄 + ↑↓ + 常驻「+下方插入」+ 接受拖入空行）──────
function DraggableField({ index, selected, onSelect, onDeselect, onReorder, onInsertAt, children }: {
  index: number;
  selected?: boolean;
  onSelect?: () => void;
  onDeselect?: () => void;
  onReorder: (from: number, to: number) => void;
  onInsertAt: (index: number, kind: 'paragraph' | 'heading' | 'note' | 'spacer' | 'photo_table' | 'image') => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  // 一字段一条：最左仅一个拖拽手柄；点击整行选中。再次点击已选中字段的空白处（非输入框）取消选中。
  return (
    <div
      className={`fe-row ${selected ? 'fe-selected' : ''}`}
      onClick={(e) => {
        const el = e.target as HTMLElement;
        const interactive = /^(INPUT|TEXTAREA|BUTTON|SELECT)$/.test(el.tagName) || el.isContentEditable || !!el.closest('.ant-select,.ant-color-picker,.ant-upload');
        if (selected && !interactive) onDeselect?.();
        else onSelect?.();
      }}
      onDragOver={(e) => { e.preventDefault(); if (!over) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        const data = e.dataTransfer.getData('text/plain');
        if (data === '__spacer__') { onInsertAt(index, 'spacer'); return; }  // 从「空行」chip 拖入 → 插在本行上方
        const from = Number(data);
        if (!Number.isNaN(from) && from !== index) onReorder(from, index);
      }}
      style={{ gap: 4, borderTop: `2px solid ${over ? '#1677ff' : 'transparent'}` }}
    >
      <Tooltip title="按住拖动重排">
        <span className="fe-drag" draggable
          onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(index)); e.dataTransfer.effectAllowed = 'move'; }}
          style={{ fontSize: 14, lineHeight: 1, userSelect: 'none', flexShrink: 0, padding: '0 2px' }}>⠿</span>
      </Tooltip>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

// ─── 字段间「插入点」：hover 显形，可在任意位置插空行 / 内容 ────────────────
function InsertZone({ onInsert }: { onInsert: (kind: 'spacer' | 'paragraph' | 'heading' | 'note' | 'photo_table' | 'image') => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ height: 16, margin: '-5px 0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {hover ? (
        <Space size={2} style={{ background: '#fff', padding: '0 6px', border: '1px solid #d6e4ff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <Button size="small" type="link" style={{ padding: '0 4px', height: 20 }} icon={<PlusOutlined />}
            onClick={() => onInsert('spacer')}>空行</Button>
          <Dropdown trigger={['click']} menu={{ items: [
            { key: 'paragraph', label: '段落（正文，无标签）' },
            { key: 'heading', label: '小标题（加粗大字）' },
            { key: 'note', label: '说明字段（标签：值）' },
            { key: 'photo_table', label: '原样照片表（上传照片）' },
            { key: 'image', label: '图片（每行一张/多张，可加多行）' },
          ], onClick: ({ key }) => onInsert(key as 'paragraph' | 'heading' | 'note' | 'photo_table') }}>
            <Button size="small" type="link" style={{ padding: '0 4px', height: 20 }}>内容 ▾</Button>
          </Dropdown>
        </Space>
      ) : (
        <div style={{ width: '100%', borderTop: '1px dashed #f5f5f5' }} />
      )}
    </div>
  );
}

/**
 * 表格「上方标签 + 下方备注」编辑卡（两列，与图片 ImageSectionNotes 同款）。
 * 左＝表格上方标签（field.label + 显示开关 + 文字样式 label_style + 标签↔表距离 label_gap）；
 * 右＝表格下方备注（field.caption + 文字样式 caption_style + 备注↔表距离 caption_gap）。
 * 报告自动表标题缺省不显示（hide_label!==false），填了标签即自动置 hide_label=false 显示。
 */
function LabelCaptionCard({ field, onMutate }: { field: FieldDefinition; onMutate: (fn: (f: any) => void) => void }) {
  const f: any = field;
  const num = (s: any) => (s != null && s !== '' ? parseFloat(String(s)) : undefined);
  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <div style={{ minWidth: 210 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>表格上方·标签（空＝不显示）</div>
        <Input size="small" value={f.label || ''} placeholder="如：检测结果表"
          onChange={(e) => onMutate(x => { const v = e.target.value; x.label = v; if (v.trim()) x.hide_label = false; })} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0', fontSize: 12, color: '#666' }}>
          <Checkbox checked={f.hide_label === false} onChange={(e) => onMutate(x => { x.hide_label = e.target.checked ? false : undefined; })} /> 显示标签
        </label>
        <FormatPanel variant="text" value={f.label_style} onChange={(s) => onMutate(x => { x.label_style = s; })} />
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tooltip title="标签与表之间的距离；留空＝默认"><span style={{ fontSize: 12, color: '#888' }}>标签↔表距离</span></Tooltip>
          <InputNumber size="small" style={{ width: 96 }} min={0} max={60} step={1} addonAfter="pt" placeholder="默认"
            value={num(f.label_gap)} onChange={(n) => onMutate(x => { x.label_gap = n != null ? `${n}pt` : undefined; })} />
        </div>
      </div>
      <div style={{ borderLeft: '1px solid #eee', paddingLeft: 16, minWidth: 210 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>表格下方·备注（空＝不显示）</div>
        <Input.TextArea rows={2} value={f.caption || ''} placeholder="如：见原始记录。"
          onChange={(e) => onMutate(x => { x.caption = e.target.value || undefined; })} />
        <div style={{ marginTop: 6 }}>
          <FormatPanel variant="text" value={f.caption_style} onChange={(s) => onMutate(x => { x.caption_style = s; })} />
        </div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tooltip title="备注与表之间的距离；留空＝默认"><span style={{ fontSize: 12, color: '#888' }}>备注↔表距离</span></Tooltip>
          <InputNumber size="small" style={{ width: 96 }} min={0} max={60} step={1} addonAfter="pt" placeholder="默认"
            value={num(f.caption_gap)} onChange={(n) => onMutate(x => { x.caption_gap = n != null ? `${n}pt` : undefined; })} />
        </div>
      </div>
    </div>
  );
}

// ─── 单个分组的字段编辑 ───────────────────────────────────────────────
function GroupEditor(props: {
  group: FieldGroup;
  ctx: any;
  /** 本报告订单号——首页图片上传按 <根>/<订单号>/_首页/<字段名> 落盘。 */
  orderNo?: string;
  sectionKey: string;
  originalValues: Record<string, { label: string; value: string }>;
  divergedPaths: Set<string>;
  onFieldValue: (fieldIdx: number, val: string) => void;
  onInsertAt: (index: number, kind: 'paragraph' | 'heading' | 'note' | 'spacer' | 'photo_table' | 'image') => void;
  onRemoveField: (fieldIdx: number) => void;
  onMoveField: (fieldIdx: number, dir: -1 | 1) => void;
  onResultCell: (fieldIdx: number, rowId: string, colId: string, val: string) => void;
  onAddRow: (fieldIdx: number) => void;
  onRemoveRow: (fieldIdx: number, rowId: string) => void;
  onGroupStyle: (style: StyleOverride | undefined) => void;
  /** 改本分区（如分区左上角标题＝group.label）。 */
  onMutateGroup: (fn: (g: FieldGroup) => void) => void;
  onFieldStyle: (fieldIdx: number, style: StyleOverride | undefined) => void;
  onMutateField: (fieldIdx: number, fn: (f: FieldDefinition) => void) => void;
  onReorderField: (from: number, to: number) => void;
  onFocusField: (fieldIdx: number) => void;
  /** 取消选中（点已选中字段空白处 / 点空白区域）。 */
  onDeselect: () => void;
  /** 当前选中字段在本组内的下标（用于高亮），不在本组则为 null。 */
  selectedFi: number | null;
  /** 改本段 ctx 快照（如图片表照片 record_raw_data），只落 content_doc、不回写 record_data。 */
  onMutateCtx: (fn: (ctx: any) => void) => void;
  /** 签发/签字栏分区：整段置灰只读，不可改值/字段/排版（增删分区仍可在模板编辑器做）。 */
  locked?: boolean;
}) {
  const { group, ctx, sectionKey, originalValues, divergedPaths } = props;
  const isImageSection = group.section_role === 'images' && group.fields.some(f => f.type === 'image');
  // 图片块渲在【第一个 image 字段】的位置——与渲染端 generateGroupContent 一致（前面的非图片字段在图上方、后面的在图下方）
  const firstImgIdx = isImageSection ? group.fields.findIndex(f => f.type === 'image') : -1;
  const setLayout = (patch: any) => props.onMutateGroup(g => { g.image_layout = { ...(g.image_layout || {}), ...patch }; });
  const inner = (
    <div className="fe-group-card" style={{ marginBottom: 12, border: '1px solid #cdd8e8', borderRadius: 8, background: '#f5f8fc', boxShadow: '0 1px 3px rgba(16,40,80,0.06)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', background: '#e7eef8', borderBottom: '1px solid #cdd8e8' }}>
        {group.section_role === 'images' ? (
          <Tooltip title="分区【大标题】（显示在图片上方；可在右侧「格式」里隐藏）。表内标题/上方标签/下方备注在右上角两个按钮里设。">
            <Input size="small" variant="borderless" value={group.label || ''} placeholder="大标题（可留空/可隐藏）"
              style={{ width: 200, fontSize: 12.5, fontWeight: 600, color: group.hide_title ? '#aab' : '#33415c', padding: 0 }}
              onChange={(e) => props.onMutateGroup(g => { g.label = e.target.value; })} />
          </Tooltip>
        ) : (
          <Tooltip title="分区标题（显示在该区块上方；留空＝不显示。填了标题即会显示）">
            <Input size="small" variant="borderless" disabled={props.locked}
              value={group.label || ''} placeholder="（点此填分区标题，留空＝不显示）"
              style={{ width: 220, fontSize: 12.5, fontWeight: 600, padding: 0,
                color: group.hide_title || !group.label ? '#8a94a6' : '#33415c' }}
              onChange={(e) => props.onMutateGroup(g => { const v = e.target.value; g.label = v; if (v.trim()) g.hide_title = undefined; })} />
          </Tooltip>
        )}
        <span style={{ fontSize: 11, color: '#aab2c4' }}>· {group.fields.length} 字段</span>
        <div style={{ flex: 1 }} />
        {isImageSection ? (
          <>
            {/* 图片版式：共用/每张标题、每行、尺寸、单数独占（与记录/项目模板同一组件） */}
            <Popover trigger="click" placement="bottomRight" title="图片版式（统一管本分区所有图位）"
              overlayInnerStyle={{ maxHeight: '78vh', overflowY: 'auto' }}
              content={<ImageSectionPanel value={group.image_layout || {}} onChange={setLayout} />}>
              <Tooltip title="每行几张 / 尺寸 / 单数独占 / 表内标题（共用还是每张一个）"><Button size="small" type="text" icon={<TableOutlined />}>图片版式</Button></Tooltip>
            </Popover>
            {/* 标签/备注：左＝图表上方标签，右＝图表下方备注（大标题已改为分区标题栏内联编辑，此处不再重复）。 */}
            <Popover trigger="click" placement="bottomRight" title="图表·标签 / 备注" overlayInnerStyle={{ maxHeight: '78vh', overflowY: 'auto' }}
              content={<ImageSectionNotes value={group.image_layout || {}} onChange={setLayout} />}>
              <Tooltip title="图表上方标签 + 图表下方备注（各自文字/样式/距离）"><Button size="small" type="text" icon={<FontColorsOutlined />}>标签/备注</Button></Tooltip>
            </Popover>
          </>
        ) : (
          <Popover trigger="click" placement="bottomLeft" title="本区块格式"
            content={<FormatPanel value={group.style} onChange={props.onGroupStyle} />}>
            <Tooltip title="本区块字体/字号/对齐/行距/间距">
              <Button size="small" type={group.style ? 'primary' : 'text'} ghost={!!group.style} icon={<FontColorsOutlined />} />
            </Tooltip>
          </Popover>
        )}
      </div>
      <div style={{ padding: '8px 10px' }}>
      <InsertZone onInsert={(kind) => props.onInsertAt(0, kind)} />
      {group.fields.map((f, fi) => {
        let inner: React.ReactNode = null;
        if (TABLE_FREE_TYPES.has(f.type) && f.free_table?.columns?.length) {
          // 统一「自由编辑表格」：三类报告表共用同一个纯文本网格编辑器（一致 UI）
          inner = <FreeTableBlock title={f.label || '表格'} field={f} onMutate={(fn) => props.onMutateField(fi, fn)} />;
        } else if (f.type === 'report_result_table' && f.result_table) {
          inner = <ResultTableEditor field={f} ctx={ctx}
            sectionKey={sectionKey} divergedPaths={divergedPaths} originalValues={originalValues}
            onCell={(rid, cid, v) => props.onResultCell(fi, rid, cid, v)}
            onAddRow={() => props.onAddRow(fi)}
            onRemoveRow={(rid) => props.onRemoveRow(fi, rid)}
            onMutate={(fn) => props.onMutateField(fi, fn)} />;
        } else if (f.type === 'report_equipment_table') {
          inner = <EquipmentTableEditor field={f} ctx={ctx} onMutate={(fn) => props.onMutateField(fi, fn)} />;
        } else if (f.type === 'spacer') {
          const cur = parseFloat(String(f.spacer_height || '').replace(/[^\d.]/g, '')) || 1;
          const setH = (em: number) => props.onMutateField(fi, ff => { ff.spacer_height = `${em}em`; });
          inner = (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', marginBottom: 4, background: '#fafafa', border: '1px dashed #e0e0e0', borderRadius: 4 }}>
              <span style={{ fontSize: 12, color: '#999', flexShrink: 0 }}>↕ 空行</span>
              <Tooltip title="留白高度（em≈行）">
                <InputNumber size="small" min={0} step={0.5} value={cur} addonAfter="em" style={{ width: 96 }}
                  onChange={(v) => setH(v ?? 0.5)} />
              </Tooltip>
              <Space.Compact size="small">
                <Button onClick={() => setH(0.5)} type={cur === 0.5 ? 'primary' : 'default'}>半行</Button>
                <Button onClick={() => setH(1)} type={cur === 1 ? 'primary' : 'default'}>一行</Button>
                <Button onClick={() => setH(2)} type={cur === 2 ? 'primary' : 'default'}>两行</Button>
              </Space.Compact>
            </div>
          );
        } else if (f.type === 'report_conclusion_table') {
          inner = <ConclusionTableEditor field={f} ctx={ctx} onMutate={(fn) => props.onMutateField(fi, fn)} />;
        } else if (f.type === 'report_image_gallery') {
          inner = <PhotoLayoutEditor field={f} ctx={ctx} orderNo={props.orderNo} kind="gallery" onMutate={(fn) => props.onMutateField(fi, fn)} onMutateCtx={props.onMutateCtx} />;
        } else if (f.type === 'report_photo_table') {
          inner = <PhotoLayoutEditor field={f} ctx={ctx} orderNo={props.orderNo} kind="photo_table" onMutate={(fn) => props.onMutateField(fi, fn)} onMutateCtx={props.onMutateCtx} />;
        } else if (f.type === 'report_sample_table') {
          inner = <SampleTableEditor field={f} ctx={ctx} onMutate={(fn) => props.onMutateField(fi, fn)} />;
        } else if (f.type === 'image') {
          // 图片分区：整组图位由 ImageSectionEditor 统一渲染，且放在【第一个 image 字段】的位置（其余 image 字段跳过）——
          // 使编辑顺序与渲染一致：排在图片前的非图片字段显示在图上方、排在后的显示在图下方。分区外独立 image(首页)仍走 ImageFieldEditor。
          inner = !isImageSection
            ? <ImageFieldEditor field={f} orderNo={props.orderNo} onMutate={(fn) => props.onMutateField(fi, fn)} />
            : (fi === firstImgIdx
                ? <ImageSectionEditor group={group} ctx={ctx} orderNo={props.orderNo} onMutateGroup={props.onMutateGroup} onMutateCtx={props.onMutateCtx} />
                : null);
        } else if (REPORT_AUTO_TYPES.has(f.type)) {
          inner = (
            <div style={{ fontSize: 12, color: '#999', padding: '4px 0' }}>
              {f.label}：<Tag>自动生成</Tag><span style={{ fontSize: 11 }}>（设备表，结构编辑见后续版本）</span>
            </div>
          );
        } else if (NORMAL_TYPES.has(f.type) || f.type === 'daterange' || f.binding) {
          // daterange（检测周期）也是可编辑字段：未改过时显示两端计算出的「开始 ~ 结束」，
          // 编辑即写 binding=literal 覆盖（formatDateRange 优先返回该字面量）——所有字段皆可改。
          const cur = f.binding ? resolveBinding(f.binding, ctx)
            : (f.type === 'daterange' ? formatDateRange(f, ctx) : '');
          const path = `${sectionKey}/${f.id}`;
          const diverged = divergedPaths.has(path);
          const orig = originalValues[path]?.value;
          inner = (
            <div style={{ marginBottom: 4 }} onFocusCapture={() => props.onFocusField(fi)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {f.rich || f.hide_label ? (
                  <span style={{ width: 110, fontSize: 12, color: '#aaa', flexShrink: 0 }}>{f.rich ? '段落' : f.label}</span>
                ) : (
                  <Tooltip title="字段名（可改，显示在报告里）">
                    <Input size="small" variant="borderless" defaultValue={f.label}
                      style={{ width: 110, fontSize: 12, color: '#666', flexShrink: 0, padding: '0 2px' }}
                      onChange={(e) => props.onMutateField(fi, ff => { ff.label = e.target.value; })} />
                  </Tooltip>
                )}
                {f.rich ? (
                  <div style={{ flex: 1 }}>
                    <RichTextEditor initial={cur === '—' ? '' : cur} onChange={(v) => props.onFieldValue(fi, v)} />
                  </div>
                ) : (
                  <Input size="small" defaultValue={cur === '—' ? '' : cur}
                    status={diverged ? 'warning' : undefined}
                    onChange={(e) => props.onFieldValue(fi, e.target.value)}
                    placeholder={f.hide_label ? '正文文字（无标签）' : '—'} />
                )}
                {f.style && <span title="该字段有自定义格式" style={{ fontSize: 11, color: '#722ed1', flexShrink: 0 }}>●</span>}
              </div>
              {diverged && orig !== undefined && (
                <div style={{ fontSize: 11, color: '#cf1322', paddingLeft: 116 }}>
                  原始值：{orig === '—' || orig === '' ? '（空）' : orig}
                </div>
              )}
            </div>
          );
        } else {
          // 兜底：任何未单独处理的字段类型（computed/reference/variant_list 等）也都拉取显示，
          // 有 binding 可改、无则只读展示当前值——保证「全部字段及其值」都出现在编辑器里。
          const cur = f.binding ? resolveBinding(f.binding, ctx) : (f.default_value != null ? String(f.default_value) : '');
          inner = (
            <div style={{ marginBottom: 4 }} onFocusCapture={() => props.onFocusField(fi)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 110, fontSize: 12, color: '#888', flexShrink: 0 }}>{f.label || f.code}</span>
                <Input size="small" defaultValue={cur === '—' ? '' : cur} disabled={!f.binding}
                  placeholder={f.binding ? '—' : '（自动/派生值，不可直接改）'}
                  onChange={(e) => props.onFieldValue(fi, e.target.value)} />
                <Tag style={{ flexShrink: 0, fontSize: 11 }}>{f.type}</Tag>
              </div>
            </div>
          );
        }
        if (!inner) return null;
        // 报告表格：一行「标签 输入 + 标签/备注 ▾ 卡片」——可编辑表格上方标签(field.label)与下方备注(field.caption)。
        // 解决"表格标签在报告编辑器里不可编辑"：填标签即显示（hide_label=false）。
        const captionEditor = LABELCAP_TYPES.has(f.type) ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0 6px', paddingLeft: 4 }}>
            <Tooltip title="表格上方标签（留空＝不显示；填了即显示）">
              <Input size="small" variant="filled" value={f.label || ''} placeholder="表格标签（上方，留空＝不显示）"
                style={{ maxWidth: 220, fontSize: 12, color: f.hide_label === false ? '#33415c' : '#8a94a6' }}
                onChange={(e) => props.onMutateField(fi, ff => { const v = e.target.value; ff.label = v; if (v.trim()) (ff as any).hide_label = false; })} />
            </Tooltip>
            <Popover trigger="click" placement="bottomLeft" title="表格·标签 / 备注" overlayInnerStyle={{ maxHeight: '78vh', overflowY: 'auto' }}
              content={<LabelCaptionCard field={f} onMutate={(fn) => props.onMutateField(fi, fn)} />}>
              <Button size="small" type="text" icon={<FontColorsOutlined />}>标签/备注 ▾</Button>
            </Popover>
            {f.caption && <span style={{ fontSize: 11, color: '#9aa4b6' }} title={f.caption}>· 有备注</span>}
          </div>
        ) : null;
        return (
          <Fragment key={f.id || fi}>
            <DraggableField index={fi}
              selected={props.selectedFi === fi} onSelect={() => props.onFocusField(fi)} onDeselect={props.onDeselect}
              onReorder={props.onReorderField} onInsertAt={props.onInsertAt}>
              {inner}
              {captionEditor}
            </DraggableField>
            <InsertZone onInsert={(kind) => props.onInsertAt(fi + 1, kind)} />
          </Fragment>
        );
      })}
      {/* 各分区末尾的「在末尾插入内容」按钮已移除——改用顶部工具栏「添加内容」（在选中字段下方插入），左侧更简洁。 */}
      </div>
    </div>
  );
  // 签发分区：渲染与普通分区【完全一样】的内容（排版/样式不变），整段置灰 + 屏蔽交互；
  // 仅在浮层上保留两个可点元素——「位置」选择（跟随正文/居中/底部）与锁标签。
  if (props.locked) {
    const vAlign = group.style?.vertical_align === 'bottom' ? 'bottom'
      : group.style?.vertical_align === 'center' ? 'center' : 'flow';
    return (
      <div style={{ position: 'relative' }}>
        <div style={{ pointerEvents: 'none', opacity: 0.6, userSelect: 'none' }} aria-disabled>{inner}</div>
        <div style={{ position: 'absolute', top: 5, right: 8, display: 'flex', alignItems: 'center', gap: 6, zIndex: 5 }}>
          <Tooltip title="签字栏在页面上的位置：跟随正文（紧接上方内容）/ 页面居中 / 钉在页面底部">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fff', borderRadius: 6, padding: '1px 5px', boxShadow: '0 1px 5px rgba(16,40,80,0.12)' }}>
              <span style={{ fontSize: 11, color: '#888' }}>位置</span>
              <Segmented
                size="small"
                value={vAlign}
                onChange={(v) => props.onMutateGroup(g => { g.style = { ...g.style, vertical_align: v === 'flow' ? undefined : (v as 'center' | 'bottom') }; })}
                options={[{ label: '跟随正文', value: 'flow' }, { label: '居中', value: 'center' }, { label: '底部', value: 'bottom' }]}
              />
            </span>
          </Tooltip>
          <Tag color="default" style={{ margin: 0, background: '#fff', boxShadow: '0 1px 5px rgba(16,40,80,0.12)' }}>🔒 签发分区·系统固定</Tag>
        </div>
      </div>
    );
  }
  return inner;
}

// ─── 结果表编辑（单元格值 + 增删行/列 + 列宽 + 合并单元格）─────────────────
// 列宽存 columns[].width、合并存 cells[].colspan/rowspan，渲染器(renderReportResultTableTypst)已支持，此处补编辑 UI。
function ResultTableEditor(props: {
  field: FieldDefinition;
  ctx: any;
  sectionKey: string;
  divergedPaths: Set<string>;
  originalValues: Record<string, { label: string; value: string }>;
  onCell: (rowId: string, colId: string, val: string) => void;
  onAddRow: () => void;
  onRemoveRow: (rowId: string) => void;
  onMutate: (fn: (f: FieldDefinition) => void) => void;
}) {
  return <AutoTableBlock title={props.field.label || '检测结果表'} tag={<Tag color="blue">结果表</Tag>} field={props.field} ctx={props.ctx} onMutate={props.onMutate} />;
}

/**
 * 自由网格编辑器（画布式）——搬自原始记录「试验数据表」画布的交互：
 *  - 任意增删行 / 列；表头、单元格直接点改；
 *  - 列宽：拖列右缘改 fr（双击恢复自动）；行高：拖行下缘改 cm（双击恢复自动）；
 *  - 数据模型 = { columns:[{id,label,width}], rows:[{id,height}], cells:{`rowId::colId`:value} }，
 *    与 conclusion_table.free_* 一一对应。纯字符串值，不绑定数据源（实例内自由填）。
 */
function FreeGridEditor({ columns, rows, cells, spans, onMutate }: {
  columns: Array<{ id: string; label: string; width?: string }>;
  rows: Array<{ id: string; height?: string }>;
  cells: Record<string, string>;
  spans?: Record<string, { colspan?: number; rowspan?: number }>;
  onMutate: (fn: (f: FieldDefinition) => void) => void;
}) {
  const sp = spans || {};
  const ct = (f: FieldDefinition) => (f.free_table = f.free_table || { columns: [], rows: [], cells: {} });
  const setCols = (next: any[]) => onMutate(f => { ct(f).columns = next; });
  const setRows = (next: any[]) => onMutate(f => { ct(f).rows = next; });
  const setColLabel = (id: string, v: string) => setCols(columns.map(c => c.id === id ? { ...c, label: v } : c));
  const setColWidth = (id: string, v?: string) => setCols(columns.map(c => c.id === id ? { ...c, width: v || undefined } : c));
  const setRowHeight = (id: string, v?: string) => setRows(rows.map(r => r.id === id ? { ...r, height: v || undefined } : r));
  const pruneSpans = (obj: Record<string, any> | undefined, dropId: string) => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj || {})) { const [rid, cid] = k.split('::'); if (rid !== dropId && cid !== dropId) out[k] = v; }
    return out;
  };
  const addCol = (afterIdx?: number) => onMutate(f => {
    const c = ct(f); const arr = [...(c.columns || [])];
    const col = { id: newId('fc'), label: '新列' };
    arr.splice(afterIdx == null ? arr.length : afterIdx + 1, 0, col); c.columns = arr;
  });
  const removeCol = (id: string) => onMutate(f => {
    const c = ct(f); c.columns = (c.columns || []).filter(x => x.id !== id);
    const nc: Record<string, string> = {}; for (const [k, v] of Object.entries(c.cells || {})) if (!k.endsWith(`::${id}`)) nc[k] = v; c.cells = nc;
    c.spans = pruneSpans(c.spans, id);
  });
  const addRow = (afterIdx?: number) => onMutate(f => {
    const c = ct(f); const arr = [...(c.rows || [])];
    arr.splice(afterIdx == null ? arr.length : afterIdx + 1, 0, { id: newId('fr') }); c.rows = arr;
  });
  const removeRow = (id: string) => onMutate(f => {
    const c = ct(f); c.rows = (c.rows || []).filter(x => x.id !== id);
    const nc: Record<string, string> = {}; for (const [k, v] of Object.entries(c.cells || {})) if (!k.startsWith(`${id}::`)) nc[k] = v; c.cells = nc;
    c.spans = pruneSpans(c.spans, id);
  });
  const setCell = (rowId: string, colId: string, v: string) => onMutate(f => {
    const c = ct(f); c.cells = { ...(c.cells || {}), [`${rowId}::${colId}`]: v };
  });
  // 合并/拆分：在选中主格上设跨列/跨行（1=拆分，删除该 span 键；并保证该格在 cells 里存在＝主格）
  const setSpan = (rowId: string, colId: string, key: 'colspan' | 'rowspan', val: number) => onMutate(f => {
    const c = ct(f); const k = `${rowId}::${colId}`;
    const next = { ...(c.spans || {}) }; const cur = { ...(next[k] || {}) } as { colspan?: number; rowspan?: number };
    if (val > 1) cur[key] = val; else delete cur[key];
    if (cur.colspan || cur.rowspan) next[k] = cur; else delete next[k];
    c.spans = next;
    if (!(k in (c.cells || {}))) c.cells = { ...(c.cells || {}), [k]: '' };
  });

  // 选中格（用于合并控制）
  const [sel, setSel] = useState<{ rowId: string; colId: string } | null>(null);
  // 被合并主格盖住的格子（按列/行顺序），渲染时跳过
  const colIndex = new Map(columns.map((c, i) => [c.id, i]));
  const rowIndex = new Map(rows.map((r, i) => [r.id, i]));
  const covered = new Set<string>();
  for (const [k, s] of Object.entries(sp)) {
    const [rid, cid] = k.split('::'); const ri = rowIndex.get(rid), ci = colIndex.get(cid);
    if (ri == null || ci == null) continue;
    const cs = Math.min(Math.max(s.colspan ?? 1, 1), columns.length - ci);
    const rs = Math.min(Math.max(s.rowspan ?? 1, 1), rows.length - ri);
    for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) { if (dr || dc) { const rr = rows[ri + dr], cc = columns[ci + dc]; if (rr && cc) covered.add(`${rr.id}|${cc.id}`); } }
  }
  const spanOf = (rowId: string, colId: string) => sp[`${rowId}::${colId}`] || {};
  const selSpan = sel ? spanOf(sel.rowId, sel.colId) : {};
  const selCi = sel ? (colIndex.get(sel.colId) ?? 0) : 0;
  const selRi = sel ? (rowIndex.get(sel.rowId) ?? 0) : 0;

  // 拖拽改列宽(fr)/行高(cm)——指针捕获，与画布同款手感
  const [drag, setDrag] = useState<{ kind: 'col' | 'row'; id: string; start: number; startVal: number } | null>(null);
  const frOf = (w?: string) => (w && /fr$/.test(w)) ? parseFloat(w) : 1;
  const cmOf = (h?: string) => (h && /cm$/.test(h)) ? parseFloat(h) : 0;

  return (
    <div style={{ overflowX: 'auto' }}>
      {/* 选中格的合并控制条（与结果表同款）：跨列/跨行；1=拆分 */}
      {sel && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, padding: '3px 6px', background: '#f0f7ff', border: '1px solid #d6e4ff', borderRadius: 4, fontSize: 12 }}>
          <span style={{ color: '#555' }}>选中格 跨列</span>
          <InputNumber size="small" min={1} max={columns.length - selCi} style={{ width: 56 }}
            value={selSpan.colspan || 1} onChange={(v) => setSpan(sel.rowId, sel.colId, 'colspan', Number(v) || 1)} />
          <span style={{ color: '#555' }}>跨行</span>
          <InputNumber size="small" min={1} max={rows.length - selRi} style={{ width: 56 }}
            value={selSpan.rowspan || 1} onChange={(v) => setSpan(sel.rowId, sel.colId, 'rowspan', Number(v) || 1)} />
          <span style={{ color: '#999', fontSize: 11 }}>（设 1 = 拆分）</span>
          <Button size="small" type="text" onClick={() => setSel(null)}>取消选中</Button>
        </div>
      )}
      <table style={{ borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed', minWidth: '100%' }}>
        <thead>
          <tr>
            <th style={{ width: 30, border: '1px solid #eee', background: '#fafafa' }} />
            {columns.map((c, ci) => (
              <th key={c.id} style={{ position: 'relative', border: '1px solid #eee', padding: '2px 4px', background: '#f7f9fc', minWidth: 70 }}>
                <Input size="small" variant="borderless" value={c.label} placeholder="列名"
                  style={{ fontSize: 12, fontWeight: 600, textAlign: 'center', padding: 0 }}
                  onChange={(e) => setColLabel(c.id, e.target.value)} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                  <span style={{ fontSize: 9, color: '#bbb' }}>{c.width || 'auto'}</span>
                  <Tooltip title="在右侧插入一列"><Button size="small" type="text" style={{ minWidth: 14, height: 14, padding: 0, fontSize: 10 }} icon={<PlusOutlined />} onClick={() => addCol(ci)} /></Tooltip>
                  <Tooltip title="删除此列"><Button size="small" type="text" danger style={{ minWidth: 14, height: 14, padding: 0, fontSize: 10 }} icon={<DeleteOutlined />} onClick={() => removeCol(c.id)} /></Tooltip>
                </div>
                {/* 列右缘：拖拽改列宽(fr)，双击恢复自动 */}
                <div title="拖拽调整列宽，双击恢复自动"
                  onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag({ kind: 'col', id: c.id, start: e.clientX, startVal: frOf(c.width) }); }}
                  onPointerMove={(e) => { if (drag?.kind !== 'col' || drag.id !== c.id) return; const fr = Math.max(0.3, Math.round((drag.startVal + (e.clientX - drag.start) / 60) * 10) / 10); setColWidth(c.id, `${fr}fr`); }}
                  onPointerUp={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); setDrag(null); }}
                  onDoubleClick={(e) => { e.stopPropagation(); setColWidth(c.id, undefined); }}
                  style={{ position: 'absolute', top: 0, right: -3, width: 7, height: '100%', cursor: 'col-resize', zIndex: 2 }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r.id}>
              <td style={{ position: 'relative', width: 30, textAlign: 'center', border: '1px solid #eee', background: '#fafafa', color: '#999' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ fontSize: 10 }}>{ri + 1}</span>
                  <Tooltip title="删除此行"><Button size="small" type="text" danger style={{ minWidth: 14, height: 14, padding: 0, fontSize: 10 }} icon={<DeleteOutlined />} onClick={() => removeRow(r.id)} /></Tooltip>
                  {r.height && <span style={{ fontSize: 8, color: '#bbb' }}>{r.height}</span>}
                </div>
                {/* 行下缘：拖拽改行高(cm)，双击恢复自动 */}
                <div title="拖拽调整行高，双击恢复自动"
                  onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag({ kind: 'row', id: r.id, start: e.clientY, startVal: cmOf(r.height) }); }}
                  onPointerMove={(e) => { if (drag?.kind !== 'row' || drag.id !== r.id) return; const cm = Math.max(0, Math.round((drag.startVal + (e.clientY - drag.start) / 37.8) * 10) / 10); setRowHeight(r.id, cm ? `${cm}cm` : undefined); }}
                  onPointerUp={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); setDrag(null); }}
                  onDoubleClick={(e) => { e.stopPropagation(); setRowHeight(r.id, undefined); }}
                  style={{ position: 'absolute', left: 0, bottom: -3, width: '100%', height: 7, cursor: 'row-resize', zIndex: 2 }} />
              </td>
              {columns.map((c, ci) => {
                if (covered.has(`${r.id}|${c.id}`)) return null;   // 被合并主格盖住：不出格
                const s = spanOf(r.id, c.id);
                const cs = Math.min(Math.max(s.colspan ?? 1, 1), columns.length - ci);
                const rs = Math.min(Math.max(s.rowspan ?? 1, 1), rows.length - (rowIndex.get(r.id) ?? 0));
                const selected = sel?.rowId === r.id && sel?.colId === c.id;
                return (
                  <td key={c.id} colSpan={cs} rowSpan={rs} onClick={() => setSel({ rowId: r.id, colId: c.id })}
                    style={{ border: selected ? '2px solid #1677ff' : '1px solid #eee', padding: 1, background: selected ? '#eaf3ff' : (cs > 1 || rs > 1) ? '#fafcff' : undefined, cursor: 'pointer' }}>
                    <Input size="small" variant="borderless" value={cells[`${r.id}::${c.id}`] ?? ''}
                      style={{ fontSize: 12, textAlign: 'center', padding: '0 2px' }}
                      onChange={(e) => setCell(r.id, c.id, e.target.value)} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <Space style={{ marginTop: 6 }}>
        <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => addRow()}>添加行</Button>
        <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => addCol()}>添加列</Button>
      </Space>
    </div>
  );
}

// 统一「自由编辑表格」块：三类报告表（结论/结果/设备）共用——纯文本网格 + 「恢复自动」，UI 完全一致。
function FreeTableBlock({ title, field, onMutate }: {
  title: string; field: FieldDefinition; onMutate: (fn: (f: FieldDefinition) => void) => void;
}) {
  const ft = field.free_table || { columns: [], rows: [], cells: {} };
  return (
    <EditorBlock title={title} accent="#722ed1" tag={<Tag color="purple">自由编辑</Tag>}
      extra={<Tooltip title="放弃逐格文本、恢复为按数据自动生成（结论表/设备表自动汇总、结果表绑定）">
        <Button size="small" onClick={() => onMutate(f => { f.free_table = undefined; })}>恢复自动</Button></Tooltip>}>
      <FreeGridEditor columns={ft.columns || []} rows={ft.rows || []} cells={ft.cells || {}} spans={ft.spans} onMutate={onMutate} />
    </EditorBlock>
  );
}

// 「自由编辑表格」按钮：把当前表格内容（含表头/汇总行/设备行）快照成纯文本网格，逐格可改。
function EnterFreeButton({ ctx, onMutate }: {
  ctx: any; onMutate: (fn: (f: FieldDefinition) => void) => void;
}) {
  return (
    <Tooltip title="自由编辑：把当前表格内容（含表头 / 汇总行）转成纯文本网格——每格可改、可任意增删行列、拖拽调列宽行高">
      <Button size="small" onClick={() => onMutate(f => { f.free_table = buildFreeTableFromField(f, ctx); })}>自由编辑表格</Button>
    </Tooltip>
  );
}

// 只读网格预览（与 FreeGridEditor 同款合并渲染，但不可编辑）——所有表 auto 模式共用，
// 由 buildFreeTableFromField 出同一份网格，保证【自动/自由显示一致、且与报告一致】。
function ReadonlyGrid({ columns, rows, cells, spans }: {
  columns: Array<{ id: string; label: string; width?: string }>;
  rows: Array<{ id: string; height?: string }>;
  cells: Record<string, string>;
  spans?: Record<string, { colspan?: number; rowspan?: number }>;
}) {
  const sp = spans || {};
  const colIndex = new Map(columns.map((c, i) => [c.id, i]));
  const rowIndex = new Map(rows.map((r, i) => [r.id, i]));
  const covered = new Set<string>();
  for (const [k, s] of Object.entries(sp)) {
    const [rid, cid] = k.split('::'); const ri = rowIndex.get(rid), ci = colIndex.get(cid);
    if (ri == null || ci == null) continue;
    const cs = Math.min(Math.max(s.colspan ?? 1, 1), columns.length - ci);
    const rs = Math.min(Math.max(s.rowspan ?? 1, 1), rows.length - ri);
    for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) { if (dr || dc) { const rr = rows[ri + dr], cc = columns[ci + dc]; if (rr && cc) covered.add(`${rr.id}|${cc.id}`); } }
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
        <thead><tr>{columns.map(c => (
          <th key={c.id} style={{ border: '1px solid #eee', padding: '3px 6px', background: '#fafafa', fontWeight: 600, textAlign: 'center' }}>{c.label || ''}</th>
        ))}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={Math.max(columns.length, 1)} style={{ border: '1px solid #eee', padding: 6, color: '#999', textAlign: 'center' }}>（空表）</td></tr>}
          {rows.map((r, ri) => (
            <tr key={r.id}>
              {columns.map((c, ci) => {
                if (covered.has(`${r.id}|${c.id}`)) return null;
                const s = sp[`${r.id}::${c.id}`] || {};
                const cs = Math.min(Math.max(s.colspan ?? 1, 1), columns.length - ci);
                const rs = Math.min(Math.max(s.rowspan ?? 1, 1), rows.length - ri);
                return (
                  <td key={c.id} colSpan={cs > 1 ? cs : undefined} rowSpan={rs > 1 ? rs : undefined}
                    style={{ border: '1px solid #eee', padding: '3px 6px', textAlign: 'center', color: '#555', background: (cs > 1 || rs > 1) ? '#fafcff' : undefined, verticalAlign: 'middle' }}>
                    {cells[`${r.id}::${c.id}`] || ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// auto 模式统一块：只读预览（buildFreeTableFromField 出网格）+ 唯一编辑入口「自由编辑表格」。所有表一致。
function AutoTableBlock({ title, accent, tag, field, ctx, onMutate, notice }: {
  title: string; accent?: string; tag: React.ReactNode; field: FieldDefinition; ctx: any;
  onMutate: (fn: (f: FieldDefinition) => void) => void; notice?: React.ReactNode;
}) {
  const ft = buildFreeTableFromField(field, ctx);
  return (
    <EditorBlock title={title} accent={accent} tag={tag} extra={<EnterFreeButton ctx={ctx} onMutate={onMutate} />}>
      {notice}
      <ReadonlyGrid columns={ft.columns} rows={ft.rows} cells={ft.cells} spans={ft.spans} />
      <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>只读预览（与报告一致）。要改任意内容（表头 / 单元格 / 增删行列 / 行高列宽），点右上「自由编辑表格」。</div>
    </EditorBlock>
  );
}

// 设备信息表：只读预览 + 「自由编辑表格」。
function EquipmentTableEditor({ field, ctx, onMutate }: {
  field: FieldDefinition; ctx: any; onMutate: (fn: (f: FieldDefinition) => void) => void;
}) {
  return <AutoTableBlock title={field.label || '主要检测设备'} accent="#13c2c2" tag={<Tag color="cyan">设备表</Tag>} field={field} ctx={ctx} onMutate={onMutate} />;
}

// 检测结论表：只读预览（按本报告项目自动展开）+ 「自由编辑表格」。
function ConclusionTableEditor({ field, ctx, onMutate }: {
  field: FieldDefinition; ctx: any; onMutate: (fn: (f: FieldDefinition) => void) => void;
}) {
  return <AutoTableBlock title={field.label || '检测结论'} accent="#52c41a" tag={<Tag color="blue">自动</Tag>} field={field} ctx={ctx} onMutate={onMutate} />;
}
