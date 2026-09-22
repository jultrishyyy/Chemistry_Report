import { revealInScrollPanes } from '../../utils/scrollWithin';
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
import { useEffect, useState, useRef, useMemo, useCallback, Fragment, type CSSProperties, type ReactNode } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Button, message, Spin, Tag, Space, Alert, Input, InputNumber, Card, Empty, Tooltip, Divider, Dropdown, List,
  Select as AntSelect, Upload, Segmented, ColorPicker, Modal, Checkbox, DatePicker, Popover,
} from 'antd';
import {
  ArrowLeftOutlined, PlusOutlined, DeleteOutlined, RollbackOutlined,
  WarningOutlined, ArrowUpOutlined, ArrowDownOutlined, LinkOutlined,
  BoldOutlined, ItalicOutlined, AlignLeftOutlined, AlignCenterOutlined, AlignRightOutlined, BgColorsOutlined, SettingOutlined,
  VerticalAlignBottomOutlined, UnorderedListOutlined, DoubleLeftOutlined, EyeOutlined, DownloadOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { resolveReportFieldValue, flattenContentDocValues, diffContentDocValues, renderContentDoc, buildFreeTableFromField, resolveReportFreeGridValues } from '../../../../shared/typst-generator';
import type { FieldDefinition, FieldGroup, CellBinding, StyleOverride } from '../../../../shared/types';
import FormatPanel, { REPORT_FONTS } from '../../components/FieldEditor/FormatPanel';
import { isSignatureGroup } from '../../components/FieldEditor/section-presets';
import TypstViewer, { markerHighlightForField, type TypstViewerHandle } from '../../components/TypstViewer';
import ReportSourceDataPanel from '../../components/ReportEditor/ReportSourceDataPanel';
import { reportTableClipboard } from '../../utils/reportTableClipboard';
import { readReportPhoto } from '../../utils/reportPhotoClipboard';
import { hideAutomaticSampleTable } from '../../../../shared/report-table-visibility';
import { signaturePosition, SIGNATURE_POSITION_OPTIONS } from '../../../../shared/signature-position';
import { collectReportSourceChanges } from '../../../../shared/report-source-review';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { useAuth } from '../../auth';
import AutoGrowTextArea from '../../components/AutoGrowTextArea';
import { handleExcelTableKeyDown } from '../../utils/excelTableNavigation';
import { reportFigureArrow } from '../../../../shared/report-figure-navigation';
import ClosablePopover from '../../components/ClosablePopover';
import { useAutoSave } from '../../hooks/useAutoSave';
import { useExclusiveEditLease } from '../../hooks/useCollaboration';
import DocumentCollaborationStatus from '../../components/DocumentCollaborationStatus';
import EditAttemptGuard from '../../components/EditAttemptGuard';
import { useEditorHistory } from '../../hooks/useEditorHistory';
import { reportHistoryShortcut } from '../../utils/reportHistoryShortcut';
import EditorSplit from '../../components/EditorSplit';
import EditorHistoryControls from '../../components/EditorHistoryControls';
import ReadonlyRecordViewer from '../../components/ReadonlyRecordViewer';
import ReportImageLayoutToolbar from '../../components/ReportEditor/ReportImageLayoutToolbar';
import ReportImageManagerPopover from '../../components/ReportEditor/ReportImageManagerPopover';
import ReportCrossSelection, { ReportCrossFigure } from '../../components/ReportEditor/ReportCrossSelection';
import { applyReportTableFont, reportFontStyle, reportStyleFontValues, reportTableFontValues } from '../../../../shared/report-bulk-font';
import ImageSectionNotes from '../../components/FieldEditor/ImageSectionNotes';
import { migrateGalleryGroups } from '../../components/FieldEditor/migrateImageGallery';
import { parseSpreadsheetClipboard, serializeSpreadsheetClipboard } from '../../utils/spreadsheetClipboard';
import { findImageCollection, imageCollectionFromLegacy, imageCollectionKey, type RecordImageCollection } from '../../../../shared/image-collection';
import { pickReportImageData } from '../../../../shared/report-image-state';
import { prepareImageForUpload } from '../../utils/imageProcessing';
import ImageProcessButton from '../../components/ImageProcessButton';
import RecordImageCollectionEditor from '../../components/RecordImageCollectionEditor';
import dayjs from 'dayjs';
import { makeReportManualTable, makeReportManualImages, reportSpacerSize, insertIntoReportParagraph, type ReportInsertOptions } from '../../../../shared/report-document-editing';
import ReportParagraphEditor from '../../components/ReportEditor/ReportParagraphEditor';
import ReportCellTextArea from '../../components/ReportEditor/ReportCellTextArea';
import ReportRichText from '../../components/ReportEditor/ReportRichText';
import ReportContinuousText from '../../components/ReportEditor/ReportContinuousText';
import { canEditContinuousText, continuousTextValue, insertContinuousFigure } from '../../../../shared/report-continuous-text';
import { canContinueReportBlocks, enterBesideReportBlock, removeReportBlock, removeReportBlockWithFocus, reportTextEndPosition } from '../../../../shared/report-block-navigation';
import { reportTextRuns, reportTextRunValue, updateReportTextRun } from '../../../../shared/report-text-runs';
import { moveReportFigure } from '../../../../shared/report-figure-move';
import { snapshotReportFigure, instantiateReportFigure } from '../../../../shared/report-figure-copy';
import { reportBodyLayout, reportFontStack, reportLengthPt } from '../../../../shared/report-body-layout';
import { ReportToolbarContext, isReportToolbarOverlay, retainsReportTextSelection } from '../../components/ReportEditor/ReportToolbarContext';
import ReportPaperViewport from '../../components/ReportEditor/ReportPaperViewport';
import ReportFigureEdges from '../../components/ReportEditor/ReportFigureEdges';
import ReportFigureTools, { ReportFigureToolsContext } from '../../components/ReportEditor/ReportFigureTools';
import { reportFigureClickTarget } from '../../components/ReportEditor/reportFigureClick';
import { useReportPhotoFocus } from '../../components/ReportEditor/useReportPhotoFocus';
import { reportProjectHeadingValue } from '../../../../shared/report-project-heading';
import { reportImageTitleStyle } from '../../../../shared/report-image-title-style';
import { continueImageSection } from '../../../../shared/report-image-continuation';
import { deleteBlankBesideFigure } from '../../../../shared/report-blank-boundary';
import { reportEditableTable, editReportTable } from '../../../../shared/report-editable-table';
import ReportSectionHeading from '../../components/ReportEditor/ReportSectionHeading';
import { removeLegacyImageNotes, detachReportFigureNotes } from '../../../../shared/report-detached-notes';
import { insertReportTableAxis, deleteReportTableAxis, resizeReportTableMerge, mergeReportTableRange, deleteReportTableRange, resizeReportTable } from '../../../../shared/report-table-structure';
import { ReportInsertionContext, type ReportInsertionTarget, type ReportInsertAction } from '../../components/ReportEditor/ReportInsertionContext';
import ReportImagePreview from '../../components/ReportEditor/ReportImagePreview';
import { reportImagePreview, reportCollectionPreview } from '../../../../shared/report-image-preview';
import { readReportRichDocument, encodeReportRichDocument, reportRichPlainText } from '../../../../shared/report-rich-document';
import { reportFigureTitle, setReportFigureTitle, usesIndependentTableTitle } from '../../../../shared/report-figure-title';

const API = '/api';

interface Section {
  name: string;
  title?: string;
  seq?: number;
  report_heading?: string;
  page_break?: boolean;
  groups: FieldGroup[];
  layout_options?: Record<string, any>;
  ctx: any;
}

function sectionThemeValues(section: Section): { font: string; size: number; figureGapPt: number; fieldGap: string; sectionGap: string } {
  const theme = (section.layout_options?.theme_config || {}) as Record<string, any>;
  const layout = reportBodyLayout(theme);
  const size = layout.size;
  const raw = theme.line_gap;
  let figureGapPt = 0.6 * size;
  if (typeof raw === 'number') figureGapPt = raw * size;
  else if (typeof raw === 'string' && raw.endsWith('em')) figureGapPt = (parseFloat(raw) || 0.6) * size;
  else if (typeof raw === 'string' && raw.endsWith('pt')) figureGapPt = parseFloat(raw) || figureGapPt;
  return { font: theme.font || 'Songti SC', size, figureGapPt: Math.round(figureGapPt * 10) / 10,
    fieldGap: layout.fieldGap, sectionGap: layout.sectionGap };
}
interface ContentDoc {
  source_review_revision?: string;
  source_reviews?: string[];
  cover: Section;
  projects: Section[];
}

const lit = (text: string): CellBinding => ({ source: 'literal', text });
const NORMAL_TYPES = new Set(['text', 'number', 'date', 'textarea', 'select', 'checkbox']);
// 设备表 / 图片表仍自动（结构编辑见后续）；检测结论表已可编辑（见 ConclusionTableEditor），不在此列。
const REPORT_AUTO_TYPES = new Set(['report_image_gallery']);
// 三类报告表共用统一「自由编辑表格」（free_table 置位后走同一个纯文本网格编辑器）
const TABLE_FREE_TYPES = new Set(['report_result_table', 'report_conclusion_table', 'report_equipment_table', 'report_sample_table', 'report_sample_description_table']);
// 不设「字段间距」的字段类型（表格/图片/空行——它们间距随文档样式·字段间距，不单独配）
const FIELD_GAP_EXCLUDED = new Set(['report_result_table', 'report_conclusion_table', 'report_equipment_table', 'report_sample_table', 'report_sample_description_table', 'report_photo_table', 'report_image_gallery', 'image', 'data_matrix', 'spacer']);
// 支持「表格上方标签 + 表格下方备注」编辑卡（与图片同款）的报告表格类型。
const LABELCAP_TYPES = new Set(['data_matrix', 'free_grid', 'report_result_table', 'report_equipment_table', 'report_sample_table', 'report_sample_description_table', 'report_conclusion_table', 'report_photo_table', 'report_image_gallery']);

let uid = 0;
const newId = (p: string) => `${p}_${Date.now()}_${uid++}`;
let draggedReportFigure: string | null = null;
// Clipboard only carries an opaque token, never executes/imports external field JSON.
const reportFigureClipboard = new Map<string, FieldDefinition>();
const REPORT_FIGURE_MIME = 'application/x-report-figure-copy';
const reportLineHeightCSS = (value?: string) => value && /^\d+(?:\.\d+)?(?:em|pt|cm|mm|in)?$/.test(value)
  ? `calc(1em + ${/[a-z]$/.test(value) ? value : `${value}em`})` : undefined;

/** 新建"内容"字段（分区里插入 / 顶部工具栏「添加内容」共用同一份定义，避免两处漂移）。 */
type InsertKind = 'spacer' | 'paragraph' | 'heading' | 'note' | 'photo_table' | 'image' | 'table';
function makeContentField(kind: InsertKind, options?: ReportInsertOptions): FieldDefinition {
  const code = newId(kind);
  const copied = options?.copyToken && reportFigureClipboard.get(options.copyToken);
  if (copied) return instantiateReportFigure(copied, code);
  if (kind === 'table') return makeReportManualTable(code, options);
  if (kind === 'heading') return { id: code, code, label: '小标题', type: 'text', hide_label: true, style: { weight: 'bold', size: '13pt' }, binding: lit('小标题') } as FieldDefinition;
  if (kind === 'paragraph') return { id: code, code, label: '段落', type: 'text', hide_label: true, rich: true, binding: lit('') } as FieldDefinition;
  if (kind === 'spacer') return { id: code, code, label: '空行', type: 'spacer', hide_label: true, spacer_height: '1em' } as FieldDefinition;
  if (kind === 'photo_table') return { id: code, code, label: '原样照片表', type: 'report_photo_table', hide_label: true, photo_table: { caption_label: '样品描述', caption_text: '见原始样品照片。', header: '原始样品', cols: 1 } } as FieldDefinition;
  if (kind === 'image') return makeReportManualImages(code, options);
  return { id: code, code, label: '说明', type: 'text', binding: lit('') } as FieldDefinition;
}

/**
 * 统一「字段配置块」外壳：左侧彩色强调条 + 浅灰标题栏（标题/类型标签/计数提示/右侧操作）+ 留白正文。
 * 让结果表 / 结论表 / 图库 / 照片表等特殊编辑器视觉一致、不再是各写各的拼贴框。
 */
function EditorBlock({ title, tag, hint, extra, accent = '#1677ff', children }: {
  title: ReactNode; tag?: ReactNode; hint?: ReactNode; extra?: ReactNode; accent?: string; children: ReactNode;
}) {
  return (
    <div className="report-editor-block" style={{ border: '1px solid #eef0f4', borderRadius: 8, marginBottom: 8, background: '#fff', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
      <div className="report-block-tools" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#f7f9fc',
        borderBottom: '1px solid #eef0f4', borderLeft: `3px solid ${accent}`, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#33415c' }}>{title}</span>
        {tag}
        {hint && <span style={{ fontSize: 11, color: '#9aa4b2' }}>{hint}</span>}
        <div style={{ flex: 1 }} />
        {extra}
      </div>
      <div className="report-block-body" style={{ padding: 10 }}>{children}</div>
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
function normalizeContentDoc(cd: any, independentNotes = false): any {
  if (!cd) return cd;
  const mgGroups = (obj: any) => {
    if (!obj) return obj;
    // 旧版“自动图库”未存 source_field_codes 时，运行期原本会抓取关联原始记录的全部图片字段。
    // 迁移为统一图片分区前先补齐这些来源，避免被迁成空分区而出现“添加来源”或不显示照片。
    const sourceCodes = (obj.ctx?.linked_record_template?.groups || [])
      .flatMap((g: any) => g.fields || []).filter((f: any) => f.type === 'image').map((f: any) => f.code);
    const groups = (obj.groups || []).map((group: any) => {
      const legacy = (group.fields || []).find((field: any) => field.type === 'report_image_gallery');
      const cfg = legacy?.image_gallery;
      if (!legacy || !cfg || Array.isArray(cfg.items) || (Array.isArray(cfg.source_field_codes) && cfg.source_field_codes.length) || !sourceCodes.length) return group;
      return { ...group, fields: group.fields.map((field: any) => field === legacy
        ? { ...field, image_gallery: { ...cfg, source_field_codes: sourceCodes } } : field) };
    });
    const normalized = removeLegacyImageNotes(migrateGalleryGroups(groups));
    return { ...obj, groups: independentNotes ? detachReportFigureNotes(normalized) : normalized };
  };
  return { ...cd, cover: mgGroups(cd.cover), projects: (cd.projects || []).map(mgGroups) };
}

/** 统一上传：图片落 <根>/<订单号>/_首页/<字段名>，返回 {server_path,...}。供 PhotoLayoutEditor / ImageSectionEditor 共用。 */
async function uploadImageFile(file: File, orderNo: string | undefined, fieldName: string): Promise<any | null> {
  try {
    const prepared = await prepareImageForUpload(file);
    const fd = new FormData(); fd.append('file', prepared);
    if (orderNo) fd.append('order_no', orderNo);
    fd.append('record_dir', COVER_DIR);
    fd.append('field_name', fieldName);
    const res = await axios.post('/api/images/upload', fd);
    return res.data;
  } catch (e: any) { message.error('上传失败：' + (e.message || '')); return null; }
}

function PhotoLayoutEditor({ field, ctx, orderNo, kind, headerExtra, onMutate, onMutateCtx, toolbarOnly, inheritedFont, inheritedSize }: {
  field: FieldDefinition; ctx: any; orderNo?: string; kind: 'gallery' | 'photo_table' | 'image_field'; headerExtra?: ReactNode;
  onMutate: (fn: (f: FieldDefinition) => void) => void; onMutateCtx: (fn: (ctx: any) => void) => void;
  toolbarOnly?: boolean; inheritedFont?: string; inheritedSize?: number;
}) {
  const hasSource = kind === 'gallery';
  const isImageField = kind === 'image_field';   // 首页 image 字段：配置散落在 field 顶层（image_*），照片在 field.image_photos
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
  const galReplace = async (code: string, file: File) => { if (!code) { message.warning('请先绑定来源'); return false; } const d = await upload(file, recImgFields.find(f => f.code === code)?.label || code); if (d) onMutateCtx(c => { const rd = c.record_raw_data || (c.record_raw_data = {}); rd[code] = [{ ...(Array.isArray(rd[code]) ? rd[code][0] : {}), ...d }]; }); return false; };
  const galClear = (code: string) => onMutateCtx(c => { if (c.record_raw_data) c.record_raw_data[code] = []; });
  const galSetDisplay = (code: string, size: { widthCm?: number; heightCm?: number; rotation?: number }) => onMutateCtx(c => {
    const rd = c.record_raw_data || (c.record_raw_data = {});
    const photo = Array.isArray(rd[code]) ? rd[code][0] : undefined;
    if (photo) rd[code] = [{ ...photo, display_width_cm: size.widthCm, display_height_cm: size.heightCm, display_rotation: size.rotation || undefined }];
  });

  // 共用模式·直接多图上传（photo_table → field.photo_table.photos；image_field → field.image_photos）
  const ptPhotos: any[] = Array.isArray(cfg.photos) ? cfg.photos : [];
  // 首页原样照片 / 独立图片也复用数据录入的横向图片卡。仍落回既有 photos 数组，
  // 所以历史文档与 Typst 渲染无需迁移。
  const directPhotoGroup = {
    id: `report_direct_${field.id}`,
    label: field.label || (isImageField ? '图片' : '原样照片'),
    fields: [{ id: field.id, code: field.code, label: field.label || '图片', type: 'image' }],
    image_layout: { width_cm: cfg.width_cm ?? 7, height_cm: cfg.height_cm ?? 6 },
  } as FieldGroup;
  const directPhotoCollection = {
    kind: 'image_collection' as const,
    version: 1 as const,
    source_group_id: directPhotoGroup.id,
    source_field_codes: [field.code],
    items: ptPhotos.map((photo: any, index: number) => ({
      id: String(photo?.id || photo?.server_path || photo?.url || `report_photo_${index}`),
      title: photo?.title || photo?.original_name || photo?.name || `${field.label || '图片'}${index + 1}`,
      source_field_code: field.code,
      photo,
    })),
  };
  const setDirectPhotoCollection = (next: RecordImageCollection) => setCfg({
    photos: next.items.map(item => ({
      ...item.photo,
      id: item.id,
      title: item.title || item.photo?.title,
    })),
  });
  // 每张一个标题模式的行（items）
  const items: any[] = Array.isArray(cfg.items) ? cfg.items : [];
  const setItems = (next: any[]) => setCfg({ items: next });
  const updItem = (id: string, patch: any) => setItems(items.map(it => it.id === id ? { ...it, ...patch } : it));
  const addItem = () => setItems([...items, hasSource ? { id: newId('gi'), source_field_code: recImgFields[0]?.code || '', label: '' } : { id: newId('pi'), label: '', photos: [] }]);
  const rmItem = (id: string) => setItems(items.filter(it => it.id !== id));
  const mvItem = (idx: number, dir: -1 | 1) => { const t = idx + dir; if (t < 0 || t >= items.length) return; const n = [...items]; [n[idx], n[t]] = [n[t], n[idx]]; setItems(n); };
  const itemReplace = async (id: string, file: File) => { const d = await upload(file, field.label || field.code); if (d) { const old = items.find(item => item.id === id)?.photos?.[0] || {}; updItem(id, { photos: [{ ...old, ...d }] }); } return false; };
  const itemClear = (id: string) => updItem(id, { photos: [] });

  // 标题模式切换（photo_table 尽量保留已上传照片）
  const switchMode = (mode: 'shared' | 'per') => {
    if (mode === titleMode) return;
    if (!hasSource && mode === 'per' && !items.length && ptPhotos.length) setCfg({ title_mode: 'per', items: ptPhotos.map((p: any, i: number) => ({ id: `pi_${i}_${p.server_path || ''}`.slice(0, 40), label: '', photos: [p] })) });
    else if (!hasSource && mode === 'shared' && !ptPhotos.length && items.length) setCfg({ title_mode: 'shared', photos: items.flatMap(it => Array.isArray(it.photos) ? it.photos : []) });
    else setCfg({ title_mode: mode });
  };

  // 单张照片（替换/删除）——纯渲染函数，避免子组件重挂载
  const singlePhoto = (src: string | undefined, photo: any, onReplace: (file: File) => any, onClear: () => void, onDisplaySizeChange: (size: { widthCm?: number; heightCm?: number }) => void, onPreviewChange: (value: { widthCm?: number; heightCm?: number; rotation: number }) => void, sizeBytes?: number) => (
    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
      {src ? (
        <div style={{ position: 'relative', width: 64, height: 64, border: '1px solid #ddd', borderRadius: 4, overflow: 'hidden' }}>
          <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={onClear} style={{ position: 'absolute', top: 0, right: 0, padding: 0, width: 18, height: 18, background: 'rgba(255,255,255,0.85)' }} />
        </div>
      ) : <div style={{ width: 64, height: 64, border: '1px dashed #ccc', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 11 }}>无图</div>}
      <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => onReplace(file as File)}>
        <Button size="small" icon={<PlusOutlined />}>上传</Button>
      </Upload>
      {src
        ? <ImageProcessButton src={src} sizeBytes={sizeBytes}
            displaySize={{ widthCm: photo?.display_width_cm ?? cfg.width_cm ?? 7, heightCm: photo?.display_height_cm ?? cfg.height_cm ?? 6 }}
            displayRotation={photo?.display_rotation ?? 0}
            onDisplaySizeChange={onDisplaySizeChange} onPreviewChange={onPreviewChange} onProcessed={onReplace} />
        : <ImageProcessButton disabled onProcessed={onReplace} />}
    </div>
  );

  if (toolbarOnly) return <ReportImageLayoutToolbar value={{ ...cfg, title_mode: titleMode }}
    defaultCols={isImageField ? 1 : 2} defaultInset={(isImageField ? field.image_table_style?.inset_pt : cfg.inset_pt) ?? 6}
    onChange={setCfg} onTitleModeChange={switchMode}
    titleStyle={reportImageTitleStyle(field, isImageField && titleMode === 'shared' ? field.label_style : undefined)} inheritedFont={inheritedFont} inheritedSize={inheritedSize}
    onTitleStyleChange={patch => onMutate(f => { f.report_image_title_style = { ...f.report_image_title_style, ...patch }; })} />;

  return (
    <EditorBlock title={field.label || '图片'} accent="#722ed1" extra={headerExtra}
      tag={<Tag color="purple">{hasSource ? '图库' : isImageField ? '文员上传' : '原样照片'}</Tag>}>

      {titleMode === 'shared' ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#888' }}>共用标题</span>
            <AutoGrowTextArea size="small" style={{ width: 180 }} placeholder="表内标题(空=不显示)" value={sharedTitle}
              onChange={(e) => setSharedTitle(e.target.value)} />

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
                  {it.source_field_code && singlePhoto(photoSrc(photosOf(it.source_field_code)[0]), photosOf(it.source_field_code)[0], (file) => galReplace(it.source_field_code, file), () => galClear(it.source_field_code), size => galSetDisplay(it.source_field_code, size), preview => galSetDisplay(it.source_field_code, preview), photosOf(it.source_field_code)[0]?.size_bytes)}
                </div>
              ))}
              <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addItem} disabled={!recImgFields.length}>添加来源</Button>
            </div>
          ) : (
            <RecordImageCollectionEditor
              reportMode
              group={directPhotoGroup}
              collection={directPhotoCollection}
              uploadCtx={{ orderNo, recordDir: COVER_DIR }}
              onChange={setDirectPhotoCollection}
            />
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
                <AutoGrowTextArea size="small" style={{ width: 160 }} placeholder="表内标题(空=不显示)" value={it.label ?? ''} onChange={(e) => updItem(it.id, { label: e.target.value })} />
                <div style={{ flex: 1 }} />
                <Button size="small" type="text" disabled={idx === 0} onClick={() => mvItem(idx, -1)}><ArrowUpOutlined /></Button>
                <Button size="small" type="text" disabled={idx === items.length - 1} onClick={() => mvItem(idx, 1)}><ArrowDownOutlined /></Button>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => rmItem(it.id)} />
              </div>
              {hasSource
                ? (it.source_field_code && singlePhoto(photoSrc(photosOf(it.source_field_code)[0]), photosOf(it.source_field_code)[0], (file) => galReplace(it.source_field_code, file), () => galClear(it.source_field_code), size => galSetDisplay(it.source_field_code, size), preview => galSetDisplay(it.source_field_code, preview), photosOf(it.source_field_code)[0]?.size_bytes))
                : singlePhoto(photoSrc((it.photos || [])[0]), (it.photos || [])[0], (file) => itemReplace(it.id, file), () => itemClear(it.id), size => updItem(it.id, { photos: [{ ...(it.photos || [])[0], display_width_cm: size.widthCm, display_height_cm: size.heightCm }] }), preview => updItem(it.id, { photos: [{ ...(it.photos || [])[0], display_width_cm: preview.widthCm, display_height_cm: preview.heightCm, display_rotation: preview.rotation || undefined }] }), (it.photos || [])[0]?.size_bytes)}
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
 * 常用版式和标题字体在顶部公共栏直接调整；此处只管理图片内容。
 */
function ImageSectionEditor({ group, ctx, orderNo, onMutateCtx, onItemFocus, readOnly = false, editableTitles = false }: {
  group: FieldGroup; ctx: any; orderNo?: string;
  readOnly?: boolean;
  editableTitles?: boolean;
  onMutateCtx: (fn: (ctx: any) => void) => void;
  onItemFocus?: (itemId: string) => void;
}) {
  const rawData = ctx?.record_raw_data || {};
  const existing = findImageCollection(rawData, group);
  // 旧报告的照片按 image_source_code（或 field.code）存放。投影后也统一走数据录入的图片卡，
  // 使首页原样照片和项目照片不会因旧格式而只剩下“图片版式”配置。
  const legacyRaw = { ...rawData };
  for (const field of group.fields) {
    if (field.type !== 'image') continue;
    const sourceCode = field.image_source_code || field.code;
    if (!Array.isArray(legacyRaw[field.code]) && Array.isArray(rawData[sourceCode])) {
      legacyRaw[field.code] = rawData[sourceCode];
    }
  }
  const collection = existing || imageCollectionFromLegacy(group, legacyRaw);
  const setCollection = (next: RecordImageCollection) => onMutateCtx(c => {
    const rd = c.record_raw_data || (c.record_raw_data = {});
    // 永远存到本报告当前分区。避免从首页/原始记录借来的集合 group id 不一致而在下次打开时丢失。
    rd[imageCollectionKey(group.id)] = {
      ...next,
      source_group_id: group.id,
      source_field_codes: group.fields
        .filter(field => field.type === 'image')
        .map(field => field.image_source_code || field.code),
    };
  });
  if (readOnly) return <ReportImagePreview model={reportCollectionPreview(group, collection)}
    onTitleChange={editableTitles && group.image_layout?.title_mode !== 'shared' && collection.items.length ? (index, title) => {
      setCollection({ ...collection, items: collection.items.map((item, i) => i === index ? { ...item, title } : item) });
    } : undefined} />;
  return (
    <RecordImageCollectionEditor
      reportMode
      readOnly={readOnly}
      group={group}
      collection={collection}
      uploadCtx={{ orderNo, recordDir: COVER_DIR }}
      onChange={setCollection}
      onItemFocus={(_index, itemId) => onItemFocus?.(itemId)}
    />
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
  const autoCollapse = (cfg.mode || 'always') === 'auto' && samples.length <= 1; // 单样品 auto：出报告时自动折叠本表
  const notice = samples.length === 1
    ? <Alert type={autoCollapse ? 'info' : 'warning'} showIcon style={{ marginBottom: 6 }}
        message={autoCollapse
          ? '当前仅 1 个样品：本表出报告时会【自动折叠】，由首页「样品名称 / 零件号」字段直接显示，无需手动删除。（如需强制出表，到模板把「单/多样品」改为「始终显示」）'
          : '当前仅 1 个样品，且本表设为「始终显示」，会照样列出 1 行。改回「自动」可让单样品自动折叠。'} />
    : samples.length === 0 ? <div style={{ fontSize: 12, color: '#bbb', marginBottom: 6 }}>暂无样品（生成报告时按委托单自动列出）</div> : null;
  return <AutoTableBlock title={field.label || '样品信息表'} tag={<Tag color="blue">自动</Tag>} field={field} ctx={ctx} onMutate={onMutate} notice={notice} />;
}

export default function ReportInstanceEditor() {
  const [showSourceData, setShowSourceData] = useState(false);
  const [sourcePdf, setSourcePdf] = useState(false);
  const [sourceTarget, setSourceTarget] = useState<{ index: number; code?: string; token: number }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { has } = useAuth();
  const id = searchParams.get('id');
  // 只读查看（已送审报告 / 历史版本）：隐藏保存/工具栏/调整/退回等编辑入口，左侧结构区禁交互，仅看结构 + 右侧 PDF。
  const permissionReadOnly = searchParams.get('readonly') === '1' || !has('report.generate');
  const lease = useExclusiveEditLease({
    resourceType: 'report_instance', resourceId: id,
    enabled: !!id && !permissionReadOnly,
  });
  const readOnly = permissionReadOnly || lease.loading || !lease.acquired;
  const docHistory = useEditorHistory<ContentDoc | null>(null);
  const { value: doc, setValue: setDoc, replaceBaseline: replaceDocBaseline } = docHistory;
  // 最新 doc（ref 每次渲染同步）：保存时取它，防输入控件 onBlur 提交与点「保存」的竞态
  const docRef = useRef<ContentDoc | null>(null);
  docRef.current = doc;
  const [original, setOriginal] = useState<ContentDoc | null>(null);
  const [sourceSnapshot, setSourceSnapshot] = useState<ContentDoc | null>(null);
  const [meta, setMeta] = useState<{ report_no?: string; order_no?: string; version?: number; edited?: boolean; coverOnly?: boolean; warnings?: any[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const downloadInFlight = useRef(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const savedDocSnapshotRef = useRef('');
  const baselineReadyRef = useRef(false);
  useEffect(() => {
    setDirty(!readOnly && !!doc && JSON.stringify(doc) !== savedDocSnapshotRef.current);
  }, [doc, readOnly]);
  // 未保存守卫：只读态豁免；「返回」与刷新/关页都受保护（此前返回直接跳走，未保存改动静默丢失）
  const isDirty = () => baselineReadyRef.current && !readOnly && !!docRef.current
    && JSON.stringify(docRef.current) !== savedDocSnapshotRef.current;
  const { confirmLeave } = useUnsavedGuard(isDirty);
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
  const [scopeSel, setScopeSel] = useState<Set<string>>(new Set());   // 选中的 record_data_id + project_template_id
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
  const sourceChanges = useMemo(() => collectReportSourceChanges(sourceSnapshot), [sourceSnapshot]);
  const pendingSourceChanges = sourceChanges.filter(change => !doc?.source_reviews?.includes(change.signature));
  const openSourceData = (index?: number, code?: string) => {
    setShowSourceData(true);
    setSourcePdf(false);
    const key = focused?.key || activeGroup.current?.key;
    if (index != null) setSourceTarget({ index, code, token: Date.now() });
    else if (key?.startsWith('proj')) setSourceTarget(current => current?.index === Number(key.slice(4)) ? current : { index: Number(key.slice(4)), token: Date.now() });
  };
  useEffect(() => {
    if (showSourceData && focused?.key.startsWith('proj')) setSourceTarget({ index: Number(focused.key.slice(4)), token: Date.now() });
  }, [focused?.key]);
  const [insertedField, setInsertedField] = useState<{ key: string; id: string } | null>(null);
  const [deletedBlockFocus, setDeletedBlockFocus] = useState<{ key: string; groupId: string; id: string; position: number; token: number; onApplied: () => void } | null>(null);
  useEffect(() => {
    if (!insertedField || !doc || readOnly) return;
    const section = insertedField.key === 'cover' ? doc.cover : doc.projects[Number(insertedField.key.slice(4))];
    const gi = section?.groups.findIndex(group => group.fields.some(field => field.id === insertedField.id)) ?? -1;
    if (gi < 0) { setInsertedField(null); return; }
    const group = section.groups[gi], fi = group.fields.findIndex(field => field.id === insertedField.id), field = group.fields[fi];
    setFocused({ key: insertedField.key, gi, fi, label: field.label });
    const element = [...document.querySelectorAll<HTMLElement>('[data-report-field]')].find(node => node.dataset.reportField === `${insertedField.key}/${field.id}`)
      || document.getElementById(`grp-${insertedField.key}-${gi}`);
    revealInScrollPanes(element);
    // The newly selected visual editor mounts after this effect's state update.
    requestAnimationFrame(() => {
      const mounted = [...document.querySelectorAll<HTMLElement>('[data-report-field]')].find(node => node.dataset.reportField === `${insertedField.key}/${field.id}`)
        || document.getElementById(`grp-${insertedField.key}-${gi}`);
      (mounted?.querySelector<HTMLElement>('[contenteditable="true"], textarea:not(:disabled), input:not(:disabled)') || mounted?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus({ preventScroll: true });
    });
    viewerRef.current?.scrollToMarker(`${insertedField.key}::${field.code}`, `${insertedField.key}::${group.id}`, markerHighlightForField(field));
    setInsertedField(null);
  }, [doc, insertedField, readOnly]);
  // 右侧 PDF 预览句柄：选中左侧字段时把预览滚到对应位置（正向跳转，需 enableSync）。
  const viewerRef = useRef<TypstViewerHandle>(null);
  // 文字格式（加粗/斜体/字号/颜色）作用对象：字段名(label_style) 或 字段值(value_style)
  const [styleTarget, setStyleTarget] = useState<'label' | 'value'>('value');
  const [showEditMarks, setShowEditMarks] = useState(false);
  const insertionTarget = useRef<ReportInsertionTarget | null>(null);
  const [textToolbarHost, setTextToolbarHost] = useState<HTMLDivElement | null>(null);
  const [figureToolbarHost, setFigureToolbarHost] = useState<HTMLDivElement | null>(null);
  const [crossToolbarHost, setCrossToolbarHost] = useState<HTMLDivElement | null>(null);
  const [crossActive, setCrossActive] = useState(false);
  const crossMutations = useRef<Array<(doc: ContentDoc) => void> | null>(null);
  const [activeTextToolbar, setActiveTextToolbar] = useState<string | null>(null);
  const activeGroup = useRef<{ key: string; id: string } | null>(null);
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
    baselineReadyRef.current = false;
    setLoading(true);
    try {
      const res = await axios.get(`${API}/reports/${id}`);
      const reportData = res.data;
      const cd = normalizeContentDoc(reportData.content_doc, !readOnly);
      if (!cd) { message.error('该报告没有可编辑的实例文档（可能是旧版报告）'); return; }
      savedDocSnapshotRef.current = JSON.stringify(cd);
      baselineReadyRef.current = true;
      replaceDocBaseline(cd);
      setOriginal(normalizeContentDoc(reportData.content_doc_original, !readOnly) || cd);
      setSourceSnapshot(normalizeContentDoc(reportData.content_doc_original, false));
      setMeta({ report_no: reportData.report_no, order_no: reportData.order_no, version: reportData.version, edited: reportData.edited, coverOnly: !!reportData.is_cover_draft, warnings: reportData.warnings || [] });
      setDirty(false);
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  }, [id, readOnly]);
  useEffect(() => { loadReport(); }, [loadReport]);

  // 与生成时的原始快照对比，找出"偏离原始数据"的字段
  const originalValues = original ? flattenContentDocValues(original) : {};
  const divergence = original && doc ? diffContentDocValues(original, doc) : [];
  const divergedPaths = new Set(divergence.map(d => d.path));

  /** 任意修改后：标脏 + 触发预览 */
  const mutate = (fn: (d: ContentDoc) => void) => {
    if (readOnly) return;   // 只读查看：任何改动都不生效（防御；UI 也已隐藏编辑入口 + 禁交互）
    if (crossMutations.current) { crossMutations.current.push(fn); return; }
    setDoc(prev => {
      if (!prev) return prev;
      const next: ContentDoc = JSON.parse(JSON.stringify(prev));
      fn(next);
      docRef.current = next;   // 渲染前先同步 ref，保证同一事件里紧跟的保存拿到新值
      return next;
    });
    setDirty(true);
  };
  const batchCrossFormat = (commit: () => void) => {
    if (readOnly || saving || !docRef.current) throw new Error('报告当前不能编辑');
    const original = docRef.current;
    crossMutations.current = [];
    let next: ContentDoc;
    try {
      commit();
      next = structuredClone(original);
      for (const change of crossMutations.current) change(next);
    } finally { crossMutations.current = null; }
    if (JSON.stringify(original) === JSON.stringify(next)) return false;
    // All transformations ran on a private snapshot before the single state update.
    docHistory.setValueTransaction(next);
    docRef.current = next;
    setDirty(true);
    return true;
  };

  // ── 调整样品/测试项目范围 ──
  const openScope = async () => {
    setScopeOpen(true); setScopeLoading(true); setScopeSearch(''); setScopeCollapsed(new Set());
    try {
      const res = await axios.get(`${API}/reports/${id}/scope-candidates`);
      const cands: any[] = res.data?.candidates || [];
      setScopeCands(cands);
      setScopeSel(new Set(cands.filter(c => c.included)
        .map(c => `${Number(c.record_data_id)}:${Number(c.project_template_id)}`)));
    } catch { message.error('加载候选样品/项目失败'); setScopeCands([]); }
    finally { setScopeLoading(false); }
  };
  const [refreshingTemplates, setRefreshingTemplates] = useState(false);
  const refreshProjectTemplates = () => {
    Modal.confirm({
      title: '刷新项目模板',
      content: '将按当前选中的项目重新拉取最新生效模板和原始记录。首页内容会保留，项目页中的人工文字和排版修改会重置。',
      okText: '刷新', cancelText: '取消',
      onOk: async () => {
        setRefreshingTemplates(true);
        try {
          if (isDirty() && !(await handleSave({ silent: true }))) throw new Error('当前修改未保存，请保存后重试');
          const { data } = await axios.get(`${API}/reports/${id}/scope-candidates`);
          if (data.template_refresh_allowed === false) throw new Error(data.template_refresh_blocked_reason || '当前报告不能刷新模板');
          const assignments = (data.candidates || []).filter((c: any) => c.included).map((c: any) => ({
            record_data_id: c.record_data_id, project_template_id: c.project_template_id, enabled: true,
          }));
          if (!assignments.length) throw new Error('当前报告没有选中的项目');
          await axios.post(`${API}/reports/${id}/rescope`, { assignments, refresh_from_template: true });
          await loadReport();
          message.success('项目模板和原始记录已刷新');
        } catch (error: any) {
          message.error(error.response?.data?.error || error.message || '刷新失败');
          throw error;
        } finally { setRefreshingTemplates(false); }
      },
    });
  };
  const scopePairKey = (c: any) => `${Number(c.record_data_id)}:${Number(c.project_template_id)}`;
  const toggleScope = (candidate: any) => setScopeSel(prev => {
    const key = scopePairKey(candidate);
    const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n;
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
          String(c.project_name ?? '').toLowerCase().includes(q) || String(c.test_item_name ?? '').toLowerCase().includes(q) || String(c.method_name ?? '').toLowerCase().includes(q));
        return { ...g, items };
      }).filter(g => g.items.length);
    }
    return groups;
  }, [scopeCands, scopeSearch]);
  // 样品级勾选：选/清该样品下全部测试项目。
  const setSampleGroup = (items: any[], on: boolean) => setScopeSel(prev => {
    const n = new Set(prev);
    for (const c of items) { const key = scopePairKey(c); if (on) n.add(key); else n.delete(key); }
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
      const included = (res.data?.candidates || []).filter((c: any) => c.included);
      setReturnRecs(Array.from(
        new Map(included.map((c: any) => [Number(c.record_data_id), c])).values(),
      ));
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
        enabled: scopeSel.has(scopePairKey(c)),
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
  const deleteFigureBlank = (key: string, groupId: string, fieldId: string, side: -1 | 1): boolean => {
    if (readOnly) return false;
    const current = key === 'cover' ? docRef.current?.cover : docRef.current?.projects[Number(key.slice(4))];
    if (!current || !deleteBlankBesideFigure(structuredClone(current.groups), groupId, fieldId, side, f => resolveReportFieldValue(f, current.ctx))) return false;
    mutate(d => {
      const section = key === 'cover' ? d.cover : d.projects[Number(key.slice(4))];
      if (section) deleteBlankBesideFigure(section.groups, groupId, fieldId, side, f => resolveReportFieldValue(f, section.ctx));
    });
    requestAnimationFrame(() => {
      const node = Array.from(document.querySelectorAll<HTMLElement>('[data-report-field]')).find(el => el.dataset.reportField === `${key}/${fieldId}`);
      node?.focus({ preventScroll: true });
      node?.dispatchEvent(new CustomEvent('report-figure-caret', { detail: side }));
      const section = key === 'cover' ? docRef.current?.cover : docRef.current?.projects[Number(key.slice(4))];
      const gi = section?.groups.findIndex(group => group.id === groupId) ?? -1;
      const fi = gi >= 0 ? section!.groups[gi].fields.findIndex(field => field.id === fieldId) : -1;
      if (fi >= 0) setFocused({ key, gi, fi, label: section!.groups[gi].fields[fi].label });
    });
    return true;
  };
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
  const focusedBlockStyle = () => {
    if (!focused || !doc) return undefined;
    const group = groupAt(doc, focused.key, focused.gi);
    return group.section_role === 'images' ? group.style : focusedField()?.style;
  };
  const setFocusedBlockStyle = (patch: StyleOverride) => {
    if (!focused) return;
    mutate(d => {
      const group = groupAt(d, focused.key, focused.gi);
      const target = group.section_role === 'images' ? group : group.fields[focused.fi];
      if (target) target.style = { ...target.style, ...patch };
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
  // 「添加内容」：在选中字段下方插入一个内容字段（未选中则追加到当前段末尾兜底）。替代各分区末尾的「在末尾插入内容」。
  const insertContent = (key: string, gi: number, index: number, kind: InsertKind, options?: ReportInsertOptions) => {
    if (readOnly) return;
    const field = makeContentField(kind, options);
    const siblingId = newId('content_group');
    mutate(d => {
      const group = groupAt(d, key, gi);
      if (group.section_role === 'images') {
        const section = key === 'cover' ? d.cover : d.projects[Number(key.slice(4))];
        section.groups.splice(gi + Math.max(1, group.module_span || 1), 0, { id: siblingId, label: '', hide_title: true, layout: 'vertical', parent_group_id: group.parent_group_id, fields: [field] });
        return;
      }
      const arr = group.fields;
      arr.splice(Math.max(0, Math.min(index, arr.length)), 0, field);
    });
    setInsertedField({ key, id: field.id });
  };
  const insertContentAtFocused = (kind: InsertKind, options?: ReportInsertOptions) => {
    if (!focused) { message.info('先选中一个字段，新内容会插在它下方'); return; }
    insertContent(focused.key, focused.gi, focused.fi + 1, kind, options);
  };
  const insertDocumentContent = (kind: ReportInsertAction, options?: ReportInsertOptions) => {
    if (readOnly || !doc) return;
    if (insertionTarget.current) {
      if (!insertionTarget.current.insert(kind, options)) message.info('请先在正文中定位光标，或选中要插入内容的图表');
      return;
    }
    if (focused) {
      const group = groupAt(doc, focused.key, focused.gi);
      if (isSignatureGroup(group)) { message.info('签发分区不可插入内容，请选择其他分区'); return; }
      insertContentAtFocused(kind, options); return;
    }
    const location = activeGroup.current;
    if (!location) { message.info('请先点击要编辑的正文、图表或空分区'); return; }
    const section = location.key === 'cover' ? doc.cover : doc.projects[Number(location.key.slice(4))];
    const gi = section?.groups.findIndex(g => g.id === location.id) ?? -1;
    if (gi < 0) return;
    const group = section.groups[gi];
    if (isSignatureGroup(group) || group.report_document || (!meta?.coverOnly && canEditContinuousText(group))) {
      message.info('请先在正文中定位光标'); return;
    }
    insertContent(location.key, gi, group.fields.length, kind, options);
  };
  const requestDocumentInsert = (kind: ReportInsertAction) => {
    if (!insertionTarget.current && !focused && !activeGroup.current) { message.info('请先在正文中定位光标，或选中图表'); return; }
    if (kind === 'paragraph') { insertDocumentContent(kind); return; }
    const options: ReportInsertOptions = { rows: 3, columns: 3, imageCount: 1 };
    Modal.confirm({ title: kind === 'table' ? '插入表格' : '插入图片', icon: null, okText: '插入', cancelText: '取消',
      content: <Space direction="vertical" style={{ padding: '12px 0' }}>
        {kind === 'table' ? <>
          <Space>行数<InputNumber aria-label="插入表格行数" min={1} max={100} precision={0} defaultValue={3} onChange={v => { options.rows = v ?? 3; }} /></Space>
          <Space>列数<InputNumber aria-label="插入表格列数" min={1} max={50} precision={0} defaultValue={3} onChange={v => { options.columns = v ?? 3; }} /></Space>
        </> : <Space>图片数量<InputNumber aria-label="插入图片数量" min={1} max={50} precision={0} defaultValue={1} onChange={v => { options.imageCount = v ?? 1; }} /></Space>}
      </Space>, onOk: () => insertDocumentContent(kind, options),
    });
  };
  // 「强制分页」：切换选中字段的 page_break_before——本字段从新的一页开始。
  const toggleFocusedPageBreak = () => {
    if (!focused) return;
    mutate(d => { const f = groupAt(d, focused.key, focused.gi).fields[focused.fi]; f.page_break_before = f.page_break_before ? undefined : true; });
  };
  // 顶部公共栏：对当前选中字段做 上移/下移/删除/有名无名/整字段格式（替代每行的小按钮，列表更干净）
  const deleteFocused = () => {
    if (!focused || !doc || readOnly) return;
    const selected = focused;
    const group = groupAt(doc, selected.key, selected.gi), field = group.fields[selected.fi];
    if (!field) return;
    let focusAfterClose: typeof deletedBlockFocus = null;
    const remove = (deferFocus = false) => {
      mutate(d => {
        const section = selected.key === 'cover' ? d.cover : d.projects[Number(selected.key.slice(4))];
        const target = section.groups.find(g => g.id === group.id);
        if (target) {
          const next = removeReportBlockWithFocus(target, field.id, f => resolveReportFieldValue(f, section.ctx));
          focusAfterClose = next ? { ...next, key: selected.key, groupId: group.id, token: Date.now(), onApplied: () => setDeletedBlockFocus(null) } : null;
          if (!deferFocus) setDeletedBlockFocus(focusAfterClose);
        }
      });
      setFocused(null);
    };
    if ((LABELCAP_TYPES.has(field.type) || field.type === 'image') && !field.rich) Modal.confirm({ title: '删除当前图表？',
      content: '图表内容将从本报告移除，前后文字会保留。可通过文档撤销恢复，不影响原始记录。',
      okText: '删除', cancelText: '取消', okButtonProps: { danger: true }, onOk: () => remove(true),
      afterClose: () => { if (focusAfterClose) setDeletedBlockFocus(focusAfterClose); } });
    else remove();
  };
  const navigateReportGroup = (key: string, groupId: string, direction: -1 | 1): boolean => {
    if (readOnly || !docRef.current) return false;
    const section = key === 'cover' ? docRef.current.cover : docRef.current.projects[Number(key.slice(4))];
    const index = section?.groups.findIndex(group => group.id === groupId) ?? -1;
    const gi = index + direction, group = section?.groups[gi];
    if (index < 0 || !group?.fields.length || isSignatureGroup(group)) return false;
    let fi = direction === 1 ? 0 : group.fields.length - 1;
    // Image collections render at their FIRST image field, regardless of how
    // many legacy image slots remain in the source group.
    if (group.section_role === 'images' && group.fields[fi].type === 'image') fi = group.fields.findIndex(field => field.type === 'image');
    const field = group.fields[fi];
    const run = reportTextRuns(group).find(run => run.ids.includes(field.id));
    if (group.report_document || canEditContinuousText(group) || run) {
      const value = run ? reportTextRunValue(run, f => resolveReportFieldValue(f, section.ctx))
        : continuousTextValue(group, f => resolveReportFieldValue(f, section.ctx));
      setFocused(null);
      setDeletedBlockFocus({ key, groupId: group.id, id: run?.ids[0] || field.id, position: direction === 1 ? 1 : reportTextEndPosition(value),
        token: Date.now(), onApplied: () => setDeletedBlockFocus(null) });
    } else {
      setActiveTextToolbar(null); insertionTarget.current = null;
      setFocused({ key, gi, fi, label: field.label });
      requestAnimationFrame(() => {
        const node = [...document.querySelectorAll<HTMLElement>('[data-report-field]')].find(node => node.dataset.reportField === `${key}/${field.id}`);
        node?.focus({ preventScroll: true }); revealInScrollPanes(node);
      });
      viewerRef.current?.scrollToMarker(`${key}::${field.code}`, `${key}::${group.id}`, markerHighlightForField(field));
    }
    return true;
  };
  const continueOutsideImage = (key: string, groupId: string, direction: -1 | 1) => {
    if (readOnly || meta?.coverOnly) return;
    mutate(d => {
      const section = key === 'cover' ? d.cover : d.projects[Number(key.slice(4))];
      const next = continueImageSection(section.groups, groupId, direction, { group: newId('prose_group'), field: newId('paragraph') }, f => resolveReportFieldValue(f, section.ctx));
      if (next) {
        setFocused(null);
        setDeletedBlockFocus({ ...next, key, token: Date.now(), onApplied: () => setDeletedBlockFocus(null) });
      } else message.info('此图片区使用组合布局，请先在相邻正文中定位后插入文字');
    });
  };
  const toggleFocusedHideLabel = () => {
    if (!focused) return;
    mutate(d => {
      const f = groupAt(d, focused.key, focused.gi).fields[focused.fi];
      if (usesIndependentTableTitle(f) || f.rich || f.type === 'spacer') return;
      const visible = LABELCAP_TYPES.has(f.type) || f.type === 'image' ? f.hide_label === false : !f.hide_label;
      f.hide_label = visible;
    });
  };
  const focusedLabelVisible = () => {
    const f = focusedField();
    return !!f && !f.rich && !usesIndependentTableTitle(f) && (LABELCAP_TYPES.has(f.type) || f.type === 'image' ? f.hide_label === false : !f.hide_label);
  };
  // 字段级「字段间距」（仅普通文字字段；覆盖文档样式·字段间距，留空＝跟随文档）
  // 选中字段是否可上移/下移（末尾/首位禁用）

  const handleSave = async (options: { silent?: boolean } = {}): Promise<boolean> => {
    const d = docRef.current;   // 最新状态（防 onBlur 提交与点保存的竞态）
    if (!d || !id || readOnly || saveInFlight.current) return false;
    if (!isDirty()) return true;
    saveInFlight.current = true;
    setSaving(true);
    setSaveFailed(false);
    try {
      const result = await axios.put(`${API}/reports/${id}`, { content_doc: d }, { headers: lease.headers });
      // 保存不等于重新进入编辑器：保留进入时基线和全部撤回/重做记录。
      // 仅在本地仍为本次提交版本时接纳服务端补齐的数据，避免覆盖保存期间的新输入。
      const savedDoc = normalizeContentDoc(result.data?.content_doc, !readOnly) || d;
      docHistory.acceptSavedValue(d, savedDoc);
      if (JSON.stringify(docRef.current) === JSON.stringify(d)) docRef.current = savedDoc;
      if (!options.silent) message.success('已保存');
      savedDocSnapshotRef.current = JSON.stringify(savedDoc);
      baselineReadyRef.current = true;
      setDirty(JSON.stringify(docRef.current) !== savedDocSnapshotRef.current);
      setMeta(m => m ? { ...m, edited: true, version: (m.version || 1) + 1 } : m);
      // 输入可能在请求期间继续发生；不能释放编辑权并遗失这些新修改。
      const complete = JSON.stringify(docRef.current) === savedDocSnapshotRef.current;
      if (!complete && !options.silent) message.info('还有新的修改，请再次结束编辑以保存');
      return complete;
    } catch (e: any) {
      setSaveFailed(true);
      if (e.response?.status === 423) message.warning(e.response?.data?.error || '该报告已由其他用户占用编辑，当前为只读');
      else message.error('保存失败：' + (e.response?.data?.error || e.message));
      return false;
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  useAutoSave({
    enabled: baselineReadyRef.current && !loading && !saving && !readOnly && !!id,
    isDirty,
    save: () => handleSave({ silent: true }),
  });
  const imageRevision = JSON.stringify([doc?.cover, ...(doc?.projects || [])].filter(Boolean).map(section => ({
    raw: pickReportImageData(section),
    fields: (section?.groups || []).flatMap((group: any) => (group.fields || []).filter((field: any) => ['image', 'report_photo_table', 'report_image_gallery'].includes(field.type))),
  })));
  // Photos should not wait for the 30-second general autosave interval.
  useEffect(() => {
    if (loading || saving || readOnly || !baselineReadyRef.current || !isDirty()) return;
    const timer = window.setTimeout(() => { void handleSave({ silent: true }); }, 1200);
    return () => window.clearTimeout(timer);
  }, [imageRevision, loading, saving, readOnly]);

  const downloadSavedReport = async () => {
    if (downloadInFlight.current || !id) return;
    downloadInFlight.current = true;
    try {
      (document.activeElement as HTMLElement | null)?.blur?.();
      // Let input blur handlers flush their updates before taking the snapshot.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (!readOnly && !await handleSave({ silent: true })) {
        message.warning('报告尚未保存完成，请等待保存完成后再导出'); return;
      }
      const response = await axios.get(`${API}/reports/${id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${meta?.report_no || meta?.order_no || '报告'}.pdf`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error: any) { message.error('保存或导出失败：' + (error?.message || '请重试')); }
    finally { downloadInFlight.current = false; }
  };

  useEffect(() => {
    const saveShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's' || event.altKey) return;
      event.preventDefault();
      if (readOnly || loading) return;
      // 提交图片标题等在失焦时写入的内容，然后保存；不退出编辑。
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      void handleSave({ silent: true });
    };
    window.addEventListener('keydown', saveShortcut);
    return () => window.removeEventListener('keydown', saveShortcut);
  });

  // 打开「应用到已生成报告」：先保存草稿（服务端按 DB 里的草稿套用），再拉本单已生成报告列表
  const openApply = async () => {
    if (!meta?.order_no) { message.warning('缺少订单号'); return; }
    if (isDirty() && !await handleSave()) return;
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
  const scrollToAnchor = (elId: string) => revealInScrollPanes(document.getElementById(elId), { behavior: 'smooth', block: 'start' });
  const restoreHistory = (action: 'undo' | 'redo' | 'reset') => {
    if (readOnly || saving || !doc) return;
    // Indexed focus targets may refer to a different field after restoring a move/delete.
    setFocused(null); setInsertedField(null); setDeletedBlockFocus(null);
    insertionTarget.current = null;
    docHistory[action]();
  };
  const outlineGoGroup = (secKey: string, gi: number, g: any) => {
    scrollToAnchor(`grp-${secKey}-${gi}`);
    if (g?.id) viewerRef.current?.scrollToMarker(
      `${secKey}::${g.id}`,
      `${secKey}::${g.id}`,
      { label: `当前分区：${g.label || ''}`, mode: 'group' },
    );
  };

  return (
    // height:100% 而非 100vh——本页在 AppNav 下方的 flex:1 容器内，用 100vh 会比容器高、导致整页滚动、顶栏被滚走。
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      onPointerDownCapture={() => docHistory.closeGroup()}
      onFocusCapture={() => docHistory.closeGroup()}
      onKeyDownCapture={event => {
        if (readOnly || saving || !doc) return;
        const action = reportHistoryShortcut(event.nativeEvent);
        if (!action) return;
        // Consume even an empty history so a child editor cannot undo stale local state.
        event.preventDefault(); event.stopPropagation();
        if (action === 'undo' ? docHistory.canUndo : docHistory.canRedo) restoreHistory(action);
      }}>
      {/* 顶部工具条：sticky 固定，下滑不消失 */}
      <div data-report-history-toolbar style={{ position: 'sticky', top: 0, zIndex: 30, padding: '8px 16px', borderBottom: '1px solid #d9d9d9', background: '#fff', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={goBack}>返回</Button>
        <Tooltip title={outlineOpen ? '收起大纲' : '展开大纲'}>
          <Button icon={<UnorderedListOutlined />} type={outlineOpen ? 'primary' : 'default'} ghost={outlineOpen} onClick={toggleOutline} />
        </Tooltip>
        <h3 style={{ margin: 0 }}>{readOnly ? '报告查看' : '报告编辑'}</h3>
        {meta && <Tag color="blue" style={{ fontFamily: 'monospace' }}>{meta.report_no || meta.order_no}</Tag>}
        {permissionReadOnly && <Tag icon={<EyeOutlined />} color="default">只读查看</Tag>}
        {!readOnly && meta?.edited && <Tag color="orange">已编辑</Tag>}
        {!readOnly && divergence.length > 0 && (
          <Tag icon={<WarningOutlined />} color="red">偏离原始 {divergence.length} 处</Tag>
        )}
        {!readOnly && <span role="status" style={{ fontSize: 12, color: saveFailed ? '#cf1322' : '#667085' }}>
          {saving ? '保存中…' : saveFailed ? '保存失败' : dirty ? '待自动保存' : '已保存'}
          {saveFailed && !saving && <Button type="link" size="small" onClick={() => handleSave({ silent: true })}>重试</Button>}
        </span>}
        {!readOnly && (
          <EditorHistoryControls
            shortcutHints
            canUndo={docHistory.canUndo} canRedo={docHistory.canRedo} canReset={docHistory.canReset}
            onUndo={() => restoreHistory('undo')} onRedo={() => restoreHistory('redo')} onReset={() => restoreHistory('reset')}
            disabled={saving}
          />
        )}
        <div style={{ flex: 1 }} />
        <DocumentCollaborationStatus resourceType="report_instance" resourceId={id}
          canEdit={!permissionReadOnly} lease={lease} saving={saving} onSaveBeforeRelease={() => handleSave()}
          changes={dirty ? ['报告内容（未保存）'] : []} />
        {!readOnly && meta?.coverOnly && (
          <Tooltip title="把本首页（结构/图片/样式）应用到本订单已取号的报告里——已生成的可勾选覆盖，尚未生成的取号报告会在生成时自动套用当前首页">
            <Button icon={<SettingOutlined />} onClick={openApply}>应用到已取号报告</Button>
          </Tooltip>
        )}
        {!readOnly && !meta?.coverOnly && meta?.order_no && (
          <Tooltip title="重新选择本报告包含的样品 / 测试项目；确认后按新范围重算（首页检测结论表随之变化）">
            <Space>
              <Button loading={refreshingTemplates} disabled={saving} onClick={refreshProjectTemplates}>刷新项目模板</Button>
              <Button icon={<SettingOutlined />} onClick={openScope}>调整样品/项目</Button>
            </Space>
          </Tooltip>
        )}
        {!readOnly && !meta?.coverOnly && meta?.order_no && (
          <Tooltip title="发现某条原始记录数据有误？退回给主检（实验室工程师），主检在「实验室录入」修改并重走审核；通过后本报告按新数据重新生成">
            <Button danger icon={<RollbackOutlined />} onClick={openReturn}>退回原始记录</Button>
          </Tooltip>
        )}
        {readOnly && (
          <Tooltip title="下载本报告 PDF">
            <Button icon={<DownloadOutlined />} onClick={() => id && window.open(`${API}/reports/${id}/pdf`, '_blank')}>PDF</Button>
          </Tooltip>
        )}
      </div>

      {(pendingSourceChanges.length > 0 || ((!sourceSnapshot || sourceSnapshot.projects.some(project => !project.ctx?.linked_record_template || !project.ctx?.record_raw_data)) && !!meta?.warnings?.some(w => w?.type === 'record_free_grid_structure_changed'))) && (
        <Alert banner type="warning" showIcon style={{ flexShrink: 0 }}
          message="原始记录录入时新增了非试样行或列"
          description={<div>新增内容可能未包含在报告中，请查看原始数据并按需复制补充。{pendingSourceChanges.map(change => <Button key={`${change.index}/${change.code}`} size="small" type="link" onClick={() => openSourceData(change.index, change.code)}>{change.label}</Button>)}</div>}
          action={<Button size="small" onClick={() => openSourceData(pendingSourceChanges[0]?.index, pendingSourceChanges[0]?.code)}>查看原始数据</Button>} />
      )}

      <div style={{ flex: 1, display: 'flex', padding: 12, minHeight: 0 }}>
        <EditorSplit
          left={
        /* 左：可收起大纲 + 结构化编辑表单 */
        <EditAttemptGuard active={!!id && !permissionReadOnly && !lease.loading && !lease.acquired && !lease.holderName}
          style={{ display: 'flex', height: '100%', gap: 8 }}>
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
        <ReportToolbarContext.Provider value={{ host: textToolbarHost, activeId: activeTextToolbar, activate: setActiveTextToolbar }}>
        <ReportFigureToolsContext.Provider value={figureToolbarHost}>
        <ReportCrossSelection host={crossToolbarHost} enabled={!readOnly && !saving} revision={doc} batch={batchCrossFormat} onActive={setCrossActive}>
        <ReportInsertionContext.Provider value={target => { insertionTarget.current = target; }}>
        <Card className="report-document-editor" size="small" style={{ height: '100%', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
          styles={{ body: { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 12, background: '#edf0f4' } }}>
          {!readOnly && <div ref={setCrossToolbarHost} className={`report-document-toolbar ${crossActive ? 'report-cross-active' : ''}`}>
            {!activeTextToolbar && !focused && <div className="report-idle-text-tools" aria-label="文字工具（选择文字后可用）">
              <Button size="small" disabled icon={<BoldOutlined />} /><Button size="small" disabled icon={<ItalicOutlined />} />
              <Button size="small" disabled>字号 ▾</Button><Button size="small" disabled>颜色 ▾</Button>
              <Button size="small" disabled icon={<AlignLeftOutlined />} /><Button size="small" disabled icon={<AlignCenterOutlined />} /><Button size="small" disabled icon={<AlignRightOutlined />} />
              <AntSelect size="small" disabled style={{ width: 112 }} aria-label="未选中文字字体" options={[]} />
              <Button size="small" disabled>段前 ▾</Button><Button size="small" disabled>段后 ▾</Button><Button size="small" disabled>行距 ▾</Button>
            </div>}
            <div ref={setTextToolbarHost} className="report-shared-text-tools" />
          {/* 字段工具栏：选中某字段后，对其字段名/字段值文字与块级版式操作。只读查看时隐藏。 */}
          {focused && !focusedField()?.rich && <div className="report-selected-block-tools">
            <div ref={setFigureToolbarHost} className="report-figure-toolbar-host" />
            {(LABELCAP_TYPES.has(focusedField()?.type || '') || focusedField()?.type === 'image') && (['space_before', 'space_after'] as const).map((property, i) => <ClosablePopover key={property} trigger="click" title={`整图表段${i ? '后' : '前'}间距`} content={
              <InputNumber aria-label={`整图表段${i ? '后' : '前'}间距`} style={{ width: 144, maxWidth: 'calc(100vw - 64px)' }} min={0} max={200} suffix="pt" value={reportLengthPt(focusedBlockStyle()?.[property], 'pt')}
                onChange={value => { if (value != null) setFocusedBlockStyle({ [property]: `${value}pt` }); }} />
            }><Button size="small">段{i ? '后' : '前'} ▾</Button></ClosablePopover>)}
            {['image', 'report_photo_table', 'report_image_gallery'].includes(focusedField()?.type || '') && <ClosablePopover trigger="click" title="图片文字行距（额外间距 em）" content={
              <InputNumber aria-label="图片文字行距" style={{ width: 144, maxWidth: 'calc(100vw - 64px)' }} min={0} max={10} step={0.1} suffix="em" value={reportLengthPt(focusedBlockStyle()?.line_height, 'em', 1)}
                onChange={value => { if (value != null) setFocusedBlockStyle({ line_height: `${value}em` }); }} />
            }><Button size="small">行距 ▾</Button></ClosablePopover>}
            {!FIELD_GAP_EXCLUDED.has(focusedField()?.type || '') && focusedField()?.type !== 'free_grid' && <>
            <Tooltip title="设置标签或内容的文字格式">
              <Segmented size="small" disabled={!focused} value={styleTarget} onChange={(v) => setStyleTarget(v as 'label' | 'value')}
                options={[{ label: '标签', value: 'label' }, { label: '内容', value: 'value' }]} />
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
            <Tooltip title="显示或隐藏字段名；表格请在图表标题中填写或清空标题">
              <Button size="small" disabled={!focused || !!focusedField()?.rich || focusedField()?.type === 'spacer' || (!!focusedField() && usesIndependentTableTitle(focusedField()!))} type={focusedLabelVisible() ? 'primary' : 'default'} ghost={focusedLabelVisible()}
                onClick={toggleFocusedHideLabel}>显示标签</Button></Tooltip>
            </>}
            <Divider type="vertical" style={{ margin: '0 3px' }} />
            <Tooltip title={focusedField() && LABELCAP_TYPES.has(focusedField()!.type) && !['report_photo_table', 'report_image_gallery'].includes(focusedField()!.type) ? '删除表格' : '删除当前内容'}><Button size="small" danger disabled={!focused} icon={<DeleteOutlined />} onClick={deleteFocused} /></Tooltip>
            <Tooltip title="强制分页：本字段从新的一页开始（在它前面插入分页）">
              <Button size="small" disabled={!focused} icon={<VerticalAlignBottomOutlined />}
                type={focusedField()?.page_break_before ? 'primary' : 'default'}
                onClick={toggleFocusedPageBreak}>分页</Button></Tooltip>
          </div>}
            <Dropdown trigger={['click']} menu={{ items: [{ key: 'table', label: '表格' }, { key: 'image', label: '图片' }],
              onClick: ({ key }) => requestDocumentInsert(key as ReportInsertAction) }}>
              <Button size="small" type="primary" ghost onMouseDown={event => event.preventDefault()}>插入 ▾</Button>
            </Dropdown>
            <Tooltip title="仅显示编辑辅助标记，不影响保存内容和 PDF">
              <Checkbox checked={showEditMarks} onChange={event => setShowEditMarks(event.target.checked)}>显示编辑标记</Checkbox>
            </Tooltip>
          </div>}
          {/* 只读查看：整块提示 + 结构区禁交互（pointerEvents:none），仅浏览结构，用大纲/右侧 PDF 查看。 */}
          {readOnly && (
            <Alert type="info" showIcon style={{ marginBottom: 8 }}
              message="只读查看：本报告已送审 / 为历史版本，仅可查看，不能修改。右侧为渲染 PDF，可下载。" />
          )}
          {/* 点空白区域取消选中（仅当点到本容器自身、不是某字段时） */}
          <div className="report-document-scroll">
          <ReportPaperViewport contentWidthPt={reportBodyLayout(doc.cover.layout_options?.theme_config).widthPt}>
          <div className={`report-document-paper ${showEditMarks && !readOnly ? 'report-show-edit-marks' : ''}`} onClick={(e) => { if (!readOnly && e.target === e.currentTarget && !retainsReportTextSelection(e.target)) { setFocused(null); insertionTarget.current = null; setActiveTextToolbar(null); } }}
            onCopyCapture={event => {
              const node = event.target as HTMLElement;
              // Whole block only: native text selections and cell TSV keep their existing behavior.
              if (readOnly || !focused || !node.matches('.fe-row[data-report-field]')) return;
              const section = focused.key === 'cover' ? doc.cover : doc.projects[Number(focused.key.slice(4))];
              const group = section.groups[focused.gi], original = group.fields[focused.fi];
              if (!original || !(LABELCAP_TYPES.has(original.type) || original.type === 'image')) return;
              const field = snapshotReportFigure(original, group, section.ctx);
              if (!field) { event.preventDefault(); message.info('此旧版图表暂不支持整块复制'); return; }
              const token = newId('clipboard'); reportFigureClipboard.clear(); reportFigureClipboard.set(token, field);
              event.clipboardData.setData(REPORT_FIGURE_MIME, token);
              event.clipboardData.setData('text/plain', original.table_title || original.label || '图表');
              event.preventDefault(); event.stopPropagation();
            }}
            onPasteCapture={event => {
              if (readOnly || isReportToolbarOverlay(event.target)) return;
              const photoCopy = readReportPhoto(event.clipboardData);
              if (photoCopy) {
                event.preventDefault(); event.stopPropagation();
                const slot = (event.target as HTMLElement).closest<HTMLElement>('[data-report-photo-index]');
                const block = slot?.closest<HTMLElement>('[data-report-field]')?.dataset.reportField;
                if (slot && block) {
                  const slash = block.indexOf('/'), key = block.slice(0, slash), fieldId = block.slice(slash + 1), index = Number(slot.dataset.reportPhotoIndex);
                  mutate(d => {
                    const section = key === 'cover' ? d.cover : d.projects[Number(key.slice(4))];
                    const group = section?.groups.find(g => g.fields.some(f => f.id === fieldId));
                    const field = group?.fields.find(f => f.id === fieldId);
                    if (!field || !group || isSignatureGroup(group) || !Number.isInteger(index) || index < 0) return;
                    if (group.section_role === 'images') {
                      const raw = section.ctx.record_raw_data ||= {};
                      const collection = structuredClone(findImageCollection(raw, group) || imageCollectionFromLegacy(group, raw));
                      if (!collection.items[index]) collection.items[index] = { id: newId('photo'), title: '' };
                      collection.items[index] = { ...collection.items[index], photo: photoCopy.photo, title: photoCopy.title };
                      raw[imageCollectionKey(group.id)] = { ...collection, source_group_id: group.id };
                    } else if (field.type === 'report_image_gallery') {
                      message.info('此旧版自动图库请打开“管理图片”，选中图片框后粘贴');
                    } else if (field.type === 'image' || field.type === 'report_photo_table') {
                      const cfg = field.type === 'image' ? null : (field.photo_table ||= {});
                      const per = field.type === 'image' ? field.image_title_mode === 'per' : cfg?.title_mode === 'per';
                      if (per) {
                        const items = field.type === 'image' ? (field.image_items ||= []) : (cfg!.items ||= []);
                        items[index] = { ...items[index], id: items[index]?.id || newId('photo'), label: photoCopy.title, photos: [photoCopy.photo] };
                      } else {
                        const photos = field.type === 'image' ? (field.image_photos ||= []) : (cfg!.photos ||= []);
                        photos[index] = photoCopy.photo;
                      }
                    }
                  });
                  return;
                }
                if (!(event.target as HTMLElement).closest('.report-visual-paragraph')) { message.info('请先选中图片框，或把光标放到正文中'); return; }
                const token = newId('photo_clipboard');
                reportFigureClipboard.set(token, { id: token, code: token, type: 'image', label: photoCopy.title || '图片', image_title_mode: 'per', image_cols: 1, image_items: [{ id: newId('photo'), label: photoCopy.title, photos: [photoCopy.photo] }] });
                insertDocumentContent('image', { copyToken: token });
                return;
              }
              const token = event.clipboardData.getData(REPORT_FIGURE_MIME), field = reportFigureClipboard.get(token);
              if (!field) {
                if (!(event.target as HTMLElement).closest('.report-visual-paragraph')) return;
                try {
                  const tableData = reportTableClipboard(event.clipboardData.getData('text/html'), event.clipboardData.getData('text/plain'));
                  if (!tableData) return;
                  event.preventDefault(); event.stopPropagation();
                  insertDocumentContent('table', { tableData });
                } catch (error) { event.preventDefault(); event.stopPropagation(); message.warning((error as Error).message); }
                return;
              }
              event.preventDefault(); event.stopPropagation();
              insertDocumentContent(field.type === 'image' || field.type === 'report_photo_table' || field.type === 'report_image_gallery' ? 'image' : 'table', { copyToken: token });
            }}
            style={{ minHeight: '100%', pointerEvents: readOnly ? 'none' : undefined,
              fontSize: `${reportBodyLayout(doc.cover.layout_options?.theme_config).size}pt`,
              '--report-field-gap': sectionThemeValues(doc.cover).fieldGap,
              '--report-section-gap': sectionThemeValues(doc.cover).sectionGap,
              '--report-paragraph-gap': reportBodyLayout(doc.cover.layout_options?.theme_config).paragraphGap } as CSSProperties}>
          {sections.map(({ key, section }) => (
            <div key={key} id={`sec-${key}`} className="report-document-section" data-report-page-break={key !== 'cover' && section.page_break !== false || undefined} style={{ marginBottom: 22, paddingTop: key === 'cover' ? 0 : 4,
              width: `${reportBodyLayout(doc.cover.layout_options?.theme_config).widthPt}pt`, marginInline: 'auto',
              fontFamily: reportBodyLayout(doc.cover.layout_options?.theme_config).font,
              '--report-field-gap': sectionThemeValues(section).fieldGap,
              '--report-section-gap': sectionThemeValues(section).sectionGap } as CSSProperties}>
              <div className="report-section-divider" contentEditable={false} aria-label={key === 'cover' ? '首页分隔栏' : `${section.title || section.name}分隔栏`}>
                {key === 'cover' ? '首页' : (section.title || section.name)}
                {key !== 'cover' && !readOnly && <AntSelect size="small" aria-label={`${section.title || section.name}分页方式`}
                  style={{ width: 150, marginLeft: 12 }} value={section.page_break === false ? 'flow' : 'page'}
                  options={[{ value: 'page', label: '项目另起一页' }, { value: 'flow', label: '接续上一项目' }]}
                  onClick={event => event.stopPropagation()}
                  onChange={value => mutate(d => { d.projects[Number(key.slice(4))].page_break = value !== 'flow'; })} />}
              </div>
              {key !== 'cover' && reportProjectHeadingValue(section) !== null && <div
                className={`report-project-heading ${/Fandol|FangSong|SimHei|KaiTi/i.test(sectionThemeValues(doc.cover).font) ? 'report-heading-synthetic-bold' : ''}`}
                style={{ fontWeight: 400, fontSize: `${reportBodyLayout(doc.cover.layout_options?.theme_config).size * 1.05}pt`,
                  marginBottom: `${reportBodyLayout(doc.cover.layout_options?.theme_config).size * 0.6}pt` }}
                onFocusCapture={event => {
                  if (isReportToolbarOverlay(event.target)) return;
                  setFocused(null); activeGroup.current = null;
                  viewerRef.current?.scrollToMarker(`${key}::__project_heading__`);
                }}>
                {readOnly ? <ReportRichText value={reportProjectHeadingValue(section)!} />
                  : <ReportParagraphEditor value={reportProjectHeadingValue(section)!}
                    onChange={value => mutate(d => { d.projects[Number(key.slice(4))].report_heading = value; })} />}
              </div>}
              {section.groups.map((g, gi) => (
                <div key={g.id || gi} id={`grp-${key}-${gi}`} data-report-page-break={g.page_break_before || undefined} tabIndex={g.fields.length ? undefined : 0}
                  className={`report-group-flow ${!g.hide_title && g.label ? 'report-group-has-heading' : ''}`}
                  style={{ '--report-group-gap': g.style?.block_spacing || sectionThemeValues(section).fieldGap } as CSSProperties}
                  onDragOver={event => {
                    if (!readOnly && draggedReportFigure?.startsWith(`${key}/`) && event.dataTransfer.types.includes('application/x-report-field')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }
                  }}
                  onDropCapture={event => {
                    if (readOnly || !draggedReportFigure?.startsWith(`${key}/`) || !event.dataTransfer.types.includes('application/x-report-field')) return;
                    event.preventDefault(); event.stopPropagation();
                    const sourceId = draggedReportFigure.slice(key.length + 1);
                    const targetNode = (event.target as HTMLElement).closest<HTMLElement>('[data-report-field]');
                    const targetId = targetNode?.dataset.reportField?.slice(key.length + 1);
                    const bounds = (targetNode || event.currentTarget).getBoundingClientRect();
                    const after = event.clientY > bounds.top + bounds.height / 2;
                    const id = newId('moved_figure');
                    if (!moveReportFigure(structuredClone(section.groups), sourceId, g.id, targetId, after, id)) { message.info('不能移动到此位置，请选择同一项目内的普通正文或图表位置'); return; }
                    mutate(d => { const current = key === 'cover' ? d.cover : d.projects[Number(key.slice(4))]; moveReportFigure(current.groups, sourceId, g.id, targetId, after, id); });
                    setFocused(null); insertionTarget.current = null; setInsertedField({ key, id: sourceId });
                    draggedReportFigure = null;
                  }}
                  onFocusCapture={event => {
                    if (isReportToolbarOverlay(event.target) || retainsReportTextSelection(event.target)) return;
                    if (showSourceData && key.startsWith('proj') && activeGroup.current?.key !== key) setSourceTarget({ index: Number(key.slice(4)), token: Date.now() });
                    activeGroup.current = { key, id: g.id };
                    if (!(event.target as HTMLElement).closest('[data-report-field]')) setFocused(null);
                    if (!(event.target as HTMLElement).closest('.report-visual-paragraph, .report-paragraph-tools, .ant-dropdown')) { insertionTarget.current = null; setActiveTextToolbar(null); }
                  }}
                  onClick={event => {
                    if (isReportToolbarOverlay(event.target) || retainsReportTextSelection(event.target)) return;
                    activeGroup.current = { key, id: g.id };
                    if (!(event.target as HTMLElement).closest('[data-report-field], .report-visual-paragraph, .report-paragraph-tools, .ant-dropdown')) {
                      setFocused(null); insertionTarget.current = null; setActiveTextToolbar(null);
                    }
                  }}>
                {(g.report_document || (!meta?.coverOnly && canEditContinuousText(g))) ? <ReportContinuousText
                  onBoundary={direction => navigateReportGroup(key, g.id, direction)}
                  onDeleteBoundary={direction => {
                    const anchor = direction === -1 ? g.fields[0] : g.fields.at(-1);
                    if (anchor && deleteFigureBlank(key, g.id, anchor.id, direction)) return true;
                    const adjacent = section.groups[gi + direction];
                    const field = direction === -1 ? adjacent?.fields.at(-1) : adjacent?.fields[0];
                    if (adjacent && field && (LABELCAP_TYPES.has(field.type) || field.type === 'image')
                      && deleteFigureBlank(key, adjacent.id, field.id, direction === -1 ? 1 : -1)) return true;
                    return false;
                  }}
                  focusRequest={deletedBlockFocus?.key === key && deletedBlockFocus.groupId === g.id ? deletedBlockFocus : undefined}
                  onTitleChange={title => mutate(d => { groupAt(d, key, gi).label = title; })}
                  group={g} resolve={field => resolveReportFieldValue(field, section.ctx)} readOnly={readOnly}
                  font={sectionThemeValues(doc.cover).font} size={sectionThemeValues(doc.cover).size}
                  onInsert={(kind, value, split, options) => {
                    if (readOnly) return;
                    const latest = docRef.current;
                    const sec = key === 'cover' ? latest?.cover : latest?.projects[Number(key.slice(4))];
                    const target = sec?.groups.find(candidate => candidate.id === g.id);
                    if (!target || continuousTextValue(target, f => resolveReportFieldValue(f, sec!.ctx)) !== value) {
                      message.info('正文已更新，请重新定位光标后插入'); return;
                    }
                    const field = makeContentField(kind, options);
                    mutate(d => {
                      const sec = key === 'cover' ? d.cover : d.projects[Number(key.slice(4))];
                      const index = sec.groups.findIndex(candidate => candidate.id === g.id);
                      if (index >= 0) sec.groups[index] = insertContinuousFigure(sec.groups[index], field, split, [newId('paragraph'), newId('paragraph')]);
                    });
                    setInsertedField({ key, id: field.id });
                  }}
                  onFocus={() => { setFocused(null); viewerRef.current?.scrollToMarker(`${key}::${g.report_document ? g.id + '__body' : g.fields[0]?.code || g.id}`, `${key}::${g.id}`, { mode: 'text', label: g.label || '当前正文' }); }}
                  onChange={value => mutate(d => {
                    const section = key === 'cover' ? d.cover : d.projects[Number(key.slice(4))];
                    const group = section.groups.find(candidate => candidate.id === g.id);
                    if (group) group.report_document = { version: 1, value };
                  })}
                /> : <GroupEditor
                  group={g}
                  onGroupBoundary={direction => navigateReportGroup(key, g.id, direction)}
                  onContinueOutsideImage={!meta?.coverOnly ? direction => continueOutsideImage(key, g.id, direction) : undefined}
                  onDeleteFigureBlank={(id, side) => deleteFigureBlank(key, g.id, id, side)}
                  onDeleteGroupBoundary={side => {
                    const neighbor = section.groups[gi + side];
                    const field = side === -1 ? neighbor?.fields.at(-1) : neighbor?.fields[0];
                    return !!field && (LABELCAP_TYPES.has(field.type) || field.type === 'image') && deleteFigureBlank(key, neighbor.id, field.id, side === -1 ? 1 : -1);
                  }}
                  externalTextFocus={deletedBlockFocus?.key === key && deletedBlockFocus.groupId === g.id ? deletedBlockFocus : undefined}
                  documentText={!meta?.coverOnly}
                  readOnly={readOnly}
                  documentFont={sectionThemeValues(doc.cover).font}
                  documentSize={sectionThemeValues(doc.cover).size}
                  documentFigureGapPt={sectionThemeValues(doc.cover).figureGapPt}
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
                  onInsertInParagraph={(fieldId, kind, value, offset, split, options) => {
                    if (readOnly) return;
                    const currentDoc = docRef.current;
                    if (!currentDoc) return;
                    const section = key === 'cover' ? currentDoc.cover : currentDoc.projects[Number(key.slice(4))];
                    const group = section.groups.find(candidate => candidate.id === g.id);
                    const current = group?.fields.find(field => field.id === fieldId);
                    if (!current?.rich || isSignatureGroup(group!)) return;
                    if (encodeReportRichDocument(readReportRichDocument(resolveReportFieldValue(current, section.ctx))) !== encodeReportRichDocument(readReportRichDocument(value))) {
                      message.info('正文已更新，请重新定位光标后插入'); return;
                    }
                    const inserted = makeContentField(kind, options), continuationCode = newId('paragraph');
                    mutate(d => {
                      const sec = key === 'cover' ? d.cover : d.projects[Number(key.slice(4))];
                      const targetGroup = sec.groups.find(candidate => candidate.id === g.id);
                      const index = targetGroup?.fields.findIndex(field => field.id === fieldId) ?? -1;
                      if (!targetGroup || index < 0) return;
                      targetGroup.fields.splice(index, 1, ...insertIntoReportParagraph(targetGroup.fields[index], value, offset, inserted, continuationCode, split, canContinueReportBlocks(targetGroup)));
                    });
                    setInsertedField({ key, id: inserted.id });
                  }}
                  onRemoveField={(fi) => mutate(d => {
                    const grp = (key === 'cover' ? d.cover : d.projects[Number(key.slice(4))]).groups[gi];
                    if (grp.fields[fi]) removeReportBlock(grp, grp.fields[fi].id);
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
                    if (!g.fields[fi]?.rich) { insertionTarget.current = null; setActiveTextToolbar(null); }
                    setFocused({ key, gi, fi, label: g.fields[fi]?.label || '' });
                    // 选中字段 → 右侧预览滚到该字段。marker code 已按段前缀（renderContentDoc.prefixPosMarkers），
                    // 用 `${sectionKey}::${code}` 精确定位本段，避免首页/各项目段同 code 撞车跳错位置。
                    const code = g.fields[fi]?.code;
                    if (code) viewerRef.current?.scrollToMarker(
                      `${key}::${code}`,
                      `${key}::${g.id}`,
                      markerHighlightForField(g.fields[fi]),
                    );
                  }}
                  onFocusMarker={(markerCode, fi) => {
                    setFocused({ key, gi, fi, label: g.fields[fi]?.label || '' });
                    viewerRef.current?.scrollToMarker(
                      `${key}::${markerCode}`,
                      `${key}::${g.id}`,
                      { label: g.fields[fi]?.label ? `当前：${g.fields[fi].label}` : '当前编辑图片', mode: 'text' },
                    );
                  }}
                  onTextFocus={code => {
                    setFocused(null);
                    viewerRef.current?.scrollToMarker(`${key}::${code}`, `${key}::${g.id}`, { mode: 'text', label: '当前正文' });
                  }}
                  onDeselect={() => {
                    setFocused(null);
                    viewerRef.current?.clearMarkerHighlight();
                  }}
                  selectedFi={focused && focused.key === key && focused.gi === gi ? focused.fi : null}
                  onMutateCtx={(fn) => mutate(d => {
                    const sec = key === 'cover' ? d.cover : d.projects[Number(key.slice(4))];
                    if (!sec.ctx) sec.ctx = {};
                    fn(sec.ctx);
                  })}
                />}
                </div>
              ))}
            </div>
          ))}
          </div>
          </ReportPaperViewport>
          </div>
        </Card>
        </ReportInsertionContext.Provider>
        </ReportCrossSelection>
        </ReportFigureToolsContext.Provider>
        </ReportToolbarContext.Provider>
        </EditAttemptGuard>
          }
          right={
        /* 右：实时预览——与模板编辑器同款 TypstViewer（内置编译/下载 PDF/保滚动位置，改动后不回到顶部）。
           去掉了「实时预览」标题栏（无功能、占高度）；enableSync 开启「左侧字段→右侧预览」定位。 */
        <Card size="small"
          style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
          styles={{ body: { flex: 1, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' } }}>
          <div style={{ padding: 8, background: '#eef3f9', borderBottom: '1px solid #dbe3ef' }}><Segmented block value={!showSourceData ? 'report' : sourcePdf ? 'source-pdf' : 'source'} options={[{ value: 'report', label: '报告 PDF' }, { value: 'source', label: `原始数据${pendingSourceChanges.length ? ` (${pendingSourceChanges.length}待核对)` : ''}` }, { value: 'source-pdf', label: '原始记录 PDF' }]} onChange={value => { if (value === 'report') setShowSourceData(false); else { if (!showSourceData) openSourceData(); else setShowSourceData(true); setSourcePdf(value === 'source-pdf'); } }} /></div>
          <div style={{ display: showSourceData ? 'block' : 'none', flex: 1, minHeight: 0 }}><ReportSourceDataPanel key={id} sources={sourceSnapshot?.projects || []} target={sourceTarget} readOnly={readOnly} pdf={sourcePdf}
            reviews={sourceChanges.map(change => ({ index: change.index, code: change.code, reviewed: !!doc?.source_reviews?.includes(change.signature) }))}
            onReview={(index, code, reviewed) => {
              if (readOnly) return;
              const change = sourceChanges.find(item => item.index === index && item.code === code);
              if (!change) return;
              mutate(d => { d.source_reviews = (d.source_reviews || []).filter(value => value !== change.signature); if (reviewed) d.source_reviews.push(change.signature); });
            }}
            onInsert={tableData => { if (!readOnly) { try { insertDocumentContent('table', { tableData }); } catch (error) { message.warning((error as Error).message); } } }} /></div>
          <div style={{ display: showSourceData ? 'none' : 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          {previewError && <Alert type="error" banner showIcon message="预览失败" description={previewError} />}
          <TypstViewer ref={viewerRef} enableSync source={typstSource} mode="view" height="100%"
            onDownload={downloadSavedReport}
            downloadName={`${meta?.report_no || meta?.order_no || '报告'}.pdf`} />
          </div>
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
          勾选本报告要包含的样品与测试项目（候选覆盖本订单全部已审核通过的原始记录；当前报告已有内容也会保留显示）：勾选<b>样品</b>即选中它的<b>全部测试项目</b>，
          也可只勾其中几项。确认后本报告按新范围更新——<b>首页样品信息 / 检测结论表随之增减</b>，各项目明细页同步。
          <br /><span style={{ color: '#ad6800' }}>注：项目段的人工修改会重置；首页的连续正文及其中后来插入的图表也会恢复为转换前内容。其他首页图表和样式保留。</span>
        </div>
        {scopeLoading ? <Spin style={{ display: 'block', margin: '24px auto' }} />
          : scopeCands.length === 0 ? <Empty description="本订单暂无可纳入的审核通过原始记录" />
          : (
            <>
              <Input.Search allowClear placeholder="搜索样品或测试项目" value={scopeSearch}
                onChange={e => setScopeSearch(e.target.value)} style={{ marginBottom: 8 }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: '#999' }}>已选 {scopeSel.size} / {scopeCands.length} 项</span>
                <Space size={4}>
                  <Button size="small" onClick={() => setScopeSel(new Set(scopeCands.map(scopePairKey)))}>全选</Button>
                  <Button size="small" onClick={() => setScopeSel(new Set())}>全不选</Button>
                </Space>
              </div>
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 8,
                // 对话框内独立滚动，随视口缩小，不会把确认按钮推出屏幕。
                maxHeight: 'min(46vh, 380px)', overflowY: 'auto', overscrollBehavior: 'contain', scrollbarGutter: 'stable',
              }}>
                {scopeGroups.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配的样品 / 项目" />
                  : scopeGroups.map(g => {
                    const selCount = g.items.filter(c => scopeSel.has(scopePairKey(c))).length;
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
                              const checked = scopeSel.has(scopePairKey(c));
                              return (
                                <label key={`${c.record_data_id}_${c.project_template_id}`}
                                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 6px 34px', cursor: 'pointer',
                                    borderTop: '1px solid #f5f5f5', background: checked ? '#f6ffed' : '#fff' }}>
                                  <Checkbox checked={checked} onChange={() => toggleScope(c)} />
                                  <span style={{ fontWeight: 600 }}>{c.project_name}</span>
                                  {c.method_name && <span style={{ fontSize: 12, color: '#999' }}>· {c.method_name}</span>}
                                  {c.needs_template && <Tag color="orange" style={{ margin: 0 }}>待配置项目模板</Tag>}
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

// ─── 可拖拽重排的字段行（HTML5 drag，带拖柄 + ↑↓ + 常驻「+下方插入」+ 接受拖入空行）──────
function DraggableField({ index, fieldAddress, dragGroup, selected, onSelect, onReorder, onNavigate, onEnterBeside, onDeleteBlank, showContinueEdges, pageBreak, blockStyle, children }: {
  index: number;
  fieldAddress: string;
  dragGroup: string;
  selected?: boolean;
  onSelect?: () => void;
  onReorder: (from: number, to: number) => void;
  onNavigate?: (direction: -1 | 1) => boolean;
  onEnterBeside?: (direction: -1 | 1) => void;
  onDeleteBlank?: (side: -1 | 1) => boolean;
  showContinueEdges?: boolean;
  pageBreak?: boolean;
  blockStyle?: StyleOverride;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const [edgeCaret, setEdgeCaret] = useState<-1 | 1 | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const focusPhoto = useReportPhotoFocus(frameRef);
  useEffect(() => {
    const node = frameRef.current;
    const exit = (event: Event) => {
      event.stopPropagation();
      const side = event.type === 'report-table-backward-boundary' ? -1 : 1;
      if (onNavigate?.(side)) return;
      setEdgeCaret(side); node?.focus({ preventScroll: true }); onSelect?.();
    };
    node?.addEventListener('report-table-forward-boundary', exit);
    node?.addEventListener('report-table-backward-boundary', exit);
    const caret = (event: Event) => { setEdgeCaret((event as CustomEvent).detail === -1 ? -1 : 1); };
    node?.addEventListener('report-figure-caret', caret);
    return () => { node?.removeEventListener('report-table-forward-boundary', exit); node?.removeEventListener('report-table-backward-boundary', exit); node?.removeEventListener('report-figure-caret', caret); };
  }, [onNavigate, onSelect]);
  // 一字段一条：最左仅一个拖拽手柄；点击整行选中。再次点击已选中字段的空白处（非输入框）取消选中。
  return (
    <div
      ref={frameRef}
      data-report-field={fieldAddress}
      data-report-page-break={pageBreak || undefined}
      tabIndex={0}
      role="group"
      onFocusCapture={event => { if (event.target !== event.currentTarget) setEdgeCaret(null); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.target === event.currentTarget && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); setEdgeCaret(null); onSelect?.(); return; }
        if (event.target === event.currentTarget && event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey && onEnterBeside) {
          event.preventDefault(); onEnterBeside(event.shiftKey ? -1 : edgeCaret || 1); setEdgeCaret(null); return;
        }
        if (event.target === event.currentTarget && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
          if ((event.key === 'Delete' || event.key === 'Backspace') && onDeleteBlank?.(edgeCaret || -1)) { event.preventDefault(); event.stopPropagation(); return; }
          const arrow = reportFigureArrow(event.key, edgeCaret);
          if (onEnterBeside && arrow) {
            event.preventDefault(); event.stopPropagation();
            if (arrow.navigate && onNavigate?.(arrow.side)) { setEdgeCaret(null); return; }
            setEdgeCaret(arrow.side); onSelect?.(); return;
          }
          const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : null;
          if (direction && onNavigate?.(direction)) { event.preventDefault(); return; }
        }
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault(); onSelect?.();
          event.currentTarget.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
        }
      }}
      className={`fe-row ${showContinueEdges ? 'fe-figure-row' : ''} ${selected ? 'fe-selected' : ''}`}
      onContextMenu={() => onSelect?.()}
      onClick={(e) => {
        if (isReportToolbarOverlay(e.target)) return;
        if (focusPhoto(e.target)) {
          setEdgeCaret(null);
          onSelect?.();
          return;
        }
        const target = reportFigureClickTarget(e.target);
        if (target === 'image') {
          frameRef.current?.focus({ preventScroll: true });
          setEdgeCaret(null);
          onSelect?.();
          return;
        }
        // 鼠标点击字段内容只负责选中当前字段。相邻导航仍由键盘方向键
        // 和明确的边缘继续编辑入口负责，避免误选上一行或下一行。
        onSelect?.();
      }}
      onDragOver={(e) => { if (!e.dataTransfer.types.includes('application/x-report-field')) return; e.preventDefault(); if (!over) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const data = e.dataTransfer.getData('application/x-report-field');
        if (!data) return; // Native rich-text/image drops are not field reordering.
        e.preventDefault(); setOver(false);
        try {
          const { from, group } = JSON.parse(data);
          if (group === dragGroup && Number.isInteger(from) && from >= 0 && from !== index) onReorder(from, index);
        } catch { /* ignore malformed external drag payloads */ }
      }}
      style={{ position: 'relative', gap: 4, marginTop: blockStyle?.space_before, marginBottom: blockStyle?.space_after,
        lineHeight: reportLineHeightCSS(blockStyle?.line_height),
        borderTop: `2px solid ${over ? '#1677ff' : 'transparent'}` }}
    >
      {showContinueEdges && onEnterBeside && <ReportFigureEdges directInput onContinue={direction => {
        setEdgeCaret(null);
        onSelect?.();
        onEnterBeside(direction);
      }} />}
      {edgeCaret && selected && onEnterBeside && <span aria-label={edgeCaret === -1 ? '图表前光标' : '图表后光标'} style={{ position: 'absolute', pointerEvents: 'none', left: edgeCaret === -1 ? 12 : undefined, right: edgeCaret === 1 ? 0 : undefined, top: edgeCaret === -1 ? 0 : undefined, bottom: edgeCaret === 1 ? 0 : undefined, height: '1.2em', borderLeft: '2px solid #1677ff' }} />}
      <Tooltip title="按住拖动重排">
        <span className="fe-drag" draggable
          onClick={event => { event.stopPropagation(); frameRef.current?.focus({ preventScroll: true }); setEdgeCaret(null); onSelect?.(); }}
          onDragStart={(e) => { draggedReportFigure = fieldAddress; e.dataTransfer.setData('application/x-report-field', JSON.stringify({ from: index, group: dragGroup })); e.dataTransfer.effectAllowed = 'move'; }}
          onDragEnd={() => { draggedReportFigure = null; setOver(false); }}
          style={{ fontSize: 14, lineHeight: 1, userSelect: 'none', flexShrink: 0, padding: '0 2px' }}>⠿</span>
      </Tooltip>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

/**
 * 图/表「上方标签 + 下方备注」编辑卡（两列，与图片 ImageSectionNotes 同款）。
 * 表格标题使用 table_title；图片标题使用 label + hide_label，与 PDF 规则一致。
 * 右＝表格下方备注（field.caption + 文字样式 caption_style + 备注↔表距离 caption_gap）。
 * 报告自动表标题缺省不显示（hide_label!==false），填了标签即自动置 hide_label=false 显示。
 */
function LabelCaptionCard({ field, onMutate }: { field: FieldDefinition; onMutate: (fn: (f: any) => void) => void }) {
  const f: any = field;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 'min(360px, calc(100vw - 64px))' }}>
      <div style={{ minWidth: 210 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>图/表上方·标签（空＝不显示）</div>
        <AutoGrowTextArea size="small" aria-label="图表标题" value={reportFigureTitle(field)} placeholder="如：检测结果表"
          onChange={(e) => onMutate(x => setReportFigureTitle(x, e.target.value))} />
        {!usesIndependentTableTitle(field) && <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0', fontSize: 12, color: '#666' }}>
          <Checkbox checked={f.hide_label === false} onChange={(e) => onMutate(x => { x.hide_label = e.target.checked ? false : undefined; })} /> 显示标签
        </label>}
        <FormatPanel variant="text" value={f.label_style} onChange={(s) => onMutate(x => { x.label_style = s; })} />
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tooltip title="标签与表之间的距离；留空＝默认"><span style={{ fontSize: 12, color: '#888' }}>标签↔表距离</span></Tooltip>
          <ReportGapInput value={f.label_gap} onChange={value => onMutate(x => { x.label_gap = value; })} />
        </div>
      </div>
      {f.caption && <div><div style={{ marginBottom: 4 }}>原备注（保留组合排版）</div>
        <AutoGrowTextArea value={f.caption} onChange={event => onMutate(x => { x.caption = event.target.value; })} />
      </div>}
    </div>
  );
}

function ReportGapInput({ value, onChange }: { value?: string; onChange: (value: string | undefined) => void }) {
  const size = value ? reportSpacerSize(value) : { value: 0, unit: 'pt' };
  return <Space.Compact size="small">
    <InputNumber aria-label="图表间距" style={{ width: 88 }} min={0} step={0.5} value={value ? size.value : null} placeholder="默认"
      onChange={next => onChange(next == null ? undefined : `${next}${size.unit}`)} />
    <AntSelect aria-label="图表间距单位" style={{ width: 64 }} value={size.unit}
      options={['pt', 'em', 'cm', 'mm', 'in', ...(size.unit === '%' ? ['%'] : [])].map(unit => ({ value: unit, label: unit }))}
      disabled={!value} onChange={unit => onChange(`${size.value}${unit}`)} />
  </Space.Compact>;
}

/**
 * 报告实例中的普通字段值编辑器。
 *
 * 模板字段的类型和选项会随 content_doc 一起冻结；这里必须按类型还原控件，不能把
 * select / checkbox / date 统一降级成文本框，否则首页和项目报告的编辑体验会与模板
 * 配置脱节。实例 binding 目前是字符串字面量，因此多选值以「、」保存，渲染和历史比对
 * 都能稳定地显示为可读文本。
 */
function ReportFieldValueEditor({
  field,
  value,
  status,
  onChange,
}: {
  field: FieldDefinition;
  value: string;
  status?: 'warning';
  onChange: (value: string) => void;
}) {
  const textValue = value === '—' ? '' : String(value ?? '');
  const baseStyle: React.CSSProperties = { flex: 1, minWidth: 160 };
  // “其他（自定义）”刚切换时值尚为空，不能仅靠当前字面量判断，否则输入框会立刻消失。
  const [selectCustomMode, setSelectCustomMode] = useState(false);
  const [checkboxCustomMode, setCheckboxCustomMode] = useState(false);

  if (field.type === 'date') {
    const parsed = textValue && dayjs(textValue).isValid() ? dayjs(textValue) : null;
    return <DatePicker size="small" value={parsed} status={status} style={baseStyle}
      onChange={(_date, dateText) => onChange(dateText || '')} />;
  }

  if (field.type === 'select') {
    const choices = field.options || [];
    const allowCustom = field.allow_custom !== false;
    const isCustom = allowCustom && (selectCustomMode || (!!textValue && !choices.includes(textValue)));
    const selected = isCustom ? '__custom__' : (textValue || undefined);
    const options = choices.map(option => ({ value: option, label: option }));
    if (allowCustom) options.push({ value: '__custom__', label: '其他（自定义）' });
    return (
      <Space size={4} style={{ flex: 1, minWidth: 200 }} wrap>
        <AntSelect size="small" value={selected} status={status} style={{ minWidth: 160, flex: 1 }}
          placeholder="请选择" options={options}
          onChange={(next) => {
            const custom = next === '__custom__';
            setSelectCustomMode(custom);
            onChange(custom ? '' : String(next || ''));
          }} />
        {isCustom && <AutoGrowTextArea size="small" value={textValue} placeholder="填写其他"
          style={{ minWidth: 150, flex: 1 }} onChange={(e) => onChange(e.target.value)} />}
      </Space>
    );
  }

  if (field.type === 'checkbox') {
    const choices = field.options || [];
    const allowCustom = field.allow_custom !== false;
    const selected = textValue.split('、').map(item => item.trim()).filter(Boolean);
    const known = selected.filter(item => choices.includes(item));
    const custom = selected.filter(item => !choices.includes(item));
    const hasCustom = custom.length > 0 || checkboxCustomMode;
    const setKnown = (next: string[]) => onChange([...next, ...custom].join('、'));
    return (
      <div style={{ flex: 1, minWidth: 200, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <Checkbox.Group value={known} options={choices.map(option => ({ value: option, label: option }))}
          onChange={(next) => setKnown(next.map(String))} />
        {allowCustom && <>
          <Checkbox checked={hasCustom} onChange={(e) => {
            setCheckboxCustomMode(e.target.checked);
            onChange(known.join('、'));
          }}>其他</Checkbox>
          {hasCustom && <AutoGrowTextArea size="small" value={custom.join('、')} placeholder="填写其他"
            style={{ width: 150 }} onChange={(e) => onChange([...known, e.target.value].filter(Boolean).join('、'))} />}
        </>}
      </div>
    );
  }

  return <AutoGrowTextArea size="small" value={textValue} status={status}
    onChange={(e) => onChange(e.target.value)}
    placeholder={field.hide_label ? '正文文字（无标签）' : '—'} />;
}

// ─── 单个分组的字段编辑 ───────────────────────────────────────────────
function GroupEditor(props: {
  group: FieldGroup;
  documentText?: boolean;
  onGroupBoundary?: (direction: -1 | 1) => boolean;
  onContinueOutsideImage?: (direction: -1 | 1) => void;
  onDeleteFigureBlank?: (id: string, side: -1 | 1) => boolean;
  onDeleteGroupBoundary?: (side: -1 | 1) => boolean;
  externalTextFocus?: { id: string; position: number; token: number; onApplied: () => void };
  readOnly?: boolean;
  ctx: any;
  documentFont?: string;
  documentSize?: number;
  documentFigureGapPt?: number;
  /** 本报告订单号——首页图片上传按 <根>/<订单号>/_首页/<字段名> 落盘。 */
  orderNo?: string;
  sectionKey: string;
  originalValues: Record<string, { label: string; value: string }>;
  divergedPaths: Set<string>;
  onFieldValue: (fieldIdx: number, val: string) => void;
  onInsertInParagraph: (fieldId: string, kind: 'table' | 'image', value: string, offset: number, split?: { before: string; after: string }, options?: ReportInsertOptions) => void;
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
  onFocusMarker: (markerCode: string, fieldIdx: number) => void;
  onTextFocus: (fieldCode: string) => void;
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
  const continuousBlocks = canContinueReportBlocks(group);
  const textRuns = props.documentText && !props.locked ? reportTextRuns(group) : [];
  const [textFocus, setTextFocus] = useState<{ id: string; token: number; edge: 'start' | 'end' }>();
  useEffect(() => { if (props.externalTextFocus) setTextFocus(undefined); }, [props.externalTextFocus]);
  const focusText = (id: string, edge: 'start' | 'end') => setTextFocus(previous => ({ id, edge, token: (previous?.token || 0) + 1 }));
  const enterBeside = (id: string, direction: -1 | 1) => {
    if (props.readOnly || props.locked) return;
    const code = newId('paragraph');
    const target = enterBesideReportBlock(JSON.parse(JSON.stringify(group)), id, direction, code);
    if (!target) return;
    props.onMutateGroup(g => { enterBesideReportBlock(g, id, direction, code); });
    focusText(target, direction === 1 ? 'start' : 'end');
  };
  const navigateBlock = (from: number, direction: -1 | 1) => {
    const target = group.fields[from + direction];
    if (props.readOnly) return false;
    if (!target) return props.onGroupBoundary?.(direction) || false;
    const targetRun = textRuns.find(run => run.ids.includes(target.id));
    const node = [...document.querySelectorAll<HTMLElement>('[data-report-field]')].find(node => node.dataset.reportField === `${sectionKey}/${targetRun?.ids[0] || target.id}`);
    if (!node) return false;
    props.onFocusField(from + direction);
    if (target.rich || targetRun) focusText(target.id, direction === 1 ? 'start' : 'end');
    else node.focus({ preventScroll: true });
    revealInScrollPanes(node);
    return true;
  };
  const isImageSection = group.section_role === 'images' && group.fields.some(f => f.type === 'image');
  // 图片块渲在【第一个 image 字段】的位置——与渲染端 generateGroupContent 一致（前面的非图片字段在图上方、后面的在图下方）
  const firstImgIdx = isImageSection ? group.fields.findIndex(f => f.type === 'image') : -1;
  const setLayout = (patch: any) => props.onMutateGroup(g => { g.image_layout = { ...(g.image_layout || {}), ...patch }; });
  const imageInheritedFont = group.style?.font || props.documentFont;
  const imageInheritedSize = group.style?.size ? (parseFloat(group.style.size) || props.documentSize) : props.documentSize;
  const imageDefaultInset = group.fields.find(field => field.type === 'image')?.image_table_style?.inset_pt ?? 6;
  const inner = (
    <div className={`fe-group-card report-document-group ${group.report_source_fields ? 'report-mixed-document' : ''} ${props.selectedFi != null || !group.fields.length ? 'report-group-active' : ''}`} style={{ fontFamily: reportFontStack(group.style?.font || props.documentFont, !!group.style?.font), fontSize: `${reportLengthPt(group.style?.size, 'pt', props.documentSize || 10) || props.documentSize || 10}pt` }}>
      {!props.readOnly && !props.locked && isImageSection && props.selectedFi === firstImgIdx && <ReportFigureTools>
      <ReportImageLayoutToolbar value={group.image_layout || {}} defaultInset={imageDefaultInset}
        inheritedFont={imageInheritedFont} inheritedSize={imageInheritedSize}
        titleStyle={group.image_layout?.label_style}
        onTitleStyleChange={patch => setLayout({ label_style: { ...group.image_layout?.label_style, ...patch } })}
        onChange={setLayout} onTitleModeChange={title_mode => setLayout({ title_mode })} />
      {group.image_layout?.title_mode === 'shared' && <Input size="small" aria-label="图片共用标题"
        style={{ width: 150 }} placeholder="共用标题" value={group.image_layout.shared_title || ''}
        onChange={event => setLayout({ shared_title: event.target.value })} />}
      {!group.hide_title && group.label && <Input size="small" aria-label="图片上方标题" style={{ width: 150 }}
        value={group.label} onChange={event => props.onMutateGroup(g => { g.label = event.target.value; })} />}
      {(group.image_layout?.top_label || group.image_layout?.caption) && <ClosablePopover trigger="click" title="图片说明"
        content={<ImageSectionNotes value={group.image_layout || {}} inheritedFont={imageInheritedFont} inheritedSize={imageInheritedSize} onChange={setLayout} />}>
        <Button size="small">图片说明 ▾</Button>
      </ClosablePopover>}
      </ReportFigureTools>}
      <ReportSectionHeading group={group} readOnly={props.readOnly || props.locked} onChange={title => props.onMutateGroup(g => { g.label = title; })} />
      <div>
      {group.fields.map((f, fi) => {
        if (hideAutomaticSampleTable(f, ctx)) return null;
        const run = textRuns.find(run => run.start === fi);
        if (run) return <div key={f.id} data-report-field={`${sectionKey}/${f.id}`} data-report-page-break={f.page_break_before || undefined}>
          <ReportContinuousText group={run.group} resolve={field => resolveReportFieldValue(field, ctx)}
            readOnly={!!props.readOnly} font={props.documentFont || ''} size={props.documentSize || 10}
            onFocus={() => props.onTextFocus(f.code)}
            focusRequest={props.externalTextFocus && run.ids.includes(props.externalTextFocus.id) ? props.externalTextFocus : textFocus && run.ids.includes(textFocus.id) ? textFocus : undefined}
            onBoundary={direction => navigateBlock(direction === 1 ? fi + run.ids.length - 1 : fi, direction)}
            onDeleteBoundary={direction => {
              const anchor = group.fields[direction === -1 ? fi : fi + run.ids.length - 1];
              if (anchor && props.onDeleteFigureBlank?.(anchor.id, direction)) return true;
              const adjacent = group.fields[direction === -1 ? fi - 1 : fi + run.ids.length];
              if (adjacent && (LABELCAP_TYPES.has(adjacent.type) || adjacent.type === 'image')
                && props.onDeleteFigureBlank?.(adjacent.id, direction === -1 ? 1 : -1)) return true;
              if (!adjacent && props.onDeleteGroupBoundary?.(direction)) return true;
              return false;
            }}
            onChange={value => {
              if (!props.readOnly) props.onMutateGroup(g => { updateReportTextRun(g, run.ids, value); });
            }}
            onInsert={(kind, value, split, options) => {
              if (props.readOnly) return;
              const current = reportTextRuns(group).find(item => item.ids.join('\0') === run.ids.join('\0'));
              if (!current || reportTextRunValue(current, field => resolveReportFieldValue(field, ctx)) !== value) {
                message.info('正文已更新，请重新定位光标后插入'); return;
              }
              const inserted = makeContentField(kind, options), tail = newId('paragraph');
              props.onMutateGroup(g => {
                const latest = reportTextRuns(g).find(item => item.ids.length === run.ids.length && item.ids.every((id, i) => id === run.ids[i]));
                if (!latest || reportTextRunValue(latest, field => resolveReportFieldValue(field, ctx)) !== value) return;
                const field = updateReportTextRun(g, run.ids, value);
                if (!field) return;
                const index = g.fields.findIndex(item => item.id === field.id);
                g.fields.splice(index, 1, ...insertIntoReportParagraph(field, value, 0, inserted, tail, split, true));
              });
            }} />
        </div>;
        if (textRuns.some(run => fi > run.start && fi < run.start + run.ids.length)) return null;
        let inner: React.ReactNode = null;
        if (f.type === 'free_grid' && f.instance_auto_free_table && f.free_table?.columns?.length) {
          // 项目自由表格已解锁：编辑当前值快照；可完整恢复解锁前的映射结构。
          inner = <FreeTableBlock title={f.label || '自由表格'} field={f}
            onMutate={(fn) => props.onMutateField(fi, fn)}
            onRestore={() => props.onMutateField(fi, field => {
              field.free_table = field.instance_auto_free_table;
              field.instance_auto_free_table = undefined;
            })} />;
        } else if (f.type === 'free_grid' && f.free_table?.columns?.length) {
          inner = <AutoTableBlock title={f.label || '自由表格'} accent="#1677ff" tag={<Tag color="blue">映射表格</Tag>}
            field={f} ctx={ctx} onMutate={(fn) => props.onMutateField(fi, fn)}
            notice={<div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 4 }}>当前按项目模板映射原始记录；自由编辑后可粘贴 Excel，且只影响本报告。</div>} />;
        } else if (TABLE_FREE_TYPES.has(f.type) && f.free_table?.columns?.length) {
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
          const size = reportSpacerSize(f.spacer_height);
          const setH = (value: number, unit = size.unit) => props.onMutateField(fi, ff => { ff.spacer_height = `${value}${unit}`; });
          inner = props.readOnly || props.locked ? (
            <div className="report-fixed-spacer" data-height={`${size.value}${size.unit}`}
              style={{ height: `${size.value}${size.unit}`, fontSize: group.style?.size || `${props.documentSize || 10}pt`, boxSizing: 'border-box' }} />
          ) : (
            <ClosablePopover trigger="click" title="调整留白" content={<Space>
              <InputNumber aria-label="留白高度" min={0} step={0.5} value={size.value} onChange={v => { if (v != null) setH(v); }} />
              <AntSelect aria-label="留白单位" value={size.unit} options={['em', 'pt', 'cm', 'mm', 'in', ...(size.unit === '%' ? ['%'] : [])].map(unit => ({ value: unit, label: unit }))} onChange={unit => setH(size.value, unit)} />
            </Space>}>
              <div className="report-fixed-spacer" data-height={`${size.value}${size.unit}`} role="button" tabIndex={0} aria-label="调整留白" title="点击调整留白"
                onKeyDown={e => {
                  if (e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
                  if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault(); e.stopPropagation();
                    navigateBlock(fi, fi > 0 ? -1 : 1);
                    props.onMutateGroup(g => { g.fields = g.fields.filter(field => field.id !== f.id); });
                    props.onDeselect();
                  } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); }
                }}
                style={{ height: `${size.value}${size.unit}`, fontSize: group.style?.size || `${props.documentSize || 10}pt`, cursor: 'pointer', boxSizing: 'border-box' }} />
            </ClosablePopover>
          );
        } else if (f.type === 'report_conclusion_table') {
          inner = <ConclusionTableEditor field={f} ctx={ctx} onMutate={(fn) => props.onMutateField(fi, fn)} />;
        } else if (f.type === 'report_image_gallery') {
          inner = <PhotoLayoutEditor field={f} ctx={ctx} orderNo={props.orderNo} kind="gallery" onMutate={(fn) => props.onMutateField(fi, fn)} onMutateCtx={props.onMutateCtx} />;
        } else if (f.type === 'report_photo_table') {
          inner = <PhotoLayoutEditor field={f} ctx={ctx} orderNo={props.orderNo} kind="photo_table" onMutate={(fn) => props.onMutateField(fi, fn)} onMutateCtx={props.onMutateCtx} />;
        } else if (f.type === 'report_sample_table') {
          inner = <SampleTableEditor field={f} ctx={ctx} onMutate={(fn) => props.onMutateField(fi, fn)} />;
        } else if (f.type === 'report_sample_description_table') {
          inner = <AutoTableBlock title={f.label || '样品描述表'} accent="#2f54eb" tag={<Tag color="geekblue">样品描述表</Tag>}
            field={f} ctx={ctx} onMutate={(fn) => props.onMutateField(fi, fn)}
            notice={<Alert type="info" showIcon message="默认描述为“见原始样品照片”；点击右上角“自由编辑表格”后可修改每个样品的描述。" style={{ marginBottom: 8 }} />} />;
        } else if (f.type === 'image') {
          // 图片分区：整组图位由 ImageSectionEditor 统一渲染，且放在【第一个 image 字段】的位置（其余 image 字段跳过）——
          // 使编辑顺序与渲染一致：排在图片前的非图片字段显示在图上方、排在后的显示在图下方。分区外独立 image(首页)仍走 ImageFieldEditor。
          inner = !isImageSection
            ? <ImageFieldEditor field={f} orderNo={props.orderNo} onMutate={(fn) => props.onMutateField(fi, fn)} />
            : (fi === firstImgIdx
                ? <ImageSectionEditor group={group} ctx={ctx} orderNo={props.orderNo} onMutateCtx={props.onMutateCtx} readOnly={props.readOnly || props.selectedFi !== fi}
                    onItemFocus={(itemId) => props.onFocusMarker(`__image_item__:${itemId}`, fi)} />
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
          const cur = resolveReportFieldValue(f, ctx);
          const path = `${sectionKey}/${f.id}`;
          const diverged = divergedPaths.has(path);
          const orig = originalValues[path]?.value;
          inner = (
            <div style={{ marginBottom: 4 }} onFocusCapture={() => props.onFocusField(fi)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {!f.rich && !f.hide_label && (
                  <Tooltip title="字段名（可改，显示在报告里）">
                    <AutoGrowTextArea size="small" variant="borderless" value={f.label}
                      style={{ width: 110, fontSize: 12, color: '#666', flexShrink: 0, padding: '0 2px' }}
                      onChange={(e) => props.onMutateField(fi, ff => { ff.label = e.target.value; })} />
                  </Tooltip>
                )}
                {f.rich ? (
                  <div style={{ flex: 1 }}>
                    <ReportParagraphEditor value={cur === '—' ? '' : cur} onChange={(v) => props.onFieldValue(fi, v)}
                      onInsert={(kind, value, offset, split, options) => props.onInsertInParagraph(f.id, kind, value, offset, split, options)} />
                  </div>
                ) : (
                  <ReportFieldValueEditor field={f} value={cur}
                    status={diverged ? 'warning' : undefined}
                    onChange={(value) => props.onFieldValue(fi, value)} />
                )}
                {f.style && <span title="该字段有自定义格式" style={{ fontSize: 11, color: '#722ed1', flexShrink: 0 }}>●</span>}
              </div>
              {diverged && orig !== undefined && (
                <div style={{ fontSize: 11, color: '#cf1322', paddingLeft: f.rich || f.hide_label ? 0 : 116 }}>
                  原始值：{orig === '—' || orig === '' ? '（空）' : f.rich ? reportRichPlainText(orig) : orig}
                </div>
              )}
            </div>
          );
        } else {
          // 兜底：任何未单独处理的字段类型（computed/reference/variant_list 等）也都拉取显示，
          // 有 binding 可改、无则只读展示当前值——保证「全部字段及其值」都出现在编辑器里。
          const cur = resolveReportFieldValue(f, ctx);
          inner = (
            <div style={{ marginBottom: 4 }} onFocusCapture={() => props.onFocusField(fi)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 110, fontSize: 12, color: '#888', flexShrink: 0 }}>{f.label || '未命名字段'}</span>
                <AutoGrowTextArea size="small" value={cur === '—' ? '' : cur} disabled={!f.binding}
                  placeholder={f.binding ? '—' : '（自动/派生值，不可直接改）'}
                  onChange={(e) => props.onFieldValue(fi, e.target.value)} />
                <Tag style={{ flexShrink: 0, fontSize: 11 }}>{f.type}</Tag>
              </div>
            </div>
          );
        }
        if (!inner) return null;
        const directTable = (f.type === 'free_grid' || TABLE_FREE_TYPES.has(f.type))
          && !(f.type === 'report_sample_table' && !f.free_table?.columns?.length && (f.sample_table?.mode || 'always') === 'auto' && (ctx?.order_samples?.length || 0) <= 1);
        if (directTable && !props.readOnly && !props.locked) inner = <InlineReportTable field={f} ctx={ctx}
          active={props.selectedFi === fi} onFocus={() => props.onFocusField(fi)} onMutate={fn => props.onMutateField(fi, fn)} />;
        if (!props.readOnly && !props.locked && props.selectedFi === fi && (f.type === 'image' || f.type === 'report_photo_table' || f.type === 'report_image_gallery')) {
          const imageEditor = inner;
          inner = <>
            {isImageSection ? <ImageSectionEditor group={group} ctx={ctx} orderNo={props.orderNo} onMutateCtx={props.onMutateCtx} readOnly editableTitles />
              : <ReportImagePreview model={reportImagePreview(f, ctx)} />}
            <ReportFigureTools><ReportImageManagerPopover>{imageEditor}</ReportImageManagerPopover></ReportFigureTools>
          </>;
        }
        // In document mode, inactive blocks display content, not configuration forms.
        if (props.readOnly || props.selectedFi !== fi) {
          if (f.rich || NORMAL_TYPES.has(f.type) || f.type === 'daterange') {
            const value = resolveReportFieldValue(f, ctx);
            inner = <div className="report-document-text" style={{ minHeight: '1.4em', whiteSpace: 'pre-wrap',
              fontSize: f.style?.size, fontFamily: f.style?.font, color: f.style?.color,
              fontWeight: f.style?.weight === 'bold' ? 700 : undefined, fontStyle: f.style?.italic ? 'italic' : undefined,
              textAlign: f.style?.align }}>
              {!f.rich && !f.hide_label && <span style={{ marginRight: '.5em' }}>{f.label}：</span>}
              {f.rich ? <ReportRichText value={value} /> : value || (!props.readOnly && !props.locked ? <span className="report-empty-content">点击填写</span> : null)}
            </div>;
          } else if ((props.readOnly || props.locked) && (f.type === 'free_grid' || TABLE_FREE_TYPES.has(f.type))
            && !(f.type === 'report_sample_table' && !f.free_table?.columns?.length && (f.sample_table?.mode || 'always') === 'auto' && (ctx?.order_samples?.length || 0) <= 1)) {
            const table = buildFreeTableFromField(f, ctx);
            inner = <div style={{ overflowX: 'auto' }}><ReadonlyGrid columns={table.columns} rows={table.rows} cells={table.cells} spans={table.spans} showHeader={f.type !== 'free_grid'} /></div>;
          } else if ((f.type === 'image' && !isImageSection) || f.type === 'report_photo_table' || f.type === 'report_image_gallery') {
            inner = <ReportImagePreview model={reportImagePreview(f, ctx)} />;
          }
        }
        // 报告图/表：实例可覆盖模板的上方标签和下方备注；独立图片也支持，图片分区则使用分区级入口。
        if (continuousBlocks && f.type === 'text' && f.rich && f.hide_label && f.binding?.source === 'literal') {
          const value = resolveReportFieldValue(f, ctx);
          inner = props.readOnly ? <ReportRichText value={value} /> : <ReportParagraphEditor value={value}
            focusRequest={textFocus?.id === f.id ? textFocus : undefined}
            onChange={value => props.onFieldValue(fi, value)}
            onInsert={(kind, value, offset, split, options) => props.onInsertInParagraph(f.id, kind, value, offset, split, options)}
            onDeleteBoundary={direction => {
              if (props.onDeleteFigureBlank?.(f.id, direction)) return true;
              const neighbor = group.fields[fi + direction];
              if (neighbor && (LABELCAP_TYPES.has(neighbor.type) || neighbor.type === 'image')
                && props.onDeleteFigureBlank?.(neighbor.id, direction === -1 ? 1 : -1)) return true;
              if (!neighbor && props.onDeleteGroupBoundary?.(direction)) return true;
              return false;
            }}
            onBoundary={direction => navigateBlock(fi, direction)} />;
        }
        const canEditCaption = LABELCAP_TYPES.has(f.type) || (f.type === 'image' && !isImageSection);
        const crossImage = ['image', 'report_photo_table', 'report_image_gallery'].includes(f.type) && (!isImageSection || fi === firstImgIdx);
        if (!props.readOnly && !props.locked && (directTable || crossImage)) {
          inner = <ReportCrossFigure kind={directTable ? 'table' : 'image'} snapshot={JSON.stringify(isImageSection ? group : f)}
            values={directTable ? reportTableFontValues(f) : [reportStyleFontValues(isImageSection ? group.image_layout?.label_style : reportImageTitleStyle(f, f.label_style))]} prepare={patch => {
            const style = reportFontStyle(patch);
            return () => props.onMutateGroup(current => {
              const target = current.fields.find(field => field.id === f.id);
              if (!target) throw new Error('图表位置已变化，请重新选择');
              if (directTable) applyReportTableFont(target, patch);
              else if (isImageSection) current.image_layout = { ...current.image_layout, label_style: { ...current.image_layout?.label_style, ...style } };
              else target.report_image_title_style = { ...target.report_image_title_style, ...style };
            });
          }}>{inner}</ReportCrossFigure>;
        }
        const captionEditor = (f.type === 'report_photo_table' || f.type === 'report_image_gallery' || f.type === 'image') && canEditCaption && !props.readOnly && !props.locked && props.selectedFi === fi ? (
          <ReportFigureTools>
            <PhotoLayoutEditor toolbarOnly field={f} ctx={ctx} orderNo={props.orderNo}
              kind={f.type === 'image' ? 'image_field' : f.type === 'report_image_gallery' ? 'gallery' : 'photo_table'}
              inheritedFont={imageInheritedFont} inheritedSize={imageInheritedSize}
              onMutate={fn => props.onMutateField(fi, fn)} onMutateCtx={props.onMutateCtx} />
            <Tooltip title="图/表上方标签（留空＝不显示；填了即显示）">
              <AutoGrowTextArea size="small" variant="filled" value={reportFigureTitle(f)} placeholder="图表标题（留空不显示）"
                style={{ maxWidth: 220, fontSize: 12, color: usesIndependentTableTitle(f) || f.hide_label === false ? '#33415c' : '#8a94a6' }}
                onChange={(e) => props.onMutateField(fi, ff => setReportFigureTitle(ff, e.target.value))} />
            </Tooltip>
            {f.caption && <ClosablePopover trigger="click" placement="bottomLeft" title="图片说明" overlayInnerStyle={{ maxHeight: '78vh', overflowY: 'auto' }}
              content={<LabelCaptionCard field={f} onMutate={(fn) => props.onMutateField(fi, fn)} />}>
              <Button size="small">图片说明 ▾</Button>
            </ClosablePopover>}
          </ReportFigureTools>
        ) : null;
        return (
          <Fragment key={f.id || fi}>
            <DraggableField index={fi} fieldAddress={`${sectionKey}/${f.id}`} dragGroup={`${sectionKey}/${group.id}`}
              blockStyle={isImageSection ? group.style : f.style}
              pageBreak={f.page_break_before}
              onNavigate={isImageSection && fi === firstImgIdx ? direction => props.onGroupBoundary?.(direction) || false : continuousBlocks ? direction => navigateBlock(fi, direction) : undefined}
              onDeleteBlank={!props.readOnly && !props.locked && (canEditCaption || isImageSection && fi === firstImgIdx) ? side => props.onDeleteFigureBlank?.(f.id, side) || false : undefined}
              onEnterBeside={!props.readOnly && !props.locked ? isImageSection && fi === firstImgIdx ? props.onContinueOutsideImage : continuousBlocks && !f.rich ? direction => enterBeside(f.id, direction) : undefined : undefined}
              showContinueEdges={(canEditCaption || isImageSection && fi === firstImgIdx) && !props.readOnly && !props.locked}
              selected={props.selectedFi === fi} onSelect={() => props.onFocusField(fi)}
              onReorder={props.onReorderField}>
              {canEditCaption && f.type !== 'image' && (usesIndependentTableTitle(f) || f.hide_label === false) && reportFigureTitle(f) && <div className="report-figure-heading">{reportFigureTitle(f)}</div>}
              {canEditCaption && f.caption_position === 'above' && f.caption && <div className="report-figure-caption">{f.caption}</div>}
              {inner}
              {canEditCaption && f.caption_position !== 'above' && f.caption && <div className="report-figure-caption">{f.caption}</div>}
              {captionEditor}
            </DraggableField>
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
      <div className="report-signature-preview" style={{ position: 'relative', border: sectionKey === 'cover' ? '1px solid #ccd8e8' : undefined, borderRadius: 6, paddingTop: sectionKey === 'cover' ? 50 : 16, paddingBottom: 16, marginTop: 32, marginBottom: 32, background: sectionKey === 'cover' ? '#f4f7fb' : undefined }}>
        <div style={{ pointerEvents: 'none', opacity: 0.6, userSelect: 'none' }} aria-disabled>{inner}</div>
        <div style={{ position: 'absolute', top: 5, right: 8, display: 'flex', alignItems: 'center', gap: 6, zIndex: 5 }}>
          <Tooltip title={sectionKey === 'cover' ? '首页底部：固定在首页；随正文：紧接正文；当前页底部：跟随正文所在页，空间不足时移至下一页底部' : '签字栏在页面上的位置'}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fff', borderRadius: 6, padding: '1px 5px', boxShadow: '0 1px 5px rgba(16,40,80,0.12)' }}>
              <span style={{ fontSize: 11, color: '#888' }}>位置</span>
              <Segmented
                size="small"
                disabled={props.readOnly}
                value={sectionKey === 'cover' ? signaturePosition(group) : vAlign}
                onChange={(v) => props.onMutateGroup(g => { if (sectionKey === 'cover') g.signature_position = v as NonNullable<FieldGroup['signature_position']>; else g.style = { ...g.style, vertical_align: v === 'flow' ? undefined : (v as 'center' | 'bottom') }; })}
                options={sectionKey === 'cover' ? [...SIGNATURE_POSITION_OPTIONS] : [{ label: '跟随正文', value: 'flow' }, { label: '居中', value: 'center' }, { label: '底部', value: 'bottom' }]}
              />
            </span>
          </Tooltip>
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
function reportColumnLetter(index: number): string {
  let result = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}

function InlineReportTable({ field, ctx, active, onMutate, onFocus }: {
  field: FieldDefinition; ctx: any; active: boolean; onMutate: (fn: (field: FieldDefinition) => void) => void; onFocus: () => void;
}) {
  const table = useMemo(() => reportEditableTable(field, ctx), [field, ctx]);
  const values = useMemo(() => field.type === 'free_grid' ? resolveReportFreeGridValues(field, table, undefined, ctx) : table.cells, [field, table, ctx]);
  return <div onFocusCapture={onFocus}><FreeGridEditor columns={table.columns} rows={table.rows} cells={values} spans={table.spans}
    cellStyles={table.cell_styles} headerHeight={table.header_height}
    tableStyle={field.table_style} headerCells={table.header_cells}
    active={active} showHeader={field.type !== 'free_grid'} onMutate={fn => onMutate(current => editReportTable(current, ctx, fn))} /></div>;
}

function FreeGridEditor({ columns, rows, cells, spans, onMutate, active = true, showHeader = true, cellStyles, tableStyle, headerCells, headerHeight }: {
  columns: Array<{ id: string; label: string; width?: string; style?: StyleOverride }>;
  rows: Array<{ id: string; height?: string }>;
  cells: Record<string, string>;
  spans?: Record<string, { colspan?: number; rowspan?: number }>;
  onMutate: (fn: (f: FieldDefinition) => void) => void;
  active?: boolean;
  showHeader?: boolean;
  cellStyles?: NonNullable<FieldDefinition['free_table']>['cell_styles'];
  tableStyle?: FieldDefinition['table_style'];
  headerCells?: NonNullable<FieldDefinition['free_table']>['header_cells'];
  headerHeight?: string;
}) {
  const sp = spans || {};
  const ct = (f: FieldDefinition) => (f.free_table = f.free_table || { columns: [], rows: [], cells: {} });
  const setCols = (next: any[]) => onMutate(f => { ct(f).columns = next; });
  const setColLabel = (id: string, v: string) => setCols(columns.map(c => c.id === id ? { ...c, label: v } : c));
  const setColWidth = (id: string, v?: string) => setCols(columns.map(c => c.id === id ? { ...c, width: v || undefined } : c));
  const setRowHeight = (id: string, v?: string) => onMutate(f => { const t = ct(f); t.row_height_mode = 'track'; t.rows = t.rows.map(r => r.id === id ? { ...r, height: v || undefined } : r); });
  const addCol = (afterIdx?: number) => onMutate(f => {
    const c = ct(f), error = insertReportTableAxis(c, 'col', afterIdx == null ? c.columns.length : afterIdx + 1, newId('fc'));
    if (error) message.warning(error);
  });
  const removeCol = (id: string) => onMutate(f => {
    const error = deleteReportTableAxis(ct(f), 'col', id);
    if (error) message.warning(error);
  });
  const addRow = (afterIdx?: number) => onMutate(f => {
    const c = ct(f), error = insertReportTableAxis(c, 'row', afterIdx == null ? c.rows.length : afterIdx + 1, newId('fr'));
    if (error) message.warning(error);
  });
  const removeRow = (id: string) => onMutate(f => {
    const error = deleteReportTableAxis(ct(f), 'row', id);
    if (error) message.warning(error);
  });
  const setCell = (rowId: string, colId: string, v: string) => onMutate(f => {
    const c = ct(f); c.cells = { ...(c.cells || {}), [`${rowId}::${colId}`]: v };
    // Explicit report edits replace a derived value only in this report snapshot.
    if (c.cell_formulas) delete c.cell_formulas[`${rowId}::${colId}`];
    if (c.cell_bindings) delete c.cell_bindings[`${rowId}::${colId}`];
  });
  // 合并/拆分：在选中主格上设跨列/跨行（1=拆分，删除该 span 键；并保证该格在 cells 里存在＝主格）
  const setSpan = (rowId: string, colId: string, key: 'colspan' | 'rowspan', val: number) => onMutate(f => {
    const error = resizeReportTableMerge(ct(f), rowId, colId, key, val);
    if (error) message.warning(error);
  });

  // 选中格（用于合并控制）
  const [sel, setSel] = useState<{ rowId: string; colId: string; header?: boolean } | null>(null);
  const [rangeEnd, setRangeEnd] = useState<{ rowId: string; colId: string } | null>(null);
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const selectingCells = useRef(false);
  const tableElement = useRef<HTMLTableElement>(null);
  useEffect(() => {
    const frame = tableElement.current?.closest('.fe-row');
    const clear = (event: Event) => { if (event.target === frame) { setSel(null); setRangeEnd(null); setEditingCell(null); } };
    frame?.addEventListener('focus', clear);
    return () => frame?.removeEventListener('focus', clear);
  }, []);
  const [inheritedFont, setInheritedFont] = useState<string>();
  useEffect(() => {
    if (tableElement.current) setInheritedFont(getComputedStyle(tableElement.current).fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '') || undefined);
  }, [active, sel, tableStyle]);
  useEffect(() => { const end = () => { selectingCells.current = false; }; window.addEventListener('mouseup', end); return () => window.removeEventListener('mouseup', end); }, []);
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
  const rangeRi = rangeEnd ? (rowIndex.get(rangeEnd.rowId) ?? selRi) : selRi;
  const rangeCi = rangeEnd ? (colIndex.get(rangeEnd.colId) ?? selCi) : selCi;
  const top = Math.min(selRi, rangeRi), bottom = Math.max(selRi, rangeRi), left = Math.min(selCi, rangeCi), right = Math.max(selCi, rangeCi);
  const hasRange = !!sel && !sel.header && !!rangeEnd && (top !== bottom || left !== right);
  const selectionKeys: string[] = [];
  if (sel?.header && showHeader) selectionKeys.push(`::${sel.colId}`);
  if (sel && !sel.header && rowIndex.has(sel.rowId) && colIndex.has(sel.colId)) {
    for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) {
      if (!covered.has(`${rows[r].id}|${columns[c].id}`)) selectionKeys.push(`${rows[r].id}::${columns[c].id}`);
    }
  }
  const formatSelection = (patch: StyleOverride) => onMutate(f => {
    if (sel?.header) { const col = ct(f).columns.find(c => c.id === sel.colId); if (col) col.style = { ...col.style, ...patch }; return; }
    const table = ct(f); table.cell_styles = { ...table.cell_styles };
    for (const key of selectionKeys) table.cell_styles[key] = { ...table.cell_styles[key], ...patch };
  });
  const styleAt = (key: string) => ({ color: tableStyle?.color, italic: tableStyle?.italic,
    ...(sel?.header ? columns.find(c => c.id === sel.colId)?.style : cellStyles?.[key]) });
  const selectedFonts = new Set(selectionKeys.map(key => styleAt(key)?.font || (sel?.header || (!showHeader && headerCells?.[key]) ? tableStyle?.header_font : tableStyle?.body_font) || tableStyle?.font || inheritedFont));
  const selectedFont = selectedFonts.size === 1 ? [...selectedFonts][0] : undefined;
  const boldAt = (key: string) => styleAt(key)?.weight ? styleAt(key)?.weight === 'bold'
    : sel?.header ? tableStyle?.header_bold !== false
    : !showHeader && headerCells?.[key] ? tableStyle?.header_bold !== false : tableStyle?.body_bold === true;

  const pasteCells = (e: React.ClipboardEvent<HTMLElement>, startRi: number, startCi: number) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    const grid = parseSpreadsheetClipboard(text);
    if (!grid.length) return;
    if (editingCell && grid.length === 1 && grid[0].length === 1 && !hasRange) return;
    e.preventDefault(); e.stopPropagation();
    applyPastedGrid(grid, startRi, startCi);
  };
  const applyPastedGrid = (grid: string[][], startRi: number, startCi: number) => {
    const next: Record<string, string> = {};
    const pastedKeys: string[] = [];
    let written = 0, skippedMerged = 0, clipped = 0;
    grid.forEach((sourceRow, rowOffset) => sourceRow.forEach((value, colOffset) => {
      const ri = startRi + rowOffset, ci = startCi + colOffset;
      if (ri >= rows.length || ci >= columns.length) { clipped++; return; }
      const row = rows[ri], col = columns[ci];
      if (!row || !col) { clipped++; return; }
      if (covered.has(`${row.id}|${col.id}`)) { skippedMerged++; return; }
      const key = `${row.id}::${col.id}`;
      next[key] = value;
      pastedKeys.push(key);
      written++;
    }));

    if (!written) { message.warning('没有可粘贴的目标单元格'); return; }
    const apply = () => {
      onMutate(f => {
        const table = ct(f); table.cells = { ...table.cells, ...next };
        for (const key of pastedKeys) {
          if (table.cell_formulas) delete table.cell_formulas[key];
          if (table.cell_bindings) delete table.cell_bindings[key];
        }
      });
      message.success(`已从当前单元格开始粘贴 ${written} 格`);
      const notes: string[] = [];
      if (skippedMerged) notes.push(`跳过 ${skippedMerged} 个合并覆盖格`);
      if (clipped) notes.push(`超出表格范围 ${clipped} 格`);
      if (notes.length) message.warning(notes.join('；'), 6);
    };
    apply();
  };

  // 拖拽改列宽(fr)/行高(cm)——指针捕获，与画布同款手感
  const [drag, setDrag] = useState<{ kind: 'col' | 'row'; id: string; start: number; startVal: number; scale: number } | null>(null);
  const frOf = (w?: string) => (w && /fr$/.test(w)) ? parseFloat(w) : 1;
  const cmOf = (h?: string) => { const pt = reportLengthPt(h, 'cm'); return pt == null ? undefined : pt * 2.54 / 72; };
  const common = (values: Array<number | undefined>) => values.length && values.every(v => v === values[0]) ? values[0] : undefined;
  const uniformHeight = common([...rows.map(row => cmOf(row.height)), ...(showHeader ? [cmOf(headerHeight)] : [])]);
  const uniformWidth = common(columns.map(col => cmOf(col.width)));
  const fixedWidths = columns.map(col => col.width && /(?:cm|mm|pt|in)$/.test(col.width) ? reportLengthPt(col.width, 'pt') : undefined);
  const fixedTotal = fixedWidths.reduce<number>((sum, width) => sum + (width || 0), 0);
  const flexibleTotal = columns.reduce((sum, col, i) => sum + (fixedWidths[i] == null ? frOf(col.width) : 0), 0);

  const headerRowCount = showHeader ? 1 : 0;
  const [dimensionDraft, setDimensionDraft] = useState({ rows: rows.length + headerRowCount, columns: columns.length });
  const [dimensionsOpen, setDimensionsOpen] = useState(false);
  const [confirmShrink, setConfirmShrink] = useState(false);
  const applyDimensions = () => {
    const rowCount = dimensionDraft.rows - headerRowCount, columnCount = dimensionDraft.columns;
    if (!Number.isInteger(rowCount) || !Number.isInteger(columnCount) || rowCount < 1 || rowCount > 1000 || columnCount < 1 || columnCount > 200) { message.warning('请输入有效行列数'); return; }
    if (!confirmShrink && (rowCount < rows.length || columnCount < columns.length)) { setConfirmShrink(true); return; }
    onMutate(f => { const error = resizeReportTable(ct(f), rowCount, columnCount, () => newId('grid')); if (error) message.warning(error); });
    setDimensionsOpen(false);
  };
  const tableMenu = {
    items: [
      { key: 'copy', label: '复制', disabled: !sel },
      { key: 'paste', label: '粘贴', disabled: !sel || sel.header },
      { key: 'addRow', label: '新增行', disabled: !sel },
      { key: 'addCol', label: '新增列', disabled: !sel },
      { key: 'deleteRow', label: '删除行', icon: <DeleteOutlined />, danger: true, disabled: !sel || sel.header || !rowIndex.has(sel.rowId) || rows.length <= 1 || (hasRange && bottom - top + 1 >= rows.length) },
      { key: 'deleteCol', label: '删除列', icon: <DeleteOutlined />, danger: true, disabled: !sel || !colIndex.has(sel.colId) || columns.length <= 1 || (hasRange && right - left + 1 >= columns.length) },
    ],
    onClick: ({ key }: { key: string }) => {
      if (!sel) return;
      if (key === 'copy') {
        if (!navigator.clipboard?.writeText) { message.info('请按 Ctrl/Cmd+C 复制'); return; }
        const values = sel.header ? [columns.slice(left, right + 1).map(col => col.label)] : rows.slice(top, bottom + 1).map(row => columns.slice(left, right + 1).map(col => covered.has(`${row.id}|${col.id}`) ? '' : cells[`${row.id}::${col.id}`] ?? ''));
        navigator.clipboard?.writeText(serializeSpreadsheetClipboard(values)).catch(() => message.warning('浏览器未允许复制，请按 Ctrl/Cmd+C'));
        return;
      }
      if (key === 'paste' && !sel.header) {
        if (!navigator.clipboard?.readText) { message.info('请按 Ctrl/Cmd+V 粘贴'); return; }
        navigator.clipboard.readText().then(text => { if (text) applyPastedGrid(parseSpreadsheetClipboard(text), top, left); }).catch(() => message.warning('浏览器未允许读取剪贴板，请按 Ctrl/Cmd+V'));
        return;
      }
      if (key === 'addRow') addRow(sel.header ? -1 : bottom);
      if (key === 'addCol') addCol(right);
      if (key === 'deleteRow' && !sel.header) {
        if (!hasRange) removeRow(sel.rowId);
        else onMutate(f => { const error = deleteReportTableRange(ct(f), 'row', top, bottom); if (error) message.warning(error); });
      }
      if (key === 'deleteCol') {
        if (!hasRange) removeCol(sel.colId);
        else onMutate(f => { const error = deleteReportTableRange(ct(f), 'col', left, right); if (error) message.warning(error); });
      }
    },
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      {active && <ReportFigureTools>
      {sel && colIndex.has(sel.colId) && (sel.header ? showHeader : rowIndex.has(sel.rowId)) && <>
        <Button size="small" aria-label="表格选区加粗" type={selectionKeys.every(boldAt) ? 'primary' : 'default'}
          onClick={() => formatSelection({ weight: selectionKeys.every(boldAt) ? 'regular' : 'bold' })}>B</Button>
        <Button size="small" aria-label="表格选区斜体" type={selectionKeys.every(key => styleAt(key)?.italic) ? 'primary' : 'default'} onClick={() => formatSelection({ italic: !selectionKeys.every(key => styleAt(key)?.italic) })}>I</Button>
        <Dropdown trigger={['click']} menu={{ items: [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72].map(size => ({ key: String(size), label: `${size} pt` })),
          onClick: ({ key }) => formatSelection({ size: `${key}pt` }) }}><Button size="small">字号 ▾</Button></Dropdown>
        <Dropdown trigger={['click']} menu={{ items: [['#000000', '黑色'], ['#595959', '灰色'], ['#cf1322', '红色'], ['#d48806', '金色'], ['#389e0d', '绿色'], ['#1677ff', '蓝色'], ['#722ed1', '紫色']].map(([key, label]) => ({ key, label, icon: <span style={{ width: 12, height: 12, display: 'inline-block', background: key }} /> })), onClick: ({ key }) => formatSelection({ color: key }) }}><Button size="small">颜色 ▾</Button></Dropdown>
        {([{ key: 'left', label: '单元格左对齐', icon: <AlignLeftOutlined /> }, { key: 'center', label: '单元格居中', icon: <AlignCenterOutlined /> }, { key: 'right', label: '单元格右对齐', icon: <AlignRightOutlined /> }] as const).map(item => <Tooltip key={item.key} title={item.label}><Button size="small" aria-label={item.label} icon={item.icon} type={selectionKeys.every(key => (styleAt(key)?.align || tableStyle?.cell_align || 'center') === item.key) ? 'primary' : 'default'} onClick={() => formatSelection({ align: item.key })} /></Tooltip>)}
        <AntSelect size="small" aria-label="表格字体" style={{ width: 125 }} value={selectedFont} options={REPORT_FONTS.filter(font => font.value)} onChange={font => formatSelection({ font })} />
      </>}
        <ClosablePopover trigger="click" title={selectionKeys.length ? '选中单元格行距' : '整表行距'} content={<Space direction="vertical">
          <span>额外行间距（em）</span>
          <InputNumber aria-label="表格文字行距" style={{ width: 144, maxWidth: 'calc(100vw - 64px)' }} min={0} max={10} step={0.1} suffix="em"
            value={common((selectionKeys.length ? selectionKeys.map(styleAt) : [...columns.map(c => c.style), ...rows.flatMap(r => columns.map(c => cellStyles?.[`${r.id}::${c.id}`]))]).map(style => reportLengthPt(style?.line_height, 'em', 1)))}
            onChange={value => {
              if (value == null) return;
              const patch = { line_height: `${value}em` };
              if (selectionKeys.length) formatSelection(patch);
              else onMutate(f => { const table = ct(f); table.cell_styles = { ...table.cell_styles };
                if (showHeader) table.columns.forEach(col => { col.style = { ...col.style, ...patch }; });
                table.rows.forEach(row => table.columns.forEach(col => { const key = `${row.id}::${col.id}`; table.cell_styles![key] = { ...table.cell_styles![key], ...patch }; }));
              });
            }} />
        </Space>}><Button size="small">行距 ▾</Button></ClosablePopover>
        <Popover trigger="click" open={dimensionsOpen} onOpenChange={open => { setDimensionsOpen(open); setConfirmShrink(false); if (open) setDimensionDraft({ rows: rows.length + headerRowCount, columns: columns.length }); }} title="表格尺寸" content={<Space direction="vertical">
          <Space>行数<InputNumber min={1 + headerRowCount} max={1000 + headerRowCount} precision={0} value={dimensionDraft.rows} onChange={v => { setConfirmShrink(false); setDimensionDraft(d => ({ ...d, rows: v ?? 0 })); }} /></Space>
          <Space>列数<InputNumber min={1} max={200} precision={0} value={dimensionDraft.columns} onChange={v => { setConfirmShrink(false); setDimensionDraft(d => ({ ...d, columns: v ?? 0 })); }} /></Space>
          {confirmShrink && <span style={{ color: '#cf1322' }}>将删除底部多余行、右侧多余列及其中内容。</span>}
          <Space><Button size="small" onClick={() => setDimensionsOpen(false)}>取消</Button><Button size="small" type="primary" danger={confirmShrink} onClick={applyDimensions}>{confirmShrink ? '确认删除并应用' : '应用'}</Button></Space>
        </Space>}><Button size="small">表格尺寸 ▾</Button></Popover>
        <Button size="small" aria-label="新增行" onClick={() => addRow(sel?.header ? -1 : sel && rowIndex.has(sel.rowId) ? bottom : undefined)}>+行</Button>
        <Button size="small" aria-label="新增列" onClick={() => addCol(sel && colIndex.has(sel.colId) ? right : undefined)}>+列</Button>
        <Button size="small" danger disabled={!sel || sel.header || !rowIndex.has(sel.rowId) || rows.length <= 1 || (hasRange && bottom - top + 1 >= rows.length)}
          aria-label="删除行" onClick={() => { if (!sel) return; if (!hasRange) removeRow(sel.rowId); else onMutate(f => { const error = deleteReportTableRange(ct(f), 'row', top, bottom); if (error) message.warning(error); }); }} icon={<DeleteOutlined />}>行</Button>
        <Button size="small" danger disabled={!sel || !colIndex.has(sel.colId) || columns.length <= 1 || (hasRange && right - left + 1 >= columns.length)}
          aria-label="删除列" onClick={() => { if (!sel) return; if (!hasRange) removeCol(sel.colId); else onMutate(f => { const error = deleteReportTableRange(ct(f), 'col', left, right); if (error) message.warning(error); }); }} icon={<DeleteOutlined />}>列</Button>
        <ClosablePopover trigger="click" title="整表行高" content={<Space direction="vertical">
          <Space>行高<InputNumber aria-label="整表行高" min={0.1} max={40} step={0.1} suffix="cm" value={uniformHeight} onChange={v => { if (v != null) onMutate(f => { const t = ct(f); t.row_height_mode = 'track'; t.rows.forEach(row => { row.height = `${v}cm`; }); if (showHeader) t.header_height = `${v}cm`; }); }} /></Space>
          <Button size="small" onClick={() => onMutate(f => { ct(f).rows.forEach(row => { delete row.height; }); delete ct(f).header_height; })}>按内容适应</Button>
        </Space>}><Button size="small">行高 ▾</Button></ClosablePopover>
        <ClosablePopover trigger="click" title="整表列宽" content={<Space direction="vertical">
          <Space>每列宽度<InputNumber aria-label="整表列宽" min={0.2} max={30} step={0.1} suffix="cm" value={uniformWidth} onChange={v => { if (v != null) onMutate(f => { ct(f).columns.forEach(col => { col.width = `${v}cm`; }); }); }} /></Space>
          <Button size="small" onClick={() => onMutate(f => { ct(f).columns.forEach(col => { col.width = '1fr'; }); })}>等分可用宽度</Button>
        </Space>}><Button size="small">列宽 ▾</Button></ClosablePopover>
      {sel && colIndex.has(sel.colId) && (sel.header ? showHeader : rowIndex.has(sel.rowId)) && <>
        {sel.header && <>

          <Tooltip title="此表的独立列标题暂不支持合并"><Button size="small" disabled>合并</Button></Tooltip><Button size="small" disabled>拆分</Button>
        </>}
        {!sel.header && <>
        {hasRange ? <Button size="small" onClick={() => onMutate(f => {
          const error = mergeReportTableRange(ct(f), top, left, bottom, right); if (error) message.warning(error);
        })}>合并选区</Button> : <ClosablePopover trigger="click" title="从当前格向右、向下合并" content={
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#555' }}>选中格 跨列</span>
          <InputNumber size="small" min={1} max={columns.length - selCi} style={{ width: 56 }}
            value={selSpan.colspan || 1} onChange={(v) => setSpan(sel.rowId, sel.colId, 'colspan', Number(v) || 1)} />
          <span style={{ color: '#555' }}>跨行</span>
          <InputNumber size="small" min={1} max={rows.length - selRi} style={{ width: 56 }}
            value={selSpan.rowspan || 1} onChange={(v) => setSpan(sel.rowId, sel.colId, 'rowspan', Number(v) || 1)} />
        </div>}><Button size="small">合并 ▾</Button></ClosablePopover>}
        <Button size="small" disabled={!selectionKeys.some(key => (sp[key]?.colspan || 1) > 1 || (sp[key]?.rowspan || 1) > 1)}
          onClick={() => onMutate(f => { const c = ct(f); const next = { ...c.spans }; for (const key of selectionKeys) delete next[key]; c.spans = next; })}>拆分</Button></>}
      </>}
      </ReportFigureTools>}
      <Dropdown trigger={['contextMenu']} menu={tableMenu}><div style={{ marginLeft: -30, width: 'calc(100% + 30px)', paddingBottom: 10, cursor: 'text' }} onClick={event => { if (event.target === event.currentTarget) { event.stopPropagation(); tableElement.current?.dispatchEvent(new CustomEvent('report-table-forward-boundary', { bubbles: true })); } }}>
      <table ref={tableElement} className="report-inline-table" style={{ borderCollapse: 'collapse', fontFamily: tableStyle?.font, fontSize: tableStyle?.font_size || 'inherit', tableLayout: 'fixed', width: flexibleTotal ? '100%' : `${fixedTotal + 22.5}pt` }}
        onCopy={event => {
          if (!sel || sel.header || (editingCell && !hasRange)) return;
          const values = rows.slice(top, bottom + 1).map(row => columns.slice(left, right + 1)
            .map(col => covered.has(`${row.id}|${col.id}`) ? '' : cells[`${row.id}::${col.id}`] ?? ''));
          event.clipboardData.setData('text/plain', serializeSpreadsheetClipboard(values));
          event.preventDefault(); event.stopPropagation();
        }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') { setEditingCell(null); setRangeEnd(null); event.stopPropagation(); return; }
          if (sel && !sel.header && !event.ctrlKey && !event.metaKey && !event.altKey) {
            if (event.key === 'Enter' && !editingCell) {
              event.preventDefault(); event.stopPropagation(); setRangeEnd(null);
              setEditingCell(`${sel.rowId}::${sel.colId}`); return;
            }
            if (editingCell && event.key !== 'Tab' && !(event.key === 'Enter' && !event.shiftKey)) return;
            if (!editingCell && event.key.length === 1) {
              // 中文输入交给 compositionstart；普通字符直接替换当前格。
              event.preventDefault(); event.stopPropagation(); setRangeEnd(null);
              setEditingCell(`${sel.rowId}::${sel.colId}`); setCell(sel.rowId, sel.colId, event.key); return;
            }
          }
          if (sel && !sel.header && !editingCell && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (event.key === 'Delete' || event.key === 'Backspace')) {
            event.preventDefault(); event.stopPropagation();
            onMutate(f => { const table = ct(f); for (const key of selectionKeys) { table.cells[key] = ''; if (table.cell_formulas) delete table.cell_formulas[key]; if (table.cell_bindings) delete table.cell_bindings[key]; } });
            return;
          }
          if (event.key === 'Enter' || event.key === 'Tab') setEditingCell(null);
          handleExcelTableKeyDown(event,
            () => tableElement.current?.dispatchEvent(new CustomEvent('report-table-forward-boundary', { bubbles: true })),
            () => tableElement.current?.dispatchEvent(new CustomEvent('report-table-backward-boundary', { bubbles: true })));
        }}>
        <colgroup><col style={{ width: 30 }} />{columns.map((c, i) => <col key={c.id} style={{ width: fixedWidths[i] != null ? `${fixedWidths[i]}pt` : `calc(${frOf(c.width) / flexibleTotal * 100}% - ${(fixedTotal + 22.5) * frOf(c.width) / flexibleTotal}pt)` }} />)}</colgroup>
        <thead>
          <tr style={{ height: showHeader ? headerHeight : undefined }}>
              <th className="report-table-coordinate" style={{ position: 'relative', width: 30, border: '1px solid #eee', background: '#fafafa' }}>
                {showHeader && <div title="拖拽调整表头行高，双击按内容适应"
                  onPointerDown={e => { e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); const row = e.currentTarget.closest('tr')!; setDrag({ kind: 'row', id: '__header__', start: e.clientY, startVal: row.offsetHeight / 37.795, scale: row.getBoundingClientRect().height / row.offsetHeight || 1 }); }}
                  onPointerMove={e => { if (drag?.id === '__header__') { const height = Math.max(0.1, Math.round((drag.startVal + (e.clientY - drag.start) / drag.scale / 37.795) * 100) / 100); onMutate(f => { ct(f).row_height_mode = 'track'; ct(f).header_height = `${height}cm`; }); } }}
                  onPointerUp={e => { e.currentTarget.releasePointerCapture(e.pointerId); setDrag(null); }} onPointerCancel={() => setDrag(null)}
                  onDoubleClick={e => { e.stopPropagation(); onMutate(f => { delete ct(f).header_height; }); }}
                  style={{ position: 'absolute', bottom: -3, left: 0, width: '100%', height: 7, cursor: 'row-resize', zIndex: 2 }} />}
              </th>
            {columns.map(c => (
              <th key={c.id} className={!showHeader ? 'report-table-coordinate' : undefined} onContextMenu={() => { setEditingCell(null); setRangeEnd(null); setSel({ rowId: '', colId: c.id, header: true }); }} style={{ position: 'relative', border: '1px solid #b8bec8', padding: '4px 5px', background: sel?.header && sel.colId === c.id ? '#f1f6fc' : undefined, boxShadow: sel?.header && sel.colId === c.id ? 'inset 0 0 0 1px #4b85c5' : undefined, minWidth: 70 }}>
                <ReportCellTextArea size="small" variant="borderless" value={showHeader ? c.label : reportColumnLetter(columns.indexOf(c))} placeholder="列名" readOnly={!showHeader}
                  onFocus={() => { setRangeEnd(null); setSel({ rowId: '', colId: c.id, header: true }); }}
                  style={{ fontSize: c.style?.size || tableStyle?.header_font_size || tableStyle?.font_size || 'inherit', fontFamily: c.style?.font || tableStyle?.header_font || tableStyle?.font,
                    color: c.style?.color ?? tableStyle?.color, fontStyle: (c.style?.italic ?? tableStyle?.italic) ? 'italic' : undefined,
                    lineHeight: reportLineHeightCSS(c.style?.line_height),
                    fontWeight: c.style?.weight ? c.style.weight === 'bold' ? 700 : 400 : tableStyle?.header_bold === false ? 400 : 700, textAlign: c.style?.align || 'center', padding: '0 2px' }}
                  onChange={(e) => setColLabel(c.id, e.target.value)} />
                {/* 列右缘：拖拽改列宽(fr)，双击恢复自动 */}
                <div title="拖拽调整列宽，双击恢复自动"
                  onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag({ kind: 'col', id: c.id, start: e.clientX, startVal: (e.currentTarget.parentElement as HTMLElement).offsetWidth / 37.795, scale: (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().width / (e.currentTarget.parentElement as HTMLElement).offsetWidth || 1 }); }}
                  onPointerMove={(e) => { if (drag?.kind !== 'col' || drag.id !== c.id) return; const cm = Math.max(0.2, Math.round((drag.startVal + (e.clientX - drag.start) / drag.scale / 37.795) * 100) / 100); setColWidth(c.id, `${cm}cm`); }}
                  onPointerUp={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); setDrag(null); }} onPointerCancel={() => setDrag(null)}
                  onDoubleClick={(e) => { e.stopPropagation(); setColWidth(c.id, undefined); }}
                  style={{ position: 'absolute', top: 0, right: -3, width: 7, height: '100%', cursor: 'col-resize', zIndex: 2 }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r.id} style={{ height: r.height }}>
              <td className="report-table-coordinate" style={{ position: 'relative', width: 30, textAlign: 'center', border: '1px solid #eee', background: '#fafafa', color: '#999' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ fontSize: 10 }}>{ri + 1}</span>
                </div>
                {/* 行下缘：拖拽改行高(cm)，双击恢复自动 */}
                <div title="拖拽调整行高，双击恢复自动"
                  onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag({ kind: 'row', id: r.id, start: e.clientY, startVal: (e.currentTarget.closest('tr') as HTMLElement).offsetHeight / 37.795, scale: (e.currentTarget.closest('tr') as HTMLElement).getBoundingClientRect().height / (e.currentTarget.closest('tr') as HTMLElement).offsetHeight || 1 }); }}
                  onPointerMove={(e) => { if (drag?.kind !== 'row' || drag.id !== r.id) return; const cm = Math.max(0, Math.round((drag.startVal + (e.clientY - drag.start) / drag.scale / 37.795) * 10) / 10); setRowHeight(r.id, cm ? `${cm}cm` : undefined); }}
                  onPointerUp={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); setDrag(null); }}
                  onDoubleClick={(e) => { e.stopPropagation(); setRowHeight(r.id, undefined); }}
                  style={{ position: 'absolute', left: 0, bottom: -3, width: '100%', height: 7, cursor: 'row-resize', zIndex: 2 }} />
              </td>
              {columns.map((c, ci) => {
                if (covered.has(`${r.id}|${c.id}`)) return null;   // 被合并主格盖住：不出格
                const s = spanOf(r.id, c.id);
                const cs = Math.min(Math.max(s.colspan ?? 1, 1), columns.length - ci);
                const rs = Math.min(Math.max(s.rowspan ?? 1, 1), rows.length - (rowIndex.get(r.id) ?? 0));
                const selected = !!sel && !sel.header && (hasRange ? ri >= top && ri <= bottom && ci >= left && ci <= right : sel.rowId === r.id && sel.colId === c.id);
                const cellStyle = cellStyles?.[`${r.id}::${c.id}`];
                const isHeader = !showHeader && headerCells?.[`${r.id}::${c.id}`];
                return (
                  <td key={c.id} colSpan={cs} rowSpan={rs} onClick={() => { if (!hasRange) setSel({ rowId: r.id, colId: c.id }); }}
                    onContextMenu={() => { setEditingCell(null); selectingCells.current = false; if (!selected) { setSel({ rowId: r.id, colId: c.id }); setRangeEnd(null); } }}
                    onMouseDown={event => {
                      if (event.button !== 0) return;
                      selectingCells.current = true;
                      if (event.shiftKey && sel && !sel.header) { event.preventDefault(); setRangeEnd({ rowId: r.id, colId: c.id }); }
                      else { if (editingCell !== `${r.id}::${c.id}`) setEditingCell(null); setSel({ rowId: r.id, colId: c.id }); setRangeEnd(null); }
                    }}
                    onMouseEnter={event => { if (selectingCells.current && event.buttons === 1) { setEditingCell(null); setRangeEnd({ rowId: r.id, colId: c.id }); } }}
                    onFocus={() => { if (!selectingCells.current) { setRangeEnd(null); setSel({ rowId: r.id, colId: c.id }); } }}
                    onDoubleClick={() => { setRangeEnd(null); setEditingCell(`${r.id}::${c.id}`); }}
                    onPaste={(e) => pasteCells(e, hasRange ? top : ri, hasRange ? left : ci)}
                    style={{ border: '1px solid #b8bec8', boxShadow: selected ? 'inset 0 0 0 1px #4b85c5' : undefined, padding: '4px 5px', background: selected ? '#f1f6fc' : undefined, cursor: 'text' }}>
                    <ReportCellTextArea size="small" variant="borderless" value={cells[`${r.id}::${c.id}`] ?? ''}
                      readOnly={editingCell !== `${r.id}::${c.id}`}
                      onBlur={() => setEditingCell(null)}
                      style={{ fontSize: cellStyle?.size || (isHeader ? tableStyle?.header_font_size : tableStyle?.body_font_size) || tableStyle?.font_size || 'inherit',
                        fontFamily: cellStyle?.font || (isHeader ? tableStyle?.header_font : tableStyle?.body_font) || tableStyle?.font,
                        fontWeight: boldAt(`${r.id}::${c.id}`) ? 700 : 400, fontStyle: (cellStyle?.italic ?? tableStyle?.italic) ? 'italic' : undefined, color: cellStyle?.color ?? tableStyle?.color,
                        lineHeight: reportLineHeightCSS(cellStyle?.line_height),
                        textAlign: cellStyle?.align || tableStyle?.cell_align || 'center', padding: '0 2px' }}
                      onChange={(e) => setCell(r.id, c.id, e.target.value)} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      </div></Dropdown>
    </div>
  );
}

// 统一「自由编辑表格」块：三类报告表（结论/结果/设备）共用——纯文本网格 + 「恢复自动」，UI 完全一致。
function FreeTableBlock({ title, field, onMutate, onRestore }: {
  title: string; field: FieldDefinition; onMutate: (fn: (f: FieldDefinition) => void) => void; onRestore?: () => void;
}) {
  const ft = field.free_table || { columns: [], rows: [], cells: {} };
  return (
    <EditorBlock title={title} accent="#722ed1" tag={<Tag color="purple">自由编辑</Tag>}
      extra={(onRestore || field.type !== 'report_result_table' || field.result_table) && <ReportFigureTools><Tooltip title="放弃逐格文本，恢复解锁前的自动生成或原始记录映射结构">
        <Button size="small" onClick={() => Modal.confirm({ title: '恢复自动表格？', content: '当前表格的手工修改将被替换，其他图表和正文不受影响。', okText: '恢复自动', cancelText: '取消',
          onOk: () => onRestore ? onRestore() : onMutate(f => { f.free_table = undefined; }) })}>恢复自动</Button></Tooltip></ReportFigureTools>}>
      <FreeGridEditor columns={ft.columns || []} rows={ft.rows || []} cells={ft.cells || {}} spans={ft.spans} headerHeight={ft.header_height} onMutate={onMutate} />
    </EditorBlock>
  );
}

// 「自由编辑表格」按钮：把当前表格内容（含表头/汇总行/设备行）快照成纯文本网格，逐格可改。
function EnterFreeButton({ field, ctx, onMutate }: {
  field: FieldDefinition; ctx: any; onMutate: (fn: (f: FieldDefinition) => void) => void;
}) {
  return (
    <Tooltip title="自由编辑：把当前表格内容（含表头 / 汇总行）转成纯文本网格——每格可改、可任意增删行列、拖拽调列宽行高">
      <Button size="small" onClick={() => onMutate(f => {
        if (f.type === 'free_grid' && f.free_table) {
          // 保存自动映射结构，当前实例改为“实际渲染值快照”；恢复时可无损还原。
          f.instance_auto_free_table = JSON.parse(JSON.stringify(f.free_table));
        }
        f.free_table = buildFreeTableFromField(field, ctx);
      })}>自由编辑表格</Button>
    </Tooltip>
  );
}

// 只读网格预览（与 FreeGridEditor 同款合并渲染，但不可编辑）——所有表 auto 模式共用，
// 由 buildFreeTableFromField 出同一份网格，保证【自动/自由显示一致、且与报告一致】。
function ReadonlyGrid({ columns, rows, cells, spans, showHeader = true }: {
  columns: Array<{ id: string; label: string; width?: string }>;
  rows: Array<{ id: string; height?: string }>;
  cells: Record<string, string>;
  spans?: Record<string, { colspan?: number; rowspan?: number }>;
  showHeader?: boolean;
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
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'inherit', tableLayout: 'fixed' }}>
        {showHeader && <thead><tr>{columns.map(c => (
          <th key={c.id} style={{ border: '1px solid #b8bec8', padding: '4px 5px', fontWeight: 700, textAlign: 'center' }}>{c.label || ''}</th>
        ))}</tr></thead>}
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
                    style={{ border: '1px solid #b8bec8', padding: '4px 5px', textAlign: 'center', verticalAlign: 'middle', whiteSpace: 'pre-wrap' }}>
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
    <EditorBlock title={title} accent={accent} tag={tag} extra={<ReportFigureTools><EnterFreeButton field={field} ctx={ctx} onMutate={onMutate} /></ReportFigureTools>}>
      {notice}
      <ReadonlyGrid columns={ft.columns} rows={ft.rows} cells={ft.cells} spans={ft.spans} showHeader={field.type !== 'free_grid'} />
    </EditorBlock>
  );
}

// 设备信息表：只读预览 + 「自由编辑表格」。
function EquipmentTableEditor({ field, ctx, onMutate }: {
  field: FieldDefinition; ctx: any; onMutate: (fn: (f: FieldDefinition) => void) => void;
}) {
  return <AutoTableBlock title={field.label || '设备信息'} accent="#13c2c2" tag={<Tag color="cyan">设备表</Tag>} field={field} ctx={ctx} onMutate={onMutate} />;
}

// 检测结论表：只读预览（按本报告项目自动展开）+ 「自由编辑表格」。
function ConclusionTableEditor({ field, ctx, onMutate }: {
  field: FieldDefinition; ctx: any; onMutate: (fn: (f: FieldDefinition) => void) => void;
}) {
  return <AutoTableBlock title={field.label || '检测结论'} accent="#52c41a" tag={<Tag color="blue">自动</Tag>} field={field} ctx={ctx} onMutate={onMutate} />;
}
