import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Drawer, Dropdown, Input, InputNumber, Modal, Popover, Segmented, Space, Tag, Tooltip } from 'antd';
import {
  AppstoreAddOutlined, ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, DownOutlined,
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
  categoriesForEditor,
  categoryOfField,
  createFieldForCategory,
  editorCapabilities,
  getCategoryLabel,
  type FieldCategory,
} from './field-types';
import { SECTION_PRESETS, isSignatureGroup } from './section-presets';
import FormulaEditor from '../FormulaEditor';
import FieldPropsPanel from './FieldPropsPanel';
import DocumentStylePanel from './DocumentStylePanel';
import TitleStylePanel from './TitleStylePanel';
import FormatPanel from './FormatPanel';
import ImageSectionPanel from './ImageSectionPanel';
import ImageSectionNotes from './ImageSectionNotes';
import { FORMULA_TYPES } from '../../../../shared/formula-engine';

export type EditorMode = 'record' | 'report-cover' | 'report-project';

interface FieldEditorProps {
  template: RecordTemplate;
  onChange: (template: RecordTemplate) => void;
  /** 'record' (默认) / 'report-cover' / 'report-project' */
  editorMode?: EditorMode;
  /** project 模式下关联的原始记录模板（供 BindingEditor 使用） */
  linkedRecord?: RecordTemplate | null;
  /** 选中/点击字段时回调（code, groupId）——编辑器 ⇄ PDF 正向跳转用；code 为空 = 仅分区 */
  onFieldFocus?: (code: string, groupId: string) => void;
  /** 外部请求选中（PDF Ctrl+点击反向跳转）：kind=field 按 code 选字段，kind=group 滚到分区 */
  selectRequest?: { kind: 'field' | 'group'; code: string; token: number } | null;
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
  return (
    <DndProvider backend={HTML5Backend}>
      <FieldEditorInner {...props} />
    </DndProvider>
  );
}

function FieldEditorInner({ template, onChange, editorMode = 'record', linkedRecord = null, onFieldFocus, selectRequest }: FieldEditorProps) {
  // 选中字段（打开属性面板）/ 公式编辑目标 —— 用 field.id 引用，拖拽重排后不会指错
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formulaId, setFormulaId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [outlineOpen, setOutlineOpen] = useState<boolean>(() => localStorage.getItem('feOutlineOpen') !== '0');
  const mainRef = useRef<HTMLDivElement | null>(null);

  // 字段属性 / 公式弹窗宽度（拖左缘调整，持久化到 localStorage）
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem('fieldPanelWidth'));
    return v >= 380 && v <= 1100 ? v : 640;
  });
  const updatePanelWidth = (w: number) => {
    const clamped = Math.min(Math.max(Math.round(w), 380), 1100);
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

  /** 模板内已用字段 code（编码系统自动生成、防撞，用户不可见不可改） */
  const usedFieldCodes = () => new Set(template.groups.flatMap(g => g.fields.map(f => f.code)));

  const addGroupFromPreset = (presetKey: string) => {
    const preset = SECTION_PRESETS.find(p => p.key === presetKey);
    if (!preset) return;
    const newGroup = preset.build(genId);
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
    const groups = [...template.groups];
    const field = createFieldForCategory(cat, genId());
    field.code = uniqueCode(field.code, usedFieldCodes());
    groups[groupIdx] = { ...groups[groupIdx], fields: [...groups[groupIdx].fields, field] };
    updateGroups(groups);
    setSelectedId(field.id);
  };

  const removeField = (groupIdx: number, fieldIdx: number) => {
    const target = template.groups[groupIdx]?.fields[fieldIdx];
    if (target) {
      if (selectedId === target.id) setSelectedId(null);
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
    const el = mainRef.current?.querySelector(`[data-fe-node="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

  // 「什么编辑器就显示什么字段」：按 editors 白名单过滤（矩阵/设备仅原始记录；结论汇总仅首页；结果表/设备表/图片表仅项目）
  const visibleCategories = categoriesForEditor(editorMode);
  // 编辑器能力开关（集中映射，替代散落的 editorMode === 判断）
  const caps = editorCapabilities(editorMode);

  const allFields = template.groups.flatMap(g => g.fields);
  // 文档级「字段间距」(theme_config.line_gap)，透传给各分区「格式」面板作继承提示（GroupCard 无 template）。
  const docFieldGap = (() => {
    const lg = (template.layout_options?.theme_config as any)?.line_gap;
    return lg != null && lg !== '' ? (typeof lg === 'number' ? `${lg}em` : String(lg)) : '0.6em';
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
        .map(f => ({ code: f.code, label: `${f.label}（${f.code}）` })),
    [template.groups]
  );

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* —— 大纲导航（可折叠）—— */}
      {outlineOpen ? (
        <div className="fe-outline" style={{ width: 190 }}>
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
                  onClick={() => { setSelectedId(f.id); scrollToNode(f.id); onFieldFocus?.(f.code, g.id); }}
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
                      onClick={() => { setSelectedId(f.id); scrollToNode(f.id); onFieldFocus?.(f.code, c.id); }}
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
      <div ref={mainRef} style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: 12 }}>
        {/* —— 模板属性顶部条 —— */}
        <Card size="small" style={{ marginBottom: 12 }}>
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <div>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>模板名称（内部，用于检索）</div>
              <Input
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
            return (
              <GroupCard
                group={group}
                gIdx={gIdx}
                docFieldGap={docFieldGap}
                editorMode={editorMode}
                isSub={meta.isSub}
                siblingPos={meta.siblingPos}
                siblingCount={meta.siblingCount}
                locked={locked}
                collapsed={collapsedGroups.has(group.id)}
                onToggleCollapse={() => {
                  const next = new Set(collapsedGroups);
                  if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                  setCollapsedGroups(next);
                }}
                onUpdateGroup={(patch) => updateGroup(gIdx, patch)}
                onSetParent={(pid) => updateGroup(gIdx, { parent_group_id: pid })}
                onMoveGroup={(dir) => moveGroup(gIdx, dir)}
                onRemoveGroup={() => removeGroup(gIdx)}
                onDropGroup={dropGroupTo}
              >
                {locked ? (
                  // 签发分区：渲染与普通分区【完全一样】的字段行（排版/样式不变），整段置灰 + 屏蔽交互（不可点选/拖拽/增删/改属性）。
                  <div style={{ pointerEvents: 'none', opacity: 0.6, userSelect: 'none' }} aria-disabled>
                    {group.fields.map((field, fIdx) => (
                      <FieldRow
                        key={field.id}
                        field={field}
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
                    {group.fields.map((field, fIdx) => (
                      <FieldRow
                        key={field.id}
                        field={field}
                        groupIdx={gIdx}
                        fieldIdx={fIdx}
                        fieldCount={group.fields.length}
                        selected={field.id === selectedId}
                        onSelect={() => { setSelectedId(field.id); onFieldFocus?.(field.code, group.id); }}
                        onLabelChange={(label) => updateField(gIdx, fIdx, { label })}
                        onOpenFormula={() => setFormulaId(field.id)}
                        onMoveUp={() => moveField(gIdx, fIdx, -1)}
                        onMoveDown={() => moveField(gIdx, fIdx, 1)}
                        onRemove={() => removeField(gIdx, fIdx)}
                        onDropField={dropFieldTo}
                      />
                    ))}
                    <FieldTailDrop groupIdx={gIdx} fieldCount={group.fields.length} onDropField={dropFieldTo}>
                      {group.fields.length === 0 && (
                        <div className="fe-empty-hint">暂无字段 —— 点下方「添加字段」，或把其他分区的字段拖进来</div>
                      )}
                      <Space size={8}>
                        <Dropdown
                          menu={{
                            items: visibleCategories.map(c => ({
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
                          <Button size="small" type="primary" ghost icon={<PlusOutlined />}>添加字段</Button>
                        </Dropdown>
                        {/* 「子分区」（新建子分区）功能已按需求移除；存量子分区仍正常渲染、可用「转为顶级分区」展平。 */}
                      </Space>
                    </FieldTailDrop>
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
                  {children.map((child, ci) => (
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
          menu={{
            items: SECTION_PRESETS.filter(p => !p.editors || p.editors.includes(editorMode)).map(p => ({
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
          <Button icon={<AppstoreAddOutlined />} block type="dashed">添加分区</Button>
        </Dropdown>
      </div>

      {/* —— 字段属性弹窗：左侧滑出、不遮右侧 PDF 实时预览（mask=false，大纲/PDF 仍可交互）；
            右缘拖拽调宽，右下角「保存并返回」 —— */}
      <Drawer
        title={currentField ? `字段属性 · ${currentField.label || currentField.code}` : '字段属性'}
        placement="left"
        open={!!currentField}
        onClose={() => setSelectedId(null)}
        width={panelWidth}
        mask={false}
        footer={
          <div style={{ textAlign: 'right' }}>
            <Button type="primary" onClick={() => setSelectedId(null)}>保存并返回</Button>
          </div>
        }
      >
        <PanelResizeHandle width={panelWidth} onResize={updatePanelWidth} />
        {currentField && selLoc && (
          <FieldPropsPanel
            field={currentField}
            template={template}
            onChange={(patch) => updateField(selLoc.g, selLoc.f, patch)}
            onReplaceField={(f) => replaceField(selLoc.g, selLoc.f, f)}
            computedFieldOptions={computedFieldOptions}
            editorMode={editorMode}
            linkedRecord={linkedRecord}
          />
        )}
      </Drawer>

      {/* —— 公式编辑弹窗 —— */}
      <Drawer
        title={formulaField ? `编辑计算字段公式 — ${formulaField.label || ''}` : '编辑公式'}
        placement="left"
        open={!!formulaField}
        onClose={() => setFormulaId(null)}
        width={panelWidth}
        mask={false}
      >
        <PanelResizeHandle width={panelWidth} onResize={updatePanelWidth} />
        {formulaField && formulaLoc && (
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
// 固定定位贴在左侧 Drawer 右边缘，拖动改宽度（持久化 fieldPanelWidth）。
function PanelResizeHandle({ width, onResize }: { width: number; onResize: (w: number) => void }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      title="拖动调整弹窗宽度"
      onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setDragging(true); }}
      onPointerMove={(e) => { if (dragging) onResize(e.clientX); }}
      onPointerUp={(e) => { (e.target as HTMLElement).releasePointerCapture(e.pointerId); setDragging(false); }}
      style={{
        position: 'fixed', top: 0, left: width - 3, width: 7, height: '100vh',
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
  group, gIdx, isSub, siblingPos, siblingCount, collapsed, children, docFieldGap, editorMode, locked,
  onToggleCollapse, onUpdateGroup, onSetParent, onMoveGroup, onRemoveGroup, onDropGroup,
}: {
  group: FieldGroup;
  gIdx: number;
  /** 文档级「字段间距」(theme_config.line_gap)，作为分区「字段间距」的继承提示值（GroupCard 无 template，故由父层透传） */
  docFieldGap: string;
  /** 编辑器模式：报告模式(report-*)下分区不再显示「字段间距」(改为文档默认+每字段单独设)。 */
  editorMode: EditorMode;
  /** 签发/签字栏分区：整段置灰只读——锁分区名/排版/格式/层级/加字段，只保留折叠/移动/删除 */
  locked?: boolean;
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
    canDrag: !isSub,
    collect: m => ({ isDragging: m.isDragging() }),
  }), [group.id, isSub]);
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
        style={{ borderColor: '#e4e8f0' }}
        styles={{
          header: { background: '#f8fafc', borderBottomColor: collapsed ? 'transparent' : '#eef0f4' },
          body: collapsed ? { display: 'none' } : { padding: '10px 12px' },
        }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {!isSub && (
              <span ref={(n) => { drag(n); }} onClick={(e) => e.stopPropagation()}>
                <HolderOutlined className="fe-drag" />
              </span>
            )}
            {isSub && <Tag color="orange" style={{ marginInlineEnd: 0, fontSize: 11 }}>子分区</Tag>}
            <Button
              type="text" size="small" style={{ width: 22, minWidth: 22 }}
              icon={collapsed ? <RightOutlined style={{ fontSize: 10 }} /> : <DownOutlined style={{ fontSize: 10 }} />}
              onClick={onToggleCollapse}
            />
            <Input
              size="small"
              variant="filled"
              value={group.label}
              onChange={(e) => onUpdateGroup({ label: e.target.value })}
              style={{ width: 180, fontWeight: 600 }}
              placeholder="分区名称"
              disabled={hidden || locked}
            />
            <span className="fe-meta">{group.fields.length} 字段</span>
            {hidden && <Tag style={{ marginInlineEnd: 0 }}>标题隐藏</Tag>}
            {pageBreak && <Tag style={{ marginInlineEnd: 0 }}>前分页</Tag>}
            {locked && <Tooltip title="签发/签字栏分区版面固定、内容由接口取号自动填，故不可编辑；可整段删除或在别处添加分区"><Tag color="default" style={{ marginInlineEnd: 0 }}>🔒 签发分区·系统固定</Tag></Tooltip>}
          </div>
        }
        extra={
          <Space size={0}>
            {!locked && (<>
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
                    <Popover trigger="click" placement="bottomRight" title="图片分区版式（统一管本分区所有图位）"
                      overlayInnerStyle={{ maxHeight: '78vh', overflowY: 'auto' }}
                      content={<ImageSectionPanel value={il} onChange={(patch) => onUpdateGroup({ image_layout: { ...il, ...patch } })} />}>
                      <Tooltip title="设置本图片分区的版式：每行几个图位 / 尺寸 / 独立·粘连 / 单数独占 / 标题与备注样式">
                        <Button size="small" type="text" icon={<TableOutlined />}
                          style={group.image_layout ? { color: BRAND } : undefined}>图片版式</Button>
                      </Tooltip>
                    </Popover>
                  );
                }
                return (
                  <Tooltip title="此分区内容已定型（数据表格 / 图片 / 签名），排版自动，无需选择">
                    <span className="fe-meta" style={{ marginInline: 6, color: '#aaa', whiteSpace: 'nowrap' }}>{note}</span>
                  </Tooltip>
                );
              }
              // 「排版」选择器（竖排 / 多列 / 表格）已按需求移除——纯字段分区一律竖排（每行一个字段）。
              // 存量 grid/table 分区仍按存储的 layout 值正常渲染（渲染路径保留），此处不再提供切换入口。
              return null;
            })()}
            <Popover trigger="click" placement="bottomRight" title="本区块格式（覆盖文档默认）"
              overlayInnerStyle={{ maxHeight: '78vh', overflowY: 'auto' }}
              content={
                <div style={{ display: 'flex', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#555' }}>分区标题</div>
                    <FormatPanel variant="text" value={group.title_style}
                      onChange={(title_style) => onUpdateGroup({ title_style })} />
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Tooltip title="分区标题（如「检测结果」）和它下方第一块内容（表格/字段）之间的留白。留空＝默认。">
                        <span style={{ fontSize: 12, color: '#888' }}>标题与内容间距</span>
                      </Tooltip>
                      <InputNumber size="small" style={{ width: 96 }} min={0} max={60} step={1} addonAfter="pt" placeholder="默认"
                        value={group.title_gap ? parseFloat(group.title_gap) : undefined}
                        onChange={(v) => onUpdateGroup({ title_gap: v != null ? `${v}pt` : undefined })} />
                    </div>
                  </div>
                  <div style={{ borderLeft: '1px solid #eee', paddingLeft: 16 }}>
                    {group.section_role === 'images' ? (
                      /* 图片分区：右侧＝图表上方标签 + 图表下方备注（表内标题在「图片版式」里；此处不出通用区块内容） */
                      <ImageSectionNotes value={group.image_layout || {}}
                        onChange={(patch) => onUpdateGroup({ image_layout: { ...(group.image_layout || {}), ...patch } })} />
                    ) : (<>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#555' }}>区块内容</div>
                    <FormatPanel block value={group.style} onChange={(style) => onUpdateGroup({ style })}
                      inheritedFieldGap={docFieldGap} hideFieldGap={editorMode !== 'record'} />
                    {/* 值对齐（标签↔值距离）：覆盖文档级 label_width。仅竖排字段有效（多列本就紧贴）。 */}
                    <div style={{ marginTop: 10 }}>
                      <Tooltip title="字段「名」与「值」之间的距离：跟随文档=用文档统一设置；紧贴=值紧跟标签后无距离;对齐=本区标签占固定宽、各值对齐到同一竖线（仅竖排有效，多列本就紧贴）">
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
                            { label: '紧贴', value: 'tight' },
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
            </Popover>
            {/* 层级调整：「移入子分区」（把顶级分区变成别人的子分区）已按需求移除；
                仅保留存量子分区的「转为顶级分区」展平入口，便于把历史子分区拉回顶级。 */}
            {isSub && (
              <Tooltip title="转为顶级分区">
                <Button size="small" type="text" icon={<ExportOutlined />} onClick={() => onSetParent(undefined)} />
              </Tooltip>
            )}
            </>)}
            {locked && (
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
                  disabled={siblingPos === 0} onClick={() => onMoveGroup(-1)} />
              </Tooltip>
              <Tooltip title={isSub ? '在本父分区内下移' : '下移分区'}>
                <Button size="small" type="text" icon={<ArrowDownOutlined />}
                  disabled={siblingPos === siblingCount - 1} onClick={() => onMoveGroup(1)} />
              </Tooltip>
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={onRemoveGroup} />
            </span>
          </Space>
        }
      >
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
  onSelect, onLabelChange, onOpenFormula, onMoveUp, onMoveDown, onRemove, onDropField,
}: {
  field: FieldDefinition;
  groupIdx: number;
  fieldIdx: number;
  fieldCount: number;
  selected: boolean;
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
      <Input
        size="small"
        variant="borderless"
        value={field.label}
        onChange={(e) => onLabelChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        style={{ flex: '0 1 200px', minWidth: 90, fontWeight: 500, padding: '0 4px' }}
      />
      <span className="fe-meta" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{metaParts}</span>
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
