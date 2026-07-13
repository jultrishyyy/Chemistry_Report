/**
 * HeaderConfigCard — 统一表头配置卡片（右键任意表头弹出）。
 *
 * 统一表头模型：四类表头（参数列 / 试样行 / 汇总行 / 汇总列）共用同一交互——
 *   双击表头 = 直接改标题；右键 = 本卡片，可编辑：
 *   - 标题
 *   - 分组表头（仅参数列：多级表头是列向合并，行/汇总表头无此概念）
 *   - 备注（可选）：以小括号显示在表头里，可固定（如单位），也可配「录入时可选」
 *     选项（如 客户要求/标准要求），实验员录入时从下拉选
 *   - 默认值（参数列=该列所有格初始值；录入型汇总行=初始内容）
 *   - 底部操作区（插入/删除/设公式等，由调用方传入）
 * 编码 (code) 由系统自动生成并保证唯一，不在任何 UI 暴露。
 */
import { useEffect, useState } from 'react';
import { Popover, Form, Input, InputNumber, Switch, Select as AntSelect, Button, Space, Divider, Segmented } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import type { CellBinding, RecordTemplate } from '../../../../../shared/types';
import BindingPickerModal, { BindingSummary } from '../../ReportEditor/BindingPickerModal';

/** 卡片操作的通用表头形状；调用方负责映射到各自的存储字段（如参数列的 unit*） */
export interface HeaderCfgValue {
  label: string;
  group?: string;
  /** 单位（独立于备注的括号文字，仅 showUnit 时编辑；报告动态结果表用，缺省继承镜像矩阵列） */
  unit?: string;
  note?: string;
  note_options?: string[];
  note_allow_custom?: boolean;
  default_value?: string;
  /** 手填数字的显示小数位（仅数字矩阵参数列） */
  decimals?: number;
  /** P-Map-11b：表头三槽位的取值绑定（有绑定时渲染优先于静态文字）。仅 allowBinding 时编辑。 */
  label_binding?: CellBinding;
  unit_binding?: CellBinding;
  note_binding?: CellBinding;
}

interface Props {
  title: string;
  value: HeaderCfgValue;
  /** 显示「分组表头」输入（仅参数列） */
  showGroup?: boolean;
  /** 备注仅固定文字模式（隐藏「录入时可选」档）：用于报告表等无录入场景，备注是纯展示文本 */
  noteFixedOnly?: boolean;
  /** 显示「单位」输入（独立于备注；报告动态结果表用，留空＝继承镜像矩阵列单位） */
  showUnit?: boolean;
  /** 单位输入占位（如继承的矩阵列单位） */
  unitPlaceholder?: string;
  /** 标题输入占位（如继承的矩阵列名） */
  labelPlaceholder?: string;
  /** 显示「默认值」：true=文本输入；'choice'=从 defaultChoices 下拉选 */
  showDefault?: boolean | 'choice';
  defaultChoices?: string[];
  /** 显示「小数位」（数字矩阵的参数列） */
  showDecimals?: boolean;
  /** P-Map-11b：允许把表头标题/单位/备注绑定到数据来源（结果表用）。需传 linkedRecord。 */
  allowBinding?: boolean;
  linkedRecord?: RecordTemplate | null;
  /** 表头绑定弹窗暴露的来源白名单（缺省＝结果表来源集） */
  bindingSources?: string[];
  /** 点击卡片以外区域即关闭（报告结果表用；数据矩阵编辑器因有公式/符号浮层故不开，保持受控）。 */
  closeOnOutsideClick?: boolean;
  open: boolean;
  onClose: () => void;
  onSave: (patch: HeaderCfgValue) => void;
  /** 底部操作按钮（插入行列 / 设公式 / 删除等），点击后自动关卡片 */
  actions?: { key: string; label: string; danger?: boolean; onClick: () => void }[];
  /** 卡片弹出内容里的额外控件（如列宽/行高旋钮）——渲染在表单内、确定按钮上方，而非常显表头上 */
  extra?: React.ReactNode;
  children: React.ReactNode;
}

const DEFAULT_BINDING_SOURCES = ['literal', 'record_field', 'record_cell', 'record_summary', 'record_header'];

export default function HeaderConfigCard({
  title, value, showGroup, noteFixedOnly, showUnit, unitPlaceholder, labelPlaceholder, showDefault, defaultChoices, showDecimals, allowBinding, linkedRecord, bindingSources, closeOnOutsideClick, open, onClose, onSave, actions, extra, children,
}: Props) {
  type NoteMode = 'none' | 'fixed' | 'options';
  const initNoteMode = (): NoteMode =>
    value.note_options?.length ? 'options' : value.note ? 'fixed' : 'none';

  const [label, setLabel] = useState(value.label);
  const [group, setGroup] = useState(value.group || '');
  const [unit, setUnit] = useState(value.unit || '');
  const [noteMode, setNoteMode] = useState<NoteMode>(initNoteMode());
  const [note, setNote] = useState(value.note || '');
  const [noteOptions, setNoteOptions] = useState<string[]>(value.note_options || []);
  const [allowCustom, setAllowCustom] = useState(!!value.note_allow_custom);
  const [defaultValue, setDefaultValue] = useState(value.default_value || '');
  const [decimals, setDecimals] = useState<number | undefined>(value.decimals);
  // P-Map-11b：表头三槽位绑定
  const [labelBinding, setLabelBinding] = useState<CellBinding | undefined>(value.label_binding);
  const [unitBinding, setUnitBinding] = useState<CellBinding | undefined>(value.unit_binding);
  const [noteBinding, setNoteBinding] = useState<CellBinding | undefined>(value.note_binding);
  const [bindSlot, setBindSlot] = useState<'label' | 'unit' | 'note' | null>(null);

  // 每次打开时从最新 props 重置（避免上次未保存的编辑残留）
  useEffect(() => {
    if (!open) return;
    setLabel(value.label);
    setGroup(value.group || '');
    setUnit(value.unit || '');
    setNoteMode(initNoteMode());
    setNote(value.note || '');
    setNoteOptions(value.note_options || []);
    setAllowCustom(!!value.note_allow_custom);
    setDefaultValue(value.default_value || '');
    setDecimals(value.decimals);
    setLabelBinding(value.label_binding);
    setUnitBinding(value.unit_binding);
    setNoteBinding(value.note_binding);
    setBindSlot(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 打开时支持 Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // closeOnOutsideClick：点卡片以外即关闭（忽略卡片内容、嵌套的绑定弹窗/下拉等 antd 浮层）。
  // 延迟一帧再挂监听，避免捕获到"打开卡片的那一次点击"本身。
  useEffect(() => {
    if (!open || !closeOnOutsideClick) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-headercard="1"]')) return;        // 卡片内容
      if (t.closest('.ant-modal-root, .ant-select-dropdown, .ant-picker-dropdown, .ant-popover, .ant-tooltip')) return; // 嵌套浮层
      onClose();
    };
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { window.clearTimeout(id); document.removeEventListener('mousedown', onDown); };
  }, [open, closeOnOutsideClick, onClose]);

  const handleSave = () => {
    const patch: HeaderCfgValue = { label };
    if (showGroup) patch.group = group.trim() || undefined;
    if (showUnit) patch.unit = unit.trim() || undefined;
    if (noteFixedOnly) {
      patch.note = note.trim() || undefined;
      patch.note_options = undefined;
      patch.note_allow_custom = undefined;
    } else {
      patch.note = noteMode === 'fixed' ? (note.trim() || undefined) : undefined;
      patch.note_options = noteMode === 'options' && noteOptions.length ? noteOptions : undefined;
      patch.note_allow_custom = noteMode === 'options' && noteOptions.length && allowCustom ? true : undefined;
    }
    if (showDefault) patch.default_value = defaultValue !== '' ? defaultValue : undefined;
    if (showDecimals) patch.decimals = decimals ?? undefined;
    if (allowBinding) {
      patch.label_binding = labelBinding;
      patch.unit_binding = unitBinding;
      patch.note_binding = noteBinding;
    }
    onSave(patch);
    onClose();
  };

  // P-Map-11b：一个表头槽位的"绑定 / 清除"控件
  const SlotBindRow = ({ slot, slotLabel, binding, set }: {
    slot: 'label' | 'unit' | 'note'; slotLabel: string; binding?: CellBinding; set: (b?: CellBinding) => void;
  }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <span style={{ width: 32, fontSize: 12, color: '#555' }}>{slotLabel}</span>
      <span style={{ flex: 1, fontSize: 11, minWidth: 0, overflow: 'hidden' }}>
        {binding ? <BindingSummary value={binding} linkedRecord={linkedRecord} /> : <span style={{ color: '#bbb' }}>静态文字</span>}
      </span>
      <Button size="small" type="link" style={{ padding: '0 4px' }} onClick={() => setBindSlot(slot)}>{binding ? '改' : '绑定'}</Button>
      {binding && <Button size="small" type="link" danger style={{ padding: '0 4px' }} onClick={() => set(undefined)}>清</Button>}
    </div>
  );
  const slotBindingOf = (s: 'label' | 'unit' | 'note') => s === 'label' ? labelBinding : s === 'unit' ? unitBinding : noteBinding;
  const setSlotBinding = (s: 'label' | 'unit' | 'note', b?: CellBinding) =>
    (s === 'label' ? setLabelBinding : s === 'unit' ? setUnitBinding : setNoteBinding)(b);

  const content = (
    <div data-headercard="1" style={{ width: 290 }} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
      <Form layout="vertical" size="small">
        <Form.Item label="标题" style={{ marginBottom: 10 }}>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={labelPlaceholder || '显示名称'} />
        </Form.Item>
        {showGroup && (
          <Form.Item label="分组表头" style={{ marginBottom: 10 }}
            tooltip="多级表头：相邻、填了同一个分组名的列，会在 PDF 表头合并到这个上层标题下。留空 = 不分组">
            <Input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="留空 = 不分组" />
          </Form.Item>
        )}
        {showUnit && (
          <Form.Item label="单位" style={{ marginBottom: 10 }}
            tooltip="以小括号显示在表头文字后。留空 = 继承镜像数据矩阵该列的单位">
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={unitPlaceholder || '留空 = 继承矩阵列'} />
          </Form.Item>
        )}
        <Form.Item label="备注" style={{ marginBottom: 10 }}
          tooltip={noteFixedOnly
            ? '以小括号显示在表头文字后，如「长度 (mm)」。报告表是展示型、无录入，故为固定文字。'
            : '以小括号显示在表头文字后，如「测量值 (mm)」。可以是固定文字（如单位），也可以配几个选项让实验员录入时选（如 客户要求 / 标准要求）'}>
          {noteFixedOnly ? (
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如 mm / 客户要求（留空 = 无）" />
          ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={6}>
            <Segmented
              size="small"
              value={noteMode}
              onChange={(v) => {
                const m = v as NoteMode;
                setNoteMode(m);
                if (m === 'options' && !noteOptions.length && note) setNoteOptions([note]);
              }}
              options={[
                { label: '无', value: 'none' },
                { label: '固定文字', value: 'fixed' },
                { label: '录入时可选', value: 'options' },
              ]}
            />
            {noteMode === 'fixed' && (
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如 ℃ / mm" />
            )}
            {noteMode === 'options' && (
              <>
                <AntSelect mode="tags" style={{ width: '100%' }} value={noteOptions}
                  onChange={(v) => setNoteOptions(v)} placeholder="输入选项，回车添加"
                  tokenSeparators={[',', '，']} />
                <Space size={4}>
                  <Switch size="small" checked={allowCustom} onChange={setAllowCustom} />
                  <span style={{ fontSize: 11, color: '#888' }}>实验员也可以填选项之外的内容</span>
                </Space>
              </>
            )}
          </Space>
          )}
        </Form.Item>
        {showDecimals && (
          <Form.Item label="小数位" style={{ marginBottom: 10 }}
            tooltip="本列手填数字在 PDF 上按此位数四舍五入并补零（如 2 位：1.5 → 1.50）。公式仍按原始输入计算，不损失精度；留空 = 按录入原样显示。公式列请在公式里设小数位">
            <InputNumber min={0} max={6} style={{ width: 140 }} value={decimals}
              onChange={(v) => setDecimals(v === null ? undefined : v)} placeholder="留空 = 原样" addonAfter="位" />
          </Form.Item>
        )}
        {showDefault && (
          <Form.Item label="默认值" style={{ marginBottom: 10 }}
            tooltip="录入页打开时预填的初始值，实验员可修改。留空 = 无默认值">
            {showDefault === 'choice' ? (
              <AntSelect allowClear style={{ width: '100%' }} value={defaultValue || undefined}
                onChange={(v) => setDefaultValue(v || '')}
                placeholder="从选项中选默认值"
                options={(defaultChoices || []).map(o => ({ value: o, label: o }))} />
            ) : (
              <Input value={defaultValue} onChange={(e) => setDefaultValue(e.target.value)} placeholder="留空 = 无默认值" />
            )}
          </Form.Item>
        )}
      </Form>
      {allowBinding && (
        <>
          <Divider style={{ margin: '4px 0 8px' }}>表头随录入变化（可选）</Divider>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 6, lineHeight: 1.5 }}>
            默认表头就是上面填的固定文字。如果某项<b>需要跟着录入/数据变</b>（如单位「mm/min 还是 cm/min」、要求「客户要求 / 标准要求」是录入时选的），点「绑定」指到原始记录里的来源——之后这项会显示那个录入值，忽略上面的固定文字。
          </div>
          <SlotBindRow slot="label" slotLabel="标题" binding={labelBinding} set={setLabelBinding} />
          {showUnit && <SlotBindRow slot="unit" slotLabel="单位" binding={unitBinding} set={setUnitBinding} />}
          <SlotBindRow slot="note" slotLabel="备注" binding={noteBinding} set={setNoteBinding} />
        </>
      )}
      {extra && <div style={{ marginTop: 8 }}>{extra}</div>}
      <Space style={{ marginTop: 8 }}>
        <Button type="primary" size="small" icon={<CheckOutlined />} onClick={handleSave}>确定</Button>
        <Button size="small" onClick={onClose}>取消</Button>
      </Space>
      {actions && actions.length > 0 && (
        <>
          <Divider style={{ margin: '8px 0' }} />
          <Space wrap size={4}>
            {actions.map(a => (
              <Button key={a.key} size="small" danger={a.danger}
                onClick={() => { a.onClick(); onClose(); }}>{a.label}</Button>
            ))}
          </Space>
        </>
      )}
    </div>
  );

  return (
    <>
    {allowBinding && (
      <BindingPickerModal
        open={bindSlot !== null}
        value={(bindSlot && slotBindingOf(bindSlot)) || { source: 'literal', text: '' }}
        linkedRecord={linkedRecord ?? null}
        allowedSources={bindingSources || DEFAULT_BINDING_SOURCES}
        title={`表头${bindSlot === 'unit' ? '单位' : bindSlot === 'note' ? '备注' : '标题'} · 选择数据来源`}
        onChange={(b) => { if (bindSlot) setSlotBinding(bindSlot, b); }}
        onClose={() => setBindSlot(null)}
      />
    )}
    <Popover
      content={content}
      title={title}
      // 受控显示：仅由双击表头打开、确定/取消/底部操作/Esc/切换到别的表头关闭。
      // trigger={[]} + 无 onOpenChange ⇒ 完全受控，不随 hover/外部点击开关——
      // 否则点右下角公式/符号选择面板时卡片会误关（本次修复点）。
      trigger={[]}
      open={open}
      placement="bottom"
      destroyTooltipOnHide
    >
      {children}
    </Popover>
    </>
  );
}
