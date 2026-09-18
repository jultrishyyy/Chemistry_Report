import { Button, InputNumber, Select, Space, Tooltip } from 'antd';
import { AlignLeftOutlined, AlignCenterOutlined, AlignRightOutlined } from '@ant-design/icons';
import type { FieldDefinition, RecordTemplate } from '../../../../shared/types';
import { coverLegacyFormatState } from '../../../../shared/cover-legacy-format';
import { reportLengthPt } from '../../../../shared/report-body-layout';

/** Edits existing layout properties only; never materializes or rewrites field values. */
export default function CoverQuickLayout({ template, selectedId, readOnly, onSelect, onChange, onConfigure }: {
  template: RecordTemplate; selectedId: string | null; readOnly: boolean;
  onSelect: (id: string) => void; onChange: (patch: Partial<FieldDefinition>) => void; onConfigure: () => void;
}) {
  const group = template.groups.find(group => group.fields.some(field => field.id === selectedId));
  const field = group?.fields.find(field => field.id === selectedId);
  const format = field && group ? coverLegacyFormatState(field, group, template.layout_options?.theme_config, 'paragraph') : null;
  const supported = !!field && group?.layout === 'vertical' && !field.signature_line && !field.rich
    && ['text', 'textarea', 'number', 'date', 'daterange', 'select'].includes(field.type)
    && !field.style?.vertical_align;
  const disabled = readOnly || !supported;
  return <div role="toolbar" aria-label="首页快捷排版" style={{ position: 'sticky', top: 0, zIndex: 5, background: '#eef4fc', border: '1px solid #cedcf0', borderRadius: 8, padding: 10, marginBottom: 12, boxShadow: '0 2px 6px #2030500d' }}>
    <Space size={8} wrap>
      <Select aria-label="选择排版字段" placeholder="选择排版字段" value={field?.id} style={{ width: 200 }} showSearch optionFilterProp="label"
        options={template.groups.flatMap(group => group.fields.map((field, index) => ({ value: field.id, label: `${group.label || '分区'} · ${field.label || `字段 ${index + 1}`}` })))} onChange={onSelect} />
      <Tooltip title={supported ? '只调整该字段整行位置，不改变字段名和值各自的格式' : '请选择普通竖排字段；特殊布局请使用字段设置'}>
        <Space.Compact>{(['left', 'center', 'right'] as const).map((align, index) => <Button key={align} disabled={disabled} aria-label={['整行左对齐', '整行居中', '整行右对齐'][index]} type={supported && format?.align === align ? 'primary' : 'default'} icon={[<AlignLeftOutlined />, <AlignCenterOutlined />, <AlignRightOutlined />][index]} onClick={() => onChange({ style: { ...field?.style, align } })} />)}</Space.Compact>
      </Tooltip>
      {(['space_before', 'space_after'] as const).map((key, index) => <Space key={key} size={4}>
        <span>{index ? '段后' : '段前'}</span>
        <InputNumber aria-label={index ? '字段段后间距' : '字段段前间距'} disabled={disabled} min={0} step={2} precision={1} suffix="pt" style={{ width: 92 }}
          value={supported ? reportLengthPt(field?.style?.[key], 'pt', format?.size) ?? 0 : null}
          onChange={value => { if (value != null && Number.isFinite(value) && value >= 0) onChange({ style: { ...field?.style, [key]: `${value}pt` } }); }} />
      </Space>)}
      <Button disabled={!field} onClick={onConfigure}>字段设置</Button>
    </Space>
  </div>;
}
