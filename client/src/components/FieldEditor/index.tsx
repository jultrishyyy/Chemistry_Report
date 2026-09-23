import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { defaultBasicPublicField } from '../../../../shared/record-field-transfer';
import { judgmentChoiceDefaults } from '../../../../shared/conclusion-judgment-default';
import { compactConclusionChildren, conclusionDisplayField } from '../../../../shared/conclusion-table-layout';
import ConclusionItemsTable from '../ConclusionItemsTable';
import { Alert, Button, Card, Drawer, Dropdown, InputNumber, message, Modal, Segmented, Space, Tag, Tooltip, Select } from 'antd';
import ReadOnlyEditorContent from './ReadOnlyEditorContent';
import {
  AppstoreAddOutlined, ArrowDownOutlined, ArrowUpOutlined, CloseOutlined, DeleteOutlined, DownOutlined,
  ExportOutlined, EyeInvisibleOutlined, EyeOutlined, FontColorsOutlined, FunctionOutlined, HolderOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, PlusOutlined, RightOutlined, TableOutlined, VerticalAlignTopOutlined,
} from '@ant-design/icons';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import type { FieldGroup, FieldDefinition, RecordTemplate } from '../../../../shared/types';
import { expandMatrixFieldCodes, uniqueCode } from '../../../../shared/matrix-flatten';
import { buildGroupTree, isSubgroup } from '../../../../shared/group-tree';
import {
  FIELD_CATEGORIES,
  categoriesForGroup,
  categoryOfField,
  createFieldForCategory,
  editorCapabilities,
  getCategoryLabel,
  type FieldCategory,
} from './field-types';
import { SECTION_PRESETS, sectionPresetsForEditor, isSignatureGroup } from './section-presets';
import FormulaEditor from '../FormulaEditor';
import FieldPropsPanel from './FieldPropsPanel';
import DocumentStylePanel from './DocumentStylePanel';
import AutoGrowTextArea from '../AutoGrowTextArea';
import TitleStylePanel from './TitleStylePanel';
import FormatPanel from './FormatPanel';
import ImageSectionPanel from './ImageSectionPanel';
import ImageSectionNotes from './ImageSectionNotes';
import ClosablePopover from '../ClosablePopover';
import { FORMULA_TYPES } from '../../../../shared/formula-engine';
import { cloneTemplateField } from '../../../../shared/clone-template-field';
import { signaturePosition, SIGNATURE_POSITION_OPTIONS } from '../../../../shared/signature-position';
import { scrollWithin } from '../../utils/scrollWithin';
import { canArrangeRecordGroup } from '../../../../shared/record-layout';

// In-app clipboard survives route changes, but is not persisted with template data.
let fieldClipboard: { field: FieldDefinition; mode: EditorMode; templateId?: number; templateName: string } | null = null;

export type EditorMode = 'record' | 'report-cover' | 'report-project';

interface FieldEditorProps {
  template: RecordTemplate;
  onChange: (template: RecordTemplate) => void;
  /** 'record' (默认) / 'report-cover' / 'report-project' */
  editorMode?: EditorMode;
  /** project 模式下关联的原始记录模板（供 BindingEditor 使用） */
  linkedRecord?: RecordTemplate | null;
  /** 选中/点击字段时回调（code, groupId）——编辑器 ⇄ PDF 正向跳转用；code 为空 = 仅分区 */
  onFieldFocus?: (code: string, groupId: string, field?: FieldDefinition) => void;
  /** 字段属性卡关闭/取消选中时，通知 PDF 清除持续定位标记。 */
  onFieldBlur?: () => void;
  /** 外部请求选中（PDF Ctrl+点击反向跳转）：kind=field 按 code 选字段，kind=group 滚到分区 */
  selectRequest?: { kind: 'field' | 'group'; code: string; token: number } | null;
  fieldIssues?: Record<string, string[]>;
  /** 文档未取得编辑权时为 true：仍可浏览结构和属性，但禁止产生误导性的新增/修改操作。 */
  readOnly?: boolean;
}

// 「排版」选择器（竖排/多列/表格）已按需求移除；存量 grid/table 分区仍按存储值渲染（渲染路径保留），编辑器不再提供切换。
/** 分区是否"纯字段分区"（排版方式才有意义）。数据矩阵/图片/签名分区内容已定型，排版自动。 */
function sectionLayoutInfo(group: FieldGroup): { layoutable: boolean; note: string } {
  if (group.section_role === 'images') return { layoutable: false, note: '图片分区 · 排版自动' };
  const hasMatrix = group.fields.some(f => f.type === 'data_matrix');
  const hasSign = group.fields.some(f => f.signature_line);
  const freeFields = group.fields.filter(f => !['data_matrix', 'spacer', 'image'].includes(f.type) && !f.signature_line);
  if (freeFields.length === 0) {
    if (hasMatrix) return { layoutable: false, note: '数据表格 · 排版自动' };
    if (hasSign) return { layoutable: false, note: '签名栏 · 排版自动' };
    return { layoutable: false, note: '排版自动' };
  }
  return { layoutable: true, note: '' };
}

/** react-dnd 拖拽类型 */
const DND_FIELD = 'fe-field';
const DND_GROUP = 'fe-group';
const BRAND = '#1366d9';

function formulaTypeLabel(t: string) {
  return FORMULA_TYPES.find(f => f.type === t)?.label ?? t;
}

/** 整个编辑器包一层 DndProvider（每个页面只挂一个 FieldEditor，不会出现双 backend）。 */
export default function FieldEditor(props: FieldEditorProps) {
  // 弹层和异步确认可能持有旧回调，写入时始终检查最新编辑权限。
  const latestProps = useRef(props);
  latestProps.current = props;
  return (
    <DndProvider backend={HTML5Backend}>
      <FieldEditorInner {...props} onChange={next => {
        if (latestProps.current.readOnly) return;
        latestProps.current.onChange(next);
      }} />
    </DndProvider>
  );
}

function FieldEditorInner({ template, onChange, editorMode = 'record', linkedRecord = null, onFieldFocus, onFieldBlur, selectRequest, fieldIssues = {}, readOnly = false }: FieldEditorProps) {
  // 选中字段（打开属性面板）/ 公式编辑目标 —— 用 field.id 引用，拖拽重排后不会指错
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const chooseCoverField = (id: string) => {
    setSelectedId(id);
    const group = template.groups.find(group => group.fields.some(field => field.id === id));
    const field = group?.fields.find(field => field.id === id);
    if (field && group) onFieldFocus?.(field.code, group.id, field);
  };
  const [formulaId, setFormulaId] = useState<string | null>(null);
  const [, refreshClipboard] = useState(0);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [outlineOpen, setOutlineOpen] = useState<boolean>(() => localStorage.getItem('feOutlineOpen') !== '0');
  const mainRef = useRef<HTMLDivElement | null>(null);
  // 属性卡片通过 body 浮层显示，但用编辑区边界约束位置：可越过左栏向右拉伸，同时不遮页面顶栏。
  const editorRootRef = useRef<HTMLDivElement | null>(null);

  // 字段属性 / 公式弹窗宽度（拖左缘调整，持久化到 localStorage）
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem('fieldPanelWidth'));
    return v >= 380 && v <= 1100 ? v : 640;
  });
  const updatePanelWidth = (w: number) => {
    const boundary = editorRootRef.current?.closest('[data-editor-split-root="true"]') as HTMLElement | null;
    const left = boundary?.getBoundingClientRect().left ?? editorRootRef.current?.getBoundingClientRect().left ?? 0;
    const available = Math.max(320, window.innerWidth - left - 12);
    const clamped = Math.min(Math.max(Math.round(w), Math.min(380, available)), Math.min(1100, available));
    setPanelWidth(clamped);
    localStorage.setItem('fieldPanelWidth', String(clamped));
  };

  const toggleOutline = (open: boolean) => {
    setOutlineOpen(open);
    localStorage.setItem('feOutlineOpen', open ? '1' : '0');
  };

  // id 生成：扫描现有 id 避免与已加载模板冲突（旧实现从 f100 盲数，会撞已有 id）
  const idCounterRef = useRef(99);
  const genId = () => {
    const used = new Set<string>();
    for (const g of template.groups) {
      used.add(g.id);
      for (const f of g.fields) used.add(f.id);
    }
    let candidate: string;
    do { candidate = `f${++idCounterRef.current}`; } while (used.has(candidate));
    return candidate;
  };

  /** 按 field.id 定位（拖拽/增删后索引会漂，id 不会） */
  const locate = (fieldId: string | null): { g: number; f: number } | null => {
    if (!fieldId) return null;
    for (let g = 0; g < template.groups.length; g++) {
      const f = template.groups[g].fields.findIndex(x => x.id === fieldId);
      if (f >= 0) return { g, f };
    }
    return null;
  };

  const updateGroups = (groups: FieldGroup[]) => {
    onChange({ ...template, groups });
  };
  const clearSelectedField = () => {
    const close = () => { setSelectedId(null); onFieldBlur?.(); };
    if (document.querySelector('.free-grid-formula-host [data-formula-dirty="true"]')) {
      Modal.confirm({ title: '公式修改尚未应用', content: '关闭字段属性会放弃当前公式草稿。其他已保存的设置不受影响。', okText: '放弃并关闭', cancelText: '继续编辑', zIndex: 1200, onOk: close });
    } else close();
  };

  /** 模板内已用字段 code（编码系统自动生成、防撞，用户不可见不可改） */
  const usedFieldCodes = () => new Set(template.groups.flatMap(g => g.fields.map(f => f.code)));

  const copyField = (field: FieldDefinition) => {
    fieldClipboard = { field: JSON.parse(JSON.stringify(field)), mode: editorMode, templateId: template.id, templateName: template.name };
    refreshClipboard(n => n + 1);
    message.success('字段已复制，可右键或使用快捷键粘贴');
  };
  const pasteField = (groupId: string, afterId?: string) => {
    if (readOnly) { message.info('请先点击“开始编辑”'); return; }
    const clipboard = fieldClipboard;
    if (!clipboard) { message.info('请先右键复制一个字段'); return; }
    const group = template.groups.find(g => g.id === groupId);
    if (!group || isSignatureGroup(group)) return;
    if (clipboard.mode !== editorMode) { message.warning('请在同类型模板之间复制粘贴，避免录入配置与报告映射混用'); return; }
    if (clipboard.field.conclusion_role || clipboard.field.signature_line) {
      message.warning('结论专用字段和签字字段请通过对应分区添加，不能重复粘贴'); return;
    }
    if (!categoriesForGroup(editorMode, group.section_role).some(c => c.key === categoryOfField(clipboard.field))) {
      message.warning('该字段不适用于此分区，请选择兼容的分区'); return;
    }
    const insert = () => {
      const copy = cloneTemplateField(clipboard.field, template);
      const index = afterId ? group.fields.findIndex(f => f.id === afterId) + 1 : group.fields.length;
      const fields = [...group.fields]; fields.splice(index, 0, copy);
      updateGroups(template.groups.map(g => g.id === groupId ? { ...g, fields } : g));
      message.success('已粘贴字段');
    };
    if (clipboard.templateId !== template.id || clipboard.templateName !== template.name) {
      Modal.confirm({ title: '粘贴到另一份模板？', content: '字段内容与配置将保留。引用其他字段的公式、图片来源和报告映射仍指向原配置，请在粘贴后核对；系统不会自动改绑。', okText: '粘贴并核对', cancelText: '取消', onOk: insert });
    } else insert();
  };

  const handleFieldClipboardKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.repeat || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key !== 'c' && key !== 'v') return;
    const target = event.target as HTMLElement;
    // Never steal text, cell/range clipboard operations or modal keyboard input.
    if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], table, .ant-modal, .ant-select') || window.getSelection()?.toString()) return;
    const fieldId = target.closest<HTMLElement>('[data-field-clipboard]')?.dataset.fieldClipboard;
    const groupId = target.closest<HTMLElement>('[data-field-paste-group]')?.dataset.fieldPasteGroup;
    const location = locate(fieldId || (groupId ? null : selectedId));
    if (!location && !groupId) return;
    const group = location ? template.groups[location.g] : template.groups.find(g => g.id === groupId);
    if (!group || isSignatureGroup(group)) return;
    const field = location ? group.fields[location.f] : undefined;
    if (key === 'c' && !field) return;
    if (key === 'v' && (!fieldClipboard || readOnly)) return;
    event.preventDefault(); event.stopPropagation();
    if (key === 'c') copyField(field!); else pasteField(group.id, field?.id);
  };

  const addGroupFromPreset = (presetKey: string) => {
    if (readOnly) { message.info('当前为只读查看，请先点击页面右上角“开始编辑”'); return; }
    if (presetKey === 'cover_report_ending' && template.groups.some(group => group.section_role === 'report_ending')) {
      message.warning('一份首页模板只能配置一个报告结束区，请编辑现有分区');
      return;
    }
    if (presetKey === 'conclusion' && template.groups.some(group =>
      group.section_role === 'conclusion' && !group.parent_group_id
      && (group.conclusion_kind === 'project' || group.fields.some(field => field.conclusion_role === 'project_name' || field.type === 'record_conclusion')))) {
      message.warning('一份原始记录模板只能配置一个结论模块；请在现有结论模块中添加子项目');
      return;
    }
    const preset = SECTION_PRESETS.find(p => p.key === presetKey);
    if (!preset) return;
    const newGroup = preset.build(genId);
    if (editorMode === 'record') newGroup.fields = newGroup.fields.map(field => defaultBasicPublicField(field, newGroup));
    // 项目模板手动添加“图片记录”时，直接按关联原始记录的首个图片分区建立来源，
    // 避免出现三个空图位还要逐一绑定的旧操作。数据期仍按动态集合整体拉取。
    if (editorMode === 'report-project' && presetKey === 'proj_images' && linkedRecord) {
      const sourceGroup = linkedRecord.groups.find(group =>
        group.section_role === 'images' && group.fields.some(field => field.type === 'image'));
      const sourceFields = sourceGroup?.fields.filter(field => field.type === 'image') || [];
      if (sourceGroup && sourceFields.length) {
        newGroup.label = sourceGroup.label;
        newGroup.image_layout = sourceGroup.image_layout
          ? JSON.parse(JSON.stringify(sourceGroup.image_layout))
          : { cols: 2, title_mode: 'per', solo: 'first', width_cm: 7, height_cm: 6 };
        if (newGroup.image_layout) delete newGroup.image_layout.caption;
        newGroup.fields = sourceFields.map(source => {
          const field: FieldDefinition = JSON.parse(JSON.stringify(source));
          field.id = genId();
          field.code = `img_${source.code}`;
          field.image_source_code = source.code;
          delete field.image_photos;
          delete field.image_items;
          delete field.caption;
          return field;
        });
      }
    }
    // 同一预设可重复添加（如两个数据表分区）——逐字段防撞改 code
    const used = usedFieldCodes();
    newGroup.fields = newGroup.fields.map(f => {
      const code = uniqueCode(f.code, used);
      used.add(code);
      return code === f.code ? f : { ...f, code };
    });
    updateGroups([...template.groups, newGroup]);
  };

  const removeGroup = (idx: number) => {
    const g = template.groups[idx];
    const childCount = template.groups.filter(x => x.parent_group_id === g.id).length;
    const doRemove = () =>
      updateGroups(template.groups.filter((x, i) => i !== idx && x.parent_group_id !== g.id));
    if (childCount > 0) {
      Modal.confirm({
        title: `删除分区「${g.label || '未命名'}」？`,
        content: `其下 ${childCount} 个子分区（及其中字段）将一并删除。`,
        okText: '删除', okButtonProps: { danger: true }, cancelText: '取消',
        onOk: doRemove,
      });
    } else {
      doRemove();
    }
  };

  const updateGroup = (idx: number, patch: Partial<FieldGroup>) => {
    const groups = [...template.groups];
    groups[idx] = { ...groups[idx], ...patch };
    updateGroups(groups);
  };

  const addField = (groupIdx: number, cat: FieldCategory) => {
    if (readOnly) { message.info('当前为只读查看，请先点击页面右上角“开始编辑”'); return; }
    const groups = [...template.groups];
    const createdField = createFieldForCategory(cat, genId());
    const field = editorMode === 'record' ? defaultBasicPublicField(createdField, groups[groupIdx]) : createdField;
    if (cat === 'image' && editorMode === 'report-project' && linkedRecord) {
      const sources = linkedRecord.groups.flatMap(group => group.fields).filter(candidate => candidate.type === 'image');
      const usedSources = new Set(groups[groupIdx].fields.map(candidate => candidate.image_source_code).filter(Boolean));
      const source = sources.find(candidate => !usedSources.has(candidate.code)) || sources[0];
      if (source) {
        field.label = source.label;
        field.image_source_code = source.code;
      }
    }
    field.code = uniqueCode(field.code, usedFieldCodes());
    groups[groupIdx] = { ...groups[groupIdx], fields: [...groups[groupIdx].fields, field] };
    updateGroups(groups);
    setSelectedId(field.id);
  };

  /** 结论模块专用：每个子项目包含四个可独立编辑的普通字段。 */
  const addConclusionItem = (parent: FieldGroup) => {
    if (readOnly) { message.info('当前为只读查看，请先点击页面右上角“开始编辑”'); return; }
    const seq = template.groups.filter(group => group.parent_group_id === parent.id && group.conclusion_kind === 'item').length + 1;
    const used = usedFieldCodes();
    const withCode = (field: FieldDefinition) => {
      field.code = uniqueCode(field.code, used);
      used.add(field.code);
      return field;
    };
    const child: FieldGroup = {
      id: genId(),
      label: `子项目 ${seq}`,
      layout: 'vertical',
      section_role: 'conclusion',
      conclusion_kind: 'item',
      parent_group_id: parent.id,
      fields: [
        withCode({ id: genId(), code: `conclusion_item_${seq}_name`, label: '名称', type: 'text', required: true, conclusion_role: 'item_name' }),
        withCode({ id: genId(), code: `conclusion_item_${seq}_judgment`, label: '判定要求', ...judgmentChoiceDefaults, required: true, conclusion_role: 'judgment_requirement' }),
        withCode({ id: genId(), code: `conclusion_item_${seq}_limit`, label: '限值', type: 'text', conclusion_role: 'limit' }),
        withCode({ id: genId(), code: `conclusion_item_${seq}_result`, label: '结论', type: 'select', required: true,
          options: ['符合', '不符合'], allow_custom: true, conclusion_role: 'conclusion' }),
      ],
    };
    updateGroups([...template.groups, child]);
  };

  const addConclusionRoleField = (groupIdx: number, role: 'judgment_requirement' | 'limit' | 'conclusion') => {
    const groups = [...template.groups];
    const group = groups[groupIdx];
    if (!group || group.fields.some(field => field.conclusion_role === role)) return;
    const isChild = group.conclusion_kind === 'item' || !!group.parent_group_id;
    const hasChildren = template.groups.some(candidate => candidate.parent_group_id === group.id && candidate.conclusion_kind === 'item');
    const required = isChild || !hasChildren;
    const field: FieldDefinition = role === 'limit'
      ? { id: genId(), code: 'conclusion_limit', label: '限值', type: 'text', conclusion_role: role }
      : role === 'judgment_requirement'
      ? { id: genId(), code: 'conclusion_judgment', label: '判定要求', ...judgmentChoiceDefaults, required, conclusion_role: role }
      : { id: genId(), code: 'conclusion_result', label: isChild ? '结论' : '总结论', type: 'select', required,
          options: ['符合', '不符合'], allow_custom: true, conclusion_role: role };
    field.code = uniqueCode(field.code, usedFieldCodes());
    const fields = [...group.fields];
    const resultIndex = fields.findIndex(candidate => candidate.conclusion_role === 'conclusion');
    fields.splice(role === 'limit' && resultIndex >= 0 ? resultIndex : fields.length, 0, field);
    groups[groupIdx] = { ...group, fields };
    updateGroups(groups);
    setSelectedId(field.id);
  };

  const removeField = (groupIdx: number, fieldIdx: number) => {
    const target = template.groups[groupIdx]?.fields[fieldIdx];
    if (target?.conclusion_role === 'project_name' || target?.conclusion_role === 'item_name') {
      message.warning(`${target.label || '名称'}是结论模块的必要字段，不能删除`);
      return;
    }
    if (target) {
      if (selectedId === target.id) clearSelectedField();
      if (formulaId === target.id) setFormulaId(null);
    }
    const groups = [...template.groups];
    groups[groupIdx] = { ...groups[groupIdx], fields: groups[groupIdx].fields.filter((_, i) => i !== fieldIdx) };
    updateGroups(groups);
  };

  const updateField = (groupIdx: number, fieldIdx: number, patch: Partial<FieldDefinition>) => {
    const groups = [...template.groups];
    const fields = [...groups[groupIdx].fields];
    fields[fieldIdx] = { ...fields[fieldIdx], ...patch };
    groups[groupIdx] = { ...groups[groupIdx], fields };
    updateGroups(groups);
  };

  const replaceField = (groupIdx: number, fieldIdx: number, next: FieldDefinition) => {
    const groups = [...template.groups];
    const fields = [...groups[groupIdx].fields];
    fields[fieldIdx] = next;
    groups[groupIdx] = { ...groups[groupIdx], fields };
    updateGroups(groups);
  };

  const moveField = (groupIdx: number, fieldIdx: number, direction: -1 | 1) => {
    const groups = [...template.groups];
    const fields = [...groups[groupIdx].fields];
    const newIdx = fieldIdx + direction;
    if (newIdx < 0 || newIdx >= fields.length) return;
    [fields[fieldIdx], fields[newIdx]] = [fields[newIdx], fields[fieldIdx]];
    groups[groupIdx] = { ...groups[groupIdx], fields };
    updateGroups(groups);
  };

  /** 上下移分区：只在同层（顶级之间 / 同父子分区之间）相邻交换 */
  const moveGroup = (groupIdx: number, direction: -1 | 1) => {
    const groups = [...template.groups];
    const me = groups[groupIdx];
    const myParent = isSubgroup(me, groups) ? me.parent_group_id : undefined;
    const siblingIdxs = groups
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => (isSubgroup(g, groups) ? g.parent_group_id : undefined) === myParent)
      .map(({ i }) => i);
    const pos = siblingIdxs.indexOf(groupIdx);
    const targetIdx = siblingIdxs[pos + direction];
    if (targetIdx === undefined) return;
    [groups[groupIdx], groups[targetIdx]] = [groups[targetIdx], groups[groupIdx]];
    updateGroups(groups);
  };

  /** 拖拽落点：把 fieldId 移到 toGroup 的 insertIdx 之前（支持跨分区） */
  const dropFieldTo = (fieldId: string, toGroup: number, insertIdx: number) => {
    const groups = template.groups.map(g => ({ ...g, fields: [...g.fields] }));
    let fromG = -1, fromF = -1;
    groups.forEach((g, gi) => {
      const fi = g.fields.findIndex(f => f.id === fieldId);
      if (fi >= 0) { fromG = gi; fromF = fi; }
    });
    if (fromG < 0) return;
    const [fld] = groups[fromG].fields.splice(fromF, 1);
    if (fld.conclusion_role && fromG !== toGroup) {
      message.warning('结论模块的名称、判定要求、限值和结论字段不能移动到其他分区');
      return;
    }
    let ins = insertIdx;
    if (fromG === toGroup && fromF < insertIdx) ins -= 1;
    ins = Math.max(0, Math.min(ins, groups[toGroup].fields.length));
    groups[toGroup].fields.splice(ins, 0, fld);
    updateGroups(groups);
  };

  /** 拖拽落点：把分组移到 insertIdx 之前 */
  const dropGroupTo = (groupId: string, insertIdx: number) => {
    const fromIdx = template.groups.findIndex(g => g.id === groupId);
    if (fromIdx < 0) return;
    const groups = [...template.groups];
    const [g] = groups.splice(fromIdx, 1);
    let ins = insertIdx;
    if (fromIdx < insertIdx) ins -= 1;
    ins = Math.max(0, Math.min(ins, groups.length));
    groups.splice(ins, 0, g);
    updateGroups(groups);
  };

  /** 大纲点击：滚动定位到分组 / 字段 */
  const scrollToNode = (id: string) => {
    const container = mainRef.current;
    const el = container?.querySelector(`[data-fe-node="${CSS.escape(id)}"]`);
    if (!container || !el) return;
    // scrollIntoView also scrolls overflow:hidden ancestors, hiding the page toolbar.
    scrollWithin(container, el);
  };

  /** PDF Ctrl+点击反向跳转：按 code 选中字段 / 滚到分区 */
  useEffect(() => {
    if (!selectRequest) return;
    if (selectRequest.kind === 'field') {
      const field = template.groups.flatMap(g => g.fields).find(f => f.code === selectRequest.code);
      if (field) {
        setSelectedId(field.id);
        scrollToNode(field.id);
      }
    } else {
      const group = template.groups.find(g => g.id === selectRequest.code);
      if (group) scrollToNode(group.id);
    }
    // 只在 token 变化时响应（同一标记重复点击也生效）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectRequest?.token]);

  const selLoc = locate(selectedId);
  const currentField = selLoc ? template.groups[selLoc.g].fields[selLoc.f] : null;
  const formulaLoc = locate(formulaId);
  const formulaField = formulaLoc ? template.groups[formulaLoc.g].fields[formulaLoc.f] : null;

  // Drawer portal 到 body 后，以整个 EditorSplit 工作区作为浮层原点：项目模板的名称/结论卡位于工作区内，
  // 会被字段属性卡正确覆盖；页面最上方工具栏位于工作区外，始终保持可见。
  const splitRoot = editorRootRef.current?.closest('[data-editor-split-root="true"]') as HTMLElement | null;
  const editorRect = splitRoot?.getBoundingClientRect() || editorRootRef.current?.getBoundingClientRect();
  const overlayTop = Math.max(0, editorRect?.top || 0);
  const overlayLeft = Math.max(0, editorRect?.left || 0);
  const overlayWidth = Math.max(320, window.innerWidth - overlayLeft);
  const overlayHeight = Math.max(240, window.innerHeight - overlayTop);
  const visiblePanelWidth = Math.min(panelWidth, overlayWidth - 12);
  const drawerRootStyle: CSSProperties = {
    position: 'fixed', top: overlayTop, left: overlayLeft,
    width: overlayWidth, height: overlayHeight,
  };

  // 编辑器能力开关（集中映射，替代散落的 editorMode === 判断）
  const caps = editorCapabilities(editorMode);

  const allFields = template.groups.flatMap(g => g.fields);
  // 文档级「字段间距」(theme_config.line_gap)，透传给各分区「格式」面板作继承提示（GroupCard 无 template）。
  const docFieldGap = (() => {
    const lg = (template.layout_options?.theme_config as any)?.line_gap;
    return lg != null && lg !== '' ? (typeof lg === 'number' ? `${lg}em` : String(lg)) : '0.6em';
  })();
  // 文档级默认 字体/字号：透传给分区「格式」面板，未设本级时字体/字号框直接显示实际生效值（宋体/10pt 为主题内建默认）。
  const docFont = (template.layout_options?.theme_config as any)?.font || 'Songti SC';
  const docSize = typeof (template.layout_options?.theme_config as any)?.body_size === 'number'
    ? (template.layout_options?.theme_config as any).body_size : 10;
  const docFigureGapPt = (() => {
    const raw = docFieldGap.trim();
    if (raw.endsWith('em')) return Math.round((parseFloat(raw) || 0.6) * docSize * 10) / 10;
    if (raw.endsWith('pt')) return parseFloat(raw) || Math.round(0.6 * docSize * 10) / 10;
    return Math.round(0.6 * docSize * 10) / 10;
  })();
  const formulaSourceFields = allFields.flatMap(f => {
    if (f.type === 'computed') return [];
    if (f.type === 'data_matrix') return expandMatrixFieldCodes(f);
    return [{ code: f.code, label: f.label }];
  });

  const computedFieldOptions = useMemo(
    () =>
      template.groups
        .flatMap(g => g.fields)
        .filter(f => f.type === 'computed')
        .map(f => ({ code: f.code, label: f.label || '未命名图片字段' })),
    [template.groups]
  );

  return (
    <div ref={editorRootRef} onKeyDown={handleFieldClipboardKey} style={{ position: 'relative', display: 'flex', height: '100%', minHeight: 0 }}>
      {/* —— 大纲导航（可折叠）—— */}
      {outlineOpen ? (
        <div className="fe-outline" style={{ width: 190, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 6px 4px 12px' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#5a6478' }}>大纲</span>
            <Tooltip title="收起大纲">
              <Button type="text" size="small" icon={<MenuFoldOutlined />} onClick={() => toggleOutline(false)} />
            </Tooltip>
          </div>
          {buildGroupTree(template.groups).map(({ group: g, children }, gi) => (
            <div key={g.id}>
              <div className="fe-outline-item fe-outline-group" onClick={() => { scrollToNode(g.id); onFieldFocus?.('', g.id); }}>
                {gi + 1}. {g.label || '未命名分区'}
              </div>
              {g.fields.map(f => (
                <div
                  key={f.id}
                  className={`fe-outline-item ${f.id === selectedId ? 'fe-sel' : ''}`}
                  style={{ paddingLeft: 26 }}
                  onClick={() => { if (editorMode === 'report-cover') chooseCoverField(f.id); else { setSelectedId(f.id); onFieldFocus?.(f.code, g.id, f); } scrollToNode(f.id); }}
                >
                  {f.label || f.code}
                </div>
              ))}
              {children.map((c, ci) => (
                <div key={c.id}>
                  <div
                    className="fe-outline-item fe-outline-group fe-outline-group-nested"
                    style={{ paddingLeft: 22 }}
                    onClick={() => { scrollToNode(c.id); onFieldFocus?.('', c.id); }}
                  >
                    {gi + 1}.{ci + 1} {c.label || '未命名子分区'}
                  </div>
                  {c.fields.map(f => (
                    <div
                      key={f.id}
                      className={`fe-outline-item ${f.id === selectedId ? 'fe-sel' : ''}`}
                      style={{ paddingLeft: 38 }}
                      onClick={() => { if (editorMode === 'report-cover') chooseCoverField(f.id); else { setSelectedId(f.id); onFieldFocus?.(f.code, c.id, f); } scrollToNode(f.id); }}
                    >
                      {f.label || f.code}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ flex: 'none', width: 30, borderRight: '1px solid #eef0f4', paddingTop: 8, textAlign: 'center', background: '#fbfcfe' }}>
          <Tooltip title="展开大纲" placement="right">
            <Button type="text" size="small" icon={<MenuUnfoldOutlined />} onClick={() => toggleOutline(true)} />
          </Tooltip>
        </div>
      )}

      {/* —— 主列 —— */}
      <div ref={mainRef} style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: 12 }}>
        {readOnly && (
          <Alert type="info" showIcon style={{ marginBottom: 10 }}
            message="当前为只读查看"
            description="请先点击页面右上角“开始编辑”，再添加或修改内容。" />
        )}
        {/* —— 模板属性顶部条 —— */}
        <Card size="small" style={{ marginBottom: 12 }}>
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <div>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>模板名称（内部，用于检索）</div>
              <AutoGrowTextArea
                value={template.name}
                onChange={(e) => onChange({ ...template, name: e.target.value })}
                style={{ fontWeight: 'bold', fontSize: 16 }}
                placeholder="如：汽车内饰材料燃烧性试验原始记录"
              />
            </div>
          </Space>
        </Card>

        {/* —— 标题与副标题（文字 + 样式，原始记录）—— */}
        {caps.titlePanel && <TitleStylePanel template={template} onChange={onChange} />}

        {/* —— 文档样式 —— */}
        <DocumentStylePanel template={template} onChange={onChange} editorMode={editorMode} />

        {/* —— 分区列表（嵌套：子分区缩进在父分区下，存储平铺、渲染按 group-tree 分桶）—— */}
        {(() => {
          const groupTree = buildGroupTree(template.groups);
          const renderGroupCard = (
            group: FieldGroup,
            meta: { isSub: boolean; siblingPos: number; siblingCount: number; hasChildren: boolean }
          ) => {
            const gIdx = template.groups.findIndex(g => g.id === group.id);
            const locked = isSignatureGroup(group);   // 签发/签字栏分区：整段置灰只读，仅允许删除/在别处新增
            // family_inherited 仅是旧项目组方案留下的快照标记；项目组简化后不再锁定分区。
            const inherited = false;
            return (
              <GroupCard
                group={group}
                gIdx={gIdx}
                docFieldGap={docFieldGap}
                docFont={docFont}
                docSize={docSize}
                docFigureGapPt={docFigureGapPt}
                editorMode={editorMode}
                isSub={meta.isSub}
                siblingPos={meta.siblingPos}
                siblingCount={meta.siblingCount}
                locked={locked}
                readOnly={readOnly}
                inherited={inherited}
                collapsed={collapsedGroups.has(group.id)}
                onToggleCollapse={() => {
                  const next = new Set(collapsedGroups);
                  if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                  setCollapsedGroups(next);
                }}
                onUpdateGroup={(patch) => updateGroup(gIdx, patch)}
                onSetParent={(pid) => updateGroup(gIdx, { parent_group_id: pid })}
                onMoveGroup={(dir) => moveGroup(gIdx, dir)}
                onRemoveGroup={() => inherited ? message.info('继承分区不能在派生模板中删除，请修改项目组基础模板') : removeGroup(gIdx)}
                onDropGroup={dropGroupTo}
              >
                {locked || inherited ? (
                  // 签发分区：渲染与普通分区【完全一样】的字段行（排版/样式不变），整段置灰 + 屏蔽交互（不可点选/拖拽/增删/改属性）。
                  <div style={{ pointerEvents: 'none', opacity: 0.6, userSelect: 'none' }} aria-disabled>
                    {group.fields.map((field, fIdx) => (
                      <FieldRow
                        issues={fieldIssues[field.code]}
                        key={field.id}
                        field={conclusionDisplayField(field)}
                        inlineLabel={editorMode !== 'report-cover'}
                        groupIdx={gIdx}
                        fieldIdx={fIdx}
                        fieldCount={group.fields.length}
                        selected={false}
                        onSelect={() => {}}
                        onLabelChange={() => {}}
                        onOpenFormula={() => {}}
                        onMoveUp={() => {}}
                        onMoveDown={() => {}}
                        onRemove={() => {}}
                        onDropField={() => {}}
                      />
                    ))}
                  </div>
                ) : (
                  <>
                    {editorMode === 'report-project' && group.section_role === 'images' && <div style={{ padding: 12 }}>
                      <Select style={{ width: '100%' }} disabled={readOnly} placeholder="选择原始记录图片分区"
                        value={linkedRecord?.groups.find(source => source.section_role === 'images' && source.fields.some(f => group.fields.some(target => target.image_source_code === f.code)))?.id}
                        options={linkedRecord?.groups.filter(source => source.section_role === 'images').map(source => ({ value: source.id, label: source.label }))}
                        onChange={id => {
                          const source = linkedRecord?.groups.find(source => source.id === id);
                          if (!source) return;
                          updateGroup(gIdx, { fields: [...group.fields.filter(f => f.type !== 'image'), ...source.fields.filter(f => f.type === 'image').map(f => ({
                            ...f, id: genId(), code: `img_${f.code}`, image_source_code: f.code, caption: undefined, image_photos: undefined, image_items: undefined,
                          }))] });
                        }} />
                      <div style={{ marginTop: 6, color: '#888', fontSize: 12 }}>整组读取录入的图片、名称和顺序，无需逐张配置。</div>
                    </div>}
                    {group.fields.map((field, fIdx) => (
                      editorMode === 'report-project' && group.section_role === 'images' && field.type === 'image' ? null :
                      <Dropdown key={field.id} trigger={['contextMenu']} menu={{ items: [
                        { key: 'copy', label: '复制字段' },
                        { key: 'paste', label: '粘贴字段', disabled: readOnly || !fieldClipboard },
                      ], onClick: ({ key, domEvent }) => {
                        domEvent.stopPropagation();
                        if (key === 'copy') copyField(field); else pasteField(group.id, field.id);
                      } }}>
                      <div data-field-clipboard={field.id} tabIndex={0}
                        onClickCapture={event => { if (editorMode === 'report-cover' && !(event.target as HTMLElement).closest('button, [role="slider"], .fe-drag, .fe-row-actions') && (!(event.target as HTMLElement).closest('input, textarea') || event.ctrlKey || event.metaKey || event.shiftKey)) { event.stopPropagation(); chooseCoverField(field.id); } }}
                        onKeyDown={event => { if (editorMode === 'report-cover' && event.target === event.currentTarget && (event.key === ' ' || event.key === 'Enter')) { event.preventDefault(); if (event.key === 'Enter') { setSelectedId(field.id); } else chooseCoverField(field.id); } }}><FieldRow
                        issues={fieldIssues[field.code]}
                        field={conclusionDisplayField(field)}
                        groupIdx={gIdx}
                        fieldIdx={fIdx}
                        fieldCount={group.fields.length}
                        selected={field.id === selectedId}
                        inlineLabel={editorMode !== 'report-cover'}
                        onSelect={() => { setSelectedId(field.id); onFieldFocus?.(field.code, group.id, field); }}
                        onLabelChange={(label) => updateField(gIdx, fIdx, { label })}
                        onOpenFormula={() => setFormulaId(field.id)}
                        onMoveUp={() => moveField(gIdx, fIdx, -1)}
                        onMoveDown={() => moveField(gIdx, fIdx, 1)}
                        onRemove={() => removeField(gIdx, fIdx)}
                        onDropField={dropFieldTo}
                      /></div>
                      </Dropdown>
                    ))}
                    <Dropdown trigger={['contextMenu']} menu={{ items: [{ key: 'paste', label: '粘贴字段', disabled: readOnly || !fieldClipboard }],
                      onClick: ({ domEvent }) => { domEvent.stopPropagation(); pasteField(group.id); } }}>
                    <div data-field-paste-group={group.id} tabIndex={0}>
                    <FieldTailDrop groupIdx={gIdx} fieldCount={group.fields.length} onDropField={dropFieldTo}>
                      {group.fields.length === 0 && (
                        <div className="fe-empty-hint">暂无字段 —— 点下方「添加字段」，或把其他分区的字段拖进来</div>
                      )}
                      <Space size={8}>
                        <Dropdown
                          disabled={readOnly}
                          menu={{
                            items: categoriesForGroup(editorMode, group.section_role).map(c => ({
                              key: c.key,
                              label: (
                                <div style={{ minWidth: 220 }}>
                                  <div style={{ fontWeight: 'bold' }}>{c.icon}  {c.label}</div>
                                  <div style={{ fontSize: 11, color: '#888' }}>{c.hint}</div>
                                </div>
                              ),
                            })),
                            onClick: ({ key }) => addField(gIdx, key as FieldCategory),
                            style: { maxHeight: '70vh', overflowY: 'auto' },
                          }}
                        >
                          <Button size="small" type="primary" ghost icon={<PlusOutlined />} disabled={readOnly}
                            title={readOnly ? '请先点击页面右上角“开始编辑”' : undefined}>添加字段</Button>
                        </Dropdown>
                        {editorMode === 'record' && group.section_role === 'conclusion' && group.conclusion_kind !== 'item' && !group.parent_group_id
                          && !compactConclusionChildren(group, template.groups.filter(child => child.parent_group_id === group.id)).length && (
                          <Button size="small" type="dashed" icon={<PlusOutlined />} disabled={readOnly}
                            onClick={() => addConclusionItem(group)}>添加子项目</Button>
                        )}
                        {editorMode === 'record' && group.section_role === 'conclusion'
                          && !group.fields.some(field => field.conclusion_role === 'judgment_requirement') && (
                          <Button size="small" type="dashed" disabled={readOnly}
                            onClick={() => addConclusionRoleField(gIdx, 'judgment_requirement')}>添加判定要求</Button>
                        )}
                        {editorMode === 'record' && group.section_role === 'conclusion'
                          && !group.fields.some(field => field.conclusion_role === 'limit') && (
                          <Button size="small" type="dashed" disabled={readOnly}
                            onClick={() => addConclusionRoleField(gIdx, 'limit')}>添加限值</Button>
                        )}
                        {editorMode === 'record' && group.section_role === 'conclusion'
                          && !group.fields.some(field => field.conclusion_role === 'conclusion') && (
                          <Button size="small" type="dashed" disabled={readOnly}
                            onClick={() => addConclusionRoleField(gIdx, 'conclusion')}>{group.conclusion_kind === 'item' ? '添加结论' : '添加总结论'}</Button>
                        )}
                        {/* 「子分区」（新建子分区）功能已按需求移除；存量子分区仍正常渲染、可用「转为顶级分区」展平。 */}
                      </Space>
                    </FieldTailDrop>
                    </div>
                    </Dropdown>
                  </>
                )}
              </GroupCard>
            );
          };
          return groupTree.map(({ group, children }, topIdx) => (
            <div key={group.id}>
              {renderGroupCard(group, { isSub: false, siblingPos: topIdx, siblingCount: groupTree.length, hasChildren: children.length > 0 })}
              {children.length > 0 && (
                <div className="fe-subgroup-area" style={{ marginLeft: 24, marginTop: -4 }}>
                  {editorMode === 'record' && <ConclusionItemsTable groups={compactConclusionChildren(group, children)}
                    renderCell={(field, child) => <button type="button" disabled={readOnly}
                      onClick={() => { setSelectedId(field.id); onFieldFocus?.(field.code, child.id, field); }}
                      style={{ width: '100%', minHeight: 36, padding: 6, textAlign: 'left', whiteSpace: 'pre-wrap', cursor: 'pointer',
                        border: field.id === selectedId ? '1px solid #1677ff' : '1px solid transparent', borderRadius: 4,
                        background: field.id === selectedId ? '#e6f4ff' : 'transparent', color: 'inherit' }}>
                      {String(field.default_value ?? (field.conclusion_role === 'item_name' ? child.label : field.label))}
                    </button>}
                    renderActions={child => <>{!child.fields.some(field => field.conclusion_role === 'limit') && <Button size="small" type="link" disabled={readOnly}
                      onClick={() => addConclusionRoleField(template.groups.findIndex(candidate => candidate.id === child.id), 'limit')}>补限值</Button>}<Button type="text" danger size="small" disabled={readOnly}
                      aria-label={`删除${child.label}`} icon={<DeleteOutlined />}
                      onClick={() => removeGroup(template.groups.findIndex(candidate => candidate.id === child.id))} /></>} />}
                  {editorMode === 'record' && compactConclusionChildren(group, children).length > 0 && <Button
                    size="small" type="dashed" icon={<PlusOutlined />} disabled={readOnly} onClick={() => addConclusionItem(group)}>添加子项目</Button>}
                  {children.filter(child => editorMode !== 'record' || !compactConclusionChildren(group, children).includes(child)).map((child, ci) => (
                    <div key={child.id} className="fe-subgroup">
                      {renderGroupCard(child, { isSub: true, siblingPos: ci, siblingCount: children.length, hasChildren: false })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ));
        })()}

        {/* —— 添加分区（带预设）—— */}
        <Dropdown
          disabled={readOnly}
          menu={{
            items: sectionPresetsForEditor(editorMode).map(p => ({
              key: p.key,
              label: (
                <div style={{ minWidth: 260 }}>
                  <div style={{ fontWeight: 'bold' }}>{p.icon}  {p.label}</div>
                  <div style={{ fontSize: 11, color: '#888' }}>{p.hint}</div>
                </div>
              ),
            })),
            onClick: ({ key }) => addGroupFromPreset(key),
          }}
        >
          <Button icon={<AppstoreAddOutlined />} block type="dashed" disabled={readOnly}
            title={readOnly ? '请先点击页面右上角“开始编辑”' : undefined}>添加分区</Button>
        </Dropdown>
      </div>

      {/* —— 字段属性弹窗：左侧滑出、不遮右侧 PDF 实时预览（mask=false，大纲/PDF 仍可交互）；
            右缘拖拽调宽，右下角「保存并返回」 —— */}
      <Drawer
        title={currentField ? `字段属性 · ${currentField.label || currentField.code}` : '字段属性'}
        placement="left"
        open={!!currentField && !(editorMode === 'report-project' && currentField.type === 'image')}
        onClose={clearSelectedField}
        closable={false}
        extra={<Button type="text" icon={<CloseOutlined />} aria-label="关闭字段属性" title="关闭" onClick={clearSelectedField} />}
        width={visiblePanelWidth}
        mask={false}
        rootStyle={drawerRootStyle}
        footer={
          <div style={{ textAlign: 'right' }}>
            <Button type="primary" onClick={clearSelectedField}>{readOnly ? '关闭' : '保存并返回'}</Button>
          </div>
        }
      >
        <PanelResizeHandle width={visiblePanelWidth} onResize={(clientX) => updatePanelWidth(clientX - overlayLeft)} />
        {!!currentField && !!fieldIssues[currentField.code]?.length && (
          <div role="status" style={{ position: 'sticky', top: -24, zIndex: 2, padding: '10px 12px', marginBottom: 12,
            background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6 }}>
            <strong>请调整数据来源</strong>
            {fieldIssues[currentField.code].map(reason => <div key={reason} style={{ marginTop: 4 }}>{reason}</div>)}
          </div>
        )}
        {readOnly && <Alert type="info" showIcon message="当前为只读查看，请先点击页面上方“开始编辑”" style={{ marginBottom: 12 }} />}
        <ReadOnlyEditorContent readOnly={readOnly}>
        {currentField && selLoc && !(editorMode === 'report-project' && currentField.type === 'image') && (
          <FieldPropsPanel
            field={currentField}
            template={template}
            onChange={(patch) => updateField(selLoc.g, selLoc.f, patch)}
            onReplaceField={(f) => replaceField(selLoc.g, selLoc.f, f)}
            computedFieldOptions={computedFieldOptions}
            editorMode={editorMode}
            linkedRecord={linkedRecord}
            onDetailFocus={(code) => onFieldFocus?.(code, template.groups[selLoc.g].id, currentField)}
          />
        )}
        </ReadOnlyEditorContent>
      </Drawer>

      {/* —— 公式编辑弹窗 —— */}
      <Drawer
        title={formulaField ? `编辑计算字段公式 — ${formulaField.label || ''}` : '编辑公式'}
        placement="left"
        open={!!formulaField}
        onClose={() => setFormulaId(null)}
        closable={false}
        extra={<Button type="text" icon={<CloseOutlined />} aria-label="关闭公式编辑" title="关闭" onClick={() => setFormulaId(null)} />}
        width={visiblePanelWidth}
        mask={false}
        rootStyle={drawerRootStyle}
      >
        <PanelResizeHandle width={visiblePanelWidth} onResize={(clientX) => updatePanelWidth(clientX - overlayLeft)} />
        {readOnly && <Alert type="info" showIcon message="请先点击页面上方“开始编辑”，再修改公式" />}
        {!readOnly && formulaField && formulaLoc && (
          <div>
            <div style={{ marginBottom: 16, padding: 12, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 4 }}>
              <p style={{ margin: 0, fontSize: 12, color: '#389e0d' }}>
                <strong>使用说明：</strong>选择公式类型 → 在"数据源字段"中选择该计算字段依赖的输入字段 → 设置小数位 → 保存。
                <br/>例如：要计算 3 个试样温度的平均值，选"平均值"，然后选择"试样1温度"、"试样2温度"、"试样3温度"。
              </p>
            </div>
            <FormulaEditor
              value={formulaField.formula}
              availableFields={formulaSourceFields}
              onChange={(formula) => {
                updateField(formulaLoc.g, formulaLoc.f, { formula });
                setFormulaId(null);
              }}
              onCancel={() => setFormulaId(null)}
            />
          </div>
        )}
      </Drawer>
    </div>
  );
}

// ============ 弹窗右缘拖拽调宽手柄 ============
// 贴在左侧 Drawer 右边缘，拖动改宽度（持久化 fieldPanelWidth）。
function PanelResizeHandle({ width, onResize }: { width: number; onResize: (w: number) => void }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      title="拖动调整弹窗宽度"
      onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setDragging(true); }}
      onPointerMove={(e) => { if (dragging) onResize(e.clientX); }}
      onPointerUp={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); setDragging(false); }}
      style={{
        // Drawer 浮层已被限制在编辑区以下；手柄只负责其右边缘宽度。
        position: 'absolute', top: 0, left: width - 3, width: 7, height: '100%',
        cursor: 'col-resize', zIndex: 1002,
        background: dragging ? 'rgba(19,102,217,0.35)' : 'transparent',
        transition: dragging ? 'none' : 'background 0.15s',
      }}
      onMouseEnter={(e) => { if (!dragging) (e.currentTarget as HTMLElement).style.background = 'rgba(19,102,217,0.18)'; }}
      onMouseLeave={(e) => { if (!dragging) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    />
  );
}

// ============ 分组卡（可拖拽重排 + 折叠 + hover 工具条）============
function GroupCard({
  group, gIdx, isSub, siblingPos, siblingCount, collapsed, children, docFieldGap, docFont, docSize, docFigureGapPt, editorMode, locked, inherited, readOnly,
  onToggleCollapse, onUpdateGroup, onSetParent, onMoveGroup, onRemoveGroup, onDropGroup,
}: {
  group: FieldGroup;
  gIdx: number;
  /** 文档级「字段间距」(theme_config.line_gap)，作为分区「字段间距」的继承提示值（GroupCard 无 template，故由父层透传） */
  docFieldGap: string;
  /** 文档级默认 字体/字号：分区「格式」面板未设本级时直接显示实际生效值。 */
  docFont: string;
  docSize: number;
  /** 图片标签/备注未单设距离时，当前文档字段间距换算成的实际 pt。 */
  docFigureGapPt: number;
  /** 编辑器模式：报告模式(report-*)下分区不再显示「字段间距」(改为文档默认+每字段单独设)。 */
  editorMode: EditorMode;
  /** 签发/签字栏分区：整段置灰只读——锁分区名/排版/格式/层级/加字段，只保留折叠/移动/删除 */
  locked?: boolean;
  readOnly?: boolean;
  /** 旧项目组基础模板继承分区标记（当前简化方案不再锁定）。 */
  inherited?: boolean;
  /** 是否子分区（限一层嵌套；子分区禁拖拽，用 ↑↓ 在同父内排序） */
  isSub: boolean;
  /** 同层（顶级之间 / 同父子分区之间）的位置与数量，控制 ↑↓ 禁用 */
  siblingPos: number;
  siblingCount: number;
  collapsed: boolean;
  children: React.ReactNode;
  onToggleCollapse: () => void;
  onUpdateGroup: (patch: Partial<FieldGroup>) => void;
  /** 调整层级：传顶级分区 id = 变为其子分区；传 undefined = 转为顶级 */
  onSetParent: (parentId?: string) => void;
  onMoveGroup: (dir: -1 | 1) => void;
  onRemoveGroup: () => void;
  onDropGroup: (groupId: string, insertIdx: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<'above' | 'below'>('above');
  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: DND_GROUP,
    item: { id: group.id },
    canDrag: !isSub && !inherited,
    collect: m => ({ isDragging: m.isDragging() }),
  }), [group.id, isSub, inherited]);
  const [{ isOver }, drop] = useDrop<{ id: string }, void, { isOver: boolean }>(() => ({
    accept: DND_GROUP,
    collect: m => ({ isOver: m.isOver() && m.getItem()?.id !== group.id }),
    hover: (_item, monitor) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      const y = monitor.getClientOffset()?.y;
      if (rect && y != null) setPos(y < rect.top + rect.height / 2 ? 'above' : 'below');
    },
    drop: (item, monitor) => {
      if (item.id === group.id) return;
      const rect = wrapRef.current?.getBoundingClientRect();
      const y = monitor.getClientOffset()?.y ?? 0;
      const before = rect ? y < rect.top + rect.height / 2 : true;
      onDropGroup(item.id, before ? gIdx : gIdx + 1);
    },
  }), [group.id, gIdx, onDropGroup]);

  const hidden = !!group.hide_title;
  const pageBreak = !!group.page_break_before;
  const imageInheritedFont = group.style?.font || docFont;
  const imageInheritedSize = group.style?.size ? (parseFloat(group.style.size) || docSize) : docSize;
  const imageDefaultInset = group.fields.find(field => field.type === 'image')?.image_table_style?.inset_pt ?? 6;

  return (
    <div
      ref={(node) => { wrapRef.current = node; preview(drop(node)); }}
      data-fe-node={group.id}
      style={{
        opacity: isDragging ? 0.35 : 1,
        boxShadow: isOver ? (pos === 'above' ? `0 -2px 0 ${BRAND}` : `0 2px 0 ${BRAND}`) : undefined,
        borderRadius: 8,
        marginBottom: 12,
      }}
    >
      <Card
        size="small"
        className="fe-group-card"
        style={{ borderColor: group.common_component_id ? '#91caff' : '#e4e8f0' }}
        styles={{
          header: { background: group.common_component_id ? '#f0f7ff' : '#f8fafc', borderBottomColor: collapsed ? 'transparent' : '#eef0f4' },
          title: { minWidth: 0, whiteSpace: 'normal', overflow: 'visible' },
          extra: { flexShrink: 0 },
          body: collapsed ? { display: 'none' } : { padding: '10px 12px' },
        }}
        title={
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, minWidth: 0, paddingBlock: 6 }}>
            {!isSub && (
              <span ref={(n) => { drag(n); }} onClick={(e) => e.stopPropagation()}>
                <HolderOutlined className="fe-drag" />
              </span>
            )}
            {isSub && <Tag color="orange" style={{ marginInlineEnd: 0, fontSize: 11 }}>子分区</Tag>}
            {group.common_component_id && <Tooltip title={`项目组历史公共组件：${group.common_component_name || group.common_component_code} · v${group.common_component_version_no || '?' }。当前模板保存完整快照。`}>
              <Tag color="blue" style={{ marginInlineEnd: 0, fontSize: 11 }}>公共区域 v{group.common_component_version_no || '?'}</Tag>
            </Tooltip>}
            <Button
              type="text" size="small" style={{ width: 22, minWidth: 22 }}
              icon={collapsed ? <RightOutlined style={{ fontSize: 10 }} /> : <DownOutlined style={{ fontSize: 10 }} />}
              onClick={onToggleCollapse}
            />
            <AutoGrowTextArea
              size="small"
              variant="filled"
              value={group.label}
              onChange={(e) => onUpdateGroup({ label: e.target.value })}
              style={{ width: 180, maxWidth: '100%', fontWeight: 600 }}
              placeholder="分区名称"
              disabled={hidden || locked || inherited}
            />
            <span className="fe-meta">{group.fields.length} 字段</span>
            {hidden && <Tag style={{ marginInlineEnd: 0 }}>标题隐藏</Tag>}
            {pageBreak && <Tag style={{ marginInlineEnd: 0 }}>前分页</Tag>}
            {locked && <Tooltip title="签发/签字栏分区版面固定、内容由接口取号自动填，故不可编辑；可整段删除或在别处添加分区"><Tag color="default" style={{ marginInlineEnd: 0 }}>🔒 签发分区·系统固定</Tag></Tooltip>}
          </div>
        }
        extra={
          <Space size={0}>
            {!locked && !inherited && (<>
            <Tooltip title={hidden ? 'PDF 中已隐藏分组标题，点击恢复显示' : '隐藏 PDF 中的分组标题（仅作为组织字段使用）'}>
              <Button size="small" type="text" icon={hidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                style={hidden ? { color: BRAND } : undefined}
                onClick={() => onUpdateGroup({ hide_title: !hidden })} />
            </Tooltip>
            <Tooltip title={pageBreak ? '此分区前已强制分页，点击取消' : '此分区前强制分页（PDF 渲染时新起一页）'}>
              <Button size="small" type="text" icon={<VerticalAlignTopOutlined />}
                style={pageBreak ? { color: BRAND } : undefined}
                onClick={() => onUpdateGroup({ page_break_before: !pageBreak })} />
            </Tooltip>
            {(() => {
              const { layoutable, note } = sectionLayoutInfo(group);
              if (!layoutable) {
                // 图片分区：分区级版式（每行几图位 / 尺寸 / 独立·粘连 / 单数独占 / 标题模式）——与生成报告/项目模板共用 ImageLayoutControls
                if (group.section_role === 'images' && !locked) {
                  const il = group.image_layout || {};
                  return (
                    <ClosablePopover trigger="click" placement="bottomRight" title="图片分区版式（统一管本分区所有图位）"
                      overlayInnerStyle={{ maxHeight: 'calc(100vh - 24px)', maxWidth: 'calc(100vw - 24px)', overflow: 'hidden' }}
                      content={<ImageSectionPanel value={il} inheritedFont={imageInheritedFont} inheritedSize={imageInheritedSize}
                        defaultInset={imageDefaultInset}
                        onChange={(patch) => onUpdateGroup({ image_layout: { ...il, ...patch } })} />}>
                      <Tooltip title="设置图片排布、尺寸和表内标题样式">
                        <Button size="small" type="text" icon={<TableOutlined />}
                          style={group.image_layout ? { color: BRAND } : undefined}>图片版式</Button>
                      </Tooltip>
                    </ClosablePopover>
                  );
                }
                return (
                  <Tooltip title="此分区内容已定型（数据表格 / 图片 / 签名），排版自动，无需选择">
                    <span className="fe-meta" style={{ marginInline: 6, color: '#aaa', whiteSpace: 'nowrap' }}>{note}</span>
                  </Tooltip>
                );
              }
              return canArrangeRecordGroup(group) ? <Segmented size="small"
                value={group.layout === 'two-col' ? 'two-col' : 'vertical'}
                options={[{ label: '单栏', value: 'vertical' }, { label: '双栏', value: 'two-col' }]}
                onChange={value => onUpdateGroup({ layout: value as 'vertical' | 'two-col' })} /> : null;
            })()}
            <ClosablePopover trigger="click" placement="bottomRight" title="本区块格式（覆盖文档默认）"
              overlayInnerStyle={{ maxHeight: 'calc(100vh - 24px)', maxWidth: 'calc(100vw - 24px)', overflow: 'hidden' }}
              content={
                <div className={`fe-section-format-card${group.section_role === 'images' ? ' fe-section-format-card--image' : ''}`}>
                  <div className="fe-section-format-column">
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#555' }}>分区标题</div>
                    <FormatPanel variant="text" value={group.title_style} inheritedFont={docFont} inheritedSize={docSize} inheritedBold={true}
                      onChange={(title_style) => onUpdateGroup({ title_style })} />
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Tooltip title="分区标题（如「检测结果」）和它下方第一块内容（表格/字段）之间的留白。留空＝默认。">
                        <span style={{ fontSize: 12, color: '#888' }}>标题与内容间距</span>
                      </Tooltip>
                      <InputNumber size="small" style={{ width: 96 }} min={0} max={60} step={0.5} addonAfter="pt"
                        value={group.title_gap ? parseFloat(group.title_gap) : Math.round(0.4 * docSize * 10) / 10}
                        onChange={(v) => onUpdateGroup({ title_gap: v != null ? `${v}pt` : undefined })} />
                    </div>
                  </div>
                  <div className="fe-section-format-column fe-section-format-aside">
                    {group.section_role === 'images' && editorMode === 'report-cover' ? (
                      /* 图片分区：右侧＝图表上方标签 + 图表下方备注（表内标题在「图片版式」里；此处不出通用区块内容） */
                      <ImageSectionNotes value={group.image_layout || {}}
                        inheritedFont={imageInheritedFont} inheritedSize={imageInheritedSize} inheritedFigureGapPt={docFigureGapPt}
                        onChange={(patch) => onUpdateGroup({ image_layout: { ...(group.image_layout || {}), ...patch } })} />
                    ) : (<>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#555' }}>区块内容</div>
                    <FormatPanel block value={group.style} onChange={(style) => onUpdateGroup({ style })}
                      inheritedFieldGap={docFieldGap} hideFieldGap={editorMode !== 'record'}
                      inheritedFont={docFont} inheritedSize={docSize} />
                    {/* 值对齐（标签↔值距离）：覆盖文档级 label_width。仅竖排字段有效（多列本就紧贴）。 */}
                    <div style={{ marginTop: 10 }}>
                      <Tooltip title="字段「名」与「值」之间的距离：跟随文档=用文档统一设置；紧凑=值紧接在字段名后、无额外间距；对齐=本区字段名占固定列宽、各值对齐到同一竖线（仅竖排有效，多列本就紧凑）">
                        <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>字段值对齐（名↔值距离）</div>
                      </Tooltip>
                      <Space size={8}>
                        <Segmented
                          size="small"
                          value={group.label_width === undefined ? 'inherit' : group.label_width === 'none' ? 'tight' : 'align'}
                          onChange={(v) => {
                            if (v === 'inherit') onUpdateGroup({ label_width: undefined });
                            else if (v === 'tight') onUpdateGroup({ label_width: 'none' });
                            else onUpdateGroup({ label_width: (group.label_width && group.label_width !== 'none') ? group.label_width : '8em' });
                          }}
                          options={[
                            { label: '跟随文档', value: 'inherit' },
                            { label: '紧凑', value: 'tight' },
                            { label: '对齐', value: 'align' },
                          ]}
                        />
                        {group.label_width && group.label_width !== 'none' && (
                          <InputNumber size="small" style={{ width: 92 }} min={1} max={30} step={0.5} addonAfter="em"
                            value={parseFloat(group.label_width) || 8}
                            onChange={(v) => onUpdateGroup({ label_width: `${v ?? 8}em` })} />
                        )}
                      </Space>
                    </div>
                    </>)}
                  </div>
                </div>
              }>
              <Tooltip title="分区标题样式（加粗/字号/颜色…）+ 区块内容字体/对齐/行距/间距（不同区块可不同）">
                <Button size="small" type="text" icon={<FontColorsOutlined />}
                  style={(group.style || group.title_style) ? { color: BRAND } : undefined} />
              </Tooltip>
            </ClosablePopover>
            {/* 层级调整：「移入子分区」（把顶级分区变成别人的子分区）已按需求移除；
                仅保留存量子分区的「转为顶级分区」展平入口，便于把历史子分区拉回顶级。 */}
            {isSub && (
              <Tooltip title="转为顶级分区">
                <Button size="small" type="text" icon={<ExportOutlined />} onClick={() => onSetParent(undefined)} />
              </Tooltip>
            )}
            </>)}
            {locked && editorMode !== 'report-cover' && (
              <Tooltip title="签字栏在页面上的位置：跟随正文（紧接上方内容）/ 页面居中 / 钉在页面底部">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginInline: 6 }}>
                  <span className="fe-meta" style={{ color: '#888' }}>位置</span>
                  <Segmented
                    size="small"
                    value={group.style?.vertical_align === 'bottom' ? 'bottom' : group.style?.vertical_align === 'center' ? 'center' : 'flow'}
                    onChange={(v) => onUpdateGroup({ style: { ...group.style, vertical_align: v === 'flow' ? undefined : (v as 'center' | 'bottom') } })}
                    options={[
                      { label: '跟随正文', value: 'flow' },
                      { label: '居中', value: 'center' },
                      { label: '底部', value: 'bottom' },
                    ]}
                  />
                </span>
              </Tooltip>
            )}
            <span className="fe-hover-actions">
              <Tooltip title={isSub ? '在本父分区内上移' : '上移分区'}>
                <Button size="small" type="text" icon={<ArrowUpOutlined />}
                  disabled={inherited || siblingPos === 0} onClick={() => onMoveGroup(-1)} />
              </Tooltip>
              <Tooltip title={isSub ? '在本父分区内下移' : '下移分区'}>
                <Button size="small" type="text" icon={<ArrowDownOutlined />}
                  disabled={inherited || siblingPos === siblingCount - 1} onClick={() => onMoveGroup(1)} />
              </Tooltip>
              <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={inherited} onClick={onRemoveGroup} />
            </span>
          </Space>
        }
      >
        {locked && editorMode === 'report-cover' && <div aria-label="签署位置设置" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 10, borderRadius: 6, background: '#eef4fc' }}>
          <span style={{ fontSize: 12, color: '#52647c' }}>签署位置</span>
          {SIGNATURE_POSITION_OPTIONS.map(({ value, label }) => <Tooltip key={value} title={readOnly ? '请先开始编辑' : value === 'first_page_bottom' ? '首页预留签署空间，正文过长自动续页' : value === 'flow' ? '紧接正文，按顺序排列' : '跟随前面的正文，放在所在页底部；空间不足时移至下一页底部'}>
            <Button size="small" disabled={readOnly} type={signaturePosition(group) === value ? 'primary' : 'default'} onClick={() => { if (!readOnly) onUpdateGroup({ signature_position: value }); }}>{label}</Button>
          </Tooltip>)}
        </div>}
        {children}
      </Card>
    </div>
  );
}

// ============ 分组尾部投放区（拖到分组末尾 / 空分组）============
function FieldTailDrop({ groupIdx, fieldCount, onDropField, children }: {
  groupIdx: number;
  fieldCount: number;
  onDropField: (fieldId: string, toGroup: number, insertIdx: number) => void;
  children: React.ReactNode;
}) {
  const [{ isOver }, drop] = useDrop<{ id: string }, void, { isOver: boolean }>(() => ({
    accept: DND_FIELD,
    collect: m => ({ isOver: m.isOver({ shallow: true }) }),
    drop: (item, monitor) => {
      if (monitor.didDrop()) return;
      onDropField(item.id, groupIdx, fieldCount);
    },
  }), [groupIdx, fieldCount, onDropField]);
  return (
    <div ref={(n) => { drop(n); }} style={{ paddingTop: 4, boxShadow: isOver ? `inset 0 2px 0 ${BRAND}` : undefined }}>
      {children}
    </div>
  );
}

// ============ 单条字段行（整行可点选 + 拖拽重排 + hover 操作）============
function FieldRow({
  field, groupIdx, fieldIdx, fieldCount, selected,
  issues,
  inlineLabel = true,
  onSelect, onLabelChange, onOpenFormula, onMoveUp, onMoveDown, onRemove, onDropField,
}: {
  field: FieldDefinition;
  groupIdx: number;
  fieldIdx: number;
  fieldCount: number;
  selected: boolean;
  issues?: string[];
  inlineLabel?: boolean;
  onSelect: () => void;
  onLabelChange: (label: string) => void;
  onOpenFormula: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onDropField: (fieldId: string, toGroup: number, insertIdx: number) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<'above' | 'below'>('above');
  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: DND_FIELD,
    item: { id: field.id },
    collect: m => ({ isDragging: m.isDragging() }),
  }), [field.id]);
  const [{ isOver }, drop] = useDrop<{ id: string }, void, { isOver: boolean }>(() => ({
    accept: DND_FIELD,
    collect: m => ({ isOver: m.isOver() && m.getItem()?.id !== field.id }),
    hover: (_item, monitor) => {
      const rect = rowRef.current?.getBoundingClientRect();
      const y = monitor.getClientOffset()?.y;
      if (rect && y != null) setPos(y < rect.top + rect.height / 2 ? 'above' : 'below');
    },
    drop: (item, monitor) => {
      if (item.id === field.id) return;
      const rect = rowRef.current?.getBoundingClientRect();
      const y = monitor.getClientOffset()?.y ?? 0;
      const before = rect ? y < rect.top + rect.height / 2 : true;
      onDropField(item.id, groupIdx, before ? fieldIdx : fieldIdx + 1);
    },
  }), [field.id, groupIdx, fieldIdx, onDropField]);

  const cat = categoryOfField(field);
  const catEntry = FIELD_CATEGORIES.find(c => c.key === cat);
  const isComputed = field.type === 'computed';

  // 类别 / 子模式 / 单位 / 必填 收敛为一条灰色 meta 文本
  const metaParts = [
    isComputed ? '计算字段' : getCategoryLabel(cat),
    field.type === 'checkbox' ? '多选' : null,
    field.type === 'variant_list' ? '挂子字段' : null,
    field.type === 'textarea' ? '多行' : null,
    field.unit || null,
    field.required ? '必填' : null,
  ].filter(Boolean).join(' · ');

  return (
    <div
      ref={(node) => { rowRef.current = node; preview(drop(node)); }}
      data-fe-node={field.id}
      className={`fe-row ${selected ? 'fe-selected' : ''}`}
      style={{
        opacity: isDragging ? 0.35 : 1,
        boxShadow: isOver ? (pos === 'above' ? `inset 0 2px 0 ${BRAND}` : `inset 0 -2px 0 ${BRAND}`) : undefined,
      }}
      onClick={onSelect}
    >
      <span ref={(n) => { drag(n); }} onClick={(e) => e.stopPropagation()}>
        <HolderOutlined className="fe-drag" />
      </span>
      <span className="fe-cat-chip" title={getCategoryLabel(cat)}>{isComputed ? 'ƒ' : catEntry?.icon}</span>
      {inlineLabel ? <AutoGrowTextArea
        size="small"
        variant="borderless"
        value={field.label}
        onChange={(e) => onLabelChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        style={{ flex: '0 1 200px', minWidth: 90, fontWeight: 500, padding: '0 4px' }}
      /> : <span style={{ flex: '0 1 200px', minWidth: 90, fontWeight: 500, padding: '0 4px', userSelect: 'none' }}>{field.label || '未命名字段'}</span>}
      <span className="fe-meta" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{metaParts}</span>
      {!!issues?.length && <Tooltip title={issues.join('；')}>
        <Tag color="warning" style={{ marginInlineEnd: 0, cursor: 'pointer', flexShrink: 0 }}>来源需调整</Tag>
      </Tooltip>}
      {isComputed && field.formula && (
        <Tag color="purple" style={{ cursor: 'pointer', marginInlineEnd: 0 }}
          onClick={(e) => { e.stopPropagation(); onOpenFormula(); }}>
          {formulaTypeLabel(field.formula.type)}({(field.formula.sources || []).slice(0, 2).join(', ')}{(field.formula.sources || []).length > 2 ? '...' : ''})
        </Tag>
      )}
      {isComputed && !field.formula && (
        <Tag color="red" style={{ cursor: 'pointer', marginInlineEnd: 0 }}
          onClick={(e) => { e.stopPropagation(); onOpenFormula(); }}>
          点击配置公式
        </Tag>
      )}
      <div style={{ flex: 1 }} />
      <span className="fe-row-actions" onClick={(e) => e.stopPropagation()}>
        {isComputed && (
          <Tooltip title="编辑公式">
            <Button size="small" type="text" icon={<FunctionOutlined />} onClick={onOpenFormula} />
          </Tooltip>
        )}
        <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={fieldIdx === 0} onClick={onMoveUp} />
        <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={fieldIdx === fieldCount - 1} onClick={onMoveDown} />
        <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={onRemove} />
      </span>
    </div>
  );
}
