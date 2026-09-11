/**
 * 模板列表高级搜索栏（RecordTemplate/List 与 ReportTemplate/List 共用）
 *
 * 条件常驻显示：关键字 / 状态 / 修改人 / 最近修改时间范围 / 母子范围。
 * 纯前端过滤（列表数据已整页加载），条件经 applyTemplateSearch 应用。
 */
import { Button, Input, Select, DatePicker, Space } from 'antd';
import { SearchOutlined, ClearOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { isSearchActive, type TemplateSearchCriteria } from './template-tree';

const STATUS_OPTIONS = [
  { value: 'approved', label: '已生效（无未定稿）' },
  { value: 'draft', label: '有草稿' },
  { value: 'pending', label: '待审核' },
  { value: 'rejected', label: '已退回' },
];

export default function TemplateSearchBar({ value, onChange, mergePeopleIntoKeyword = false, includeLinkedRecordInKeyword = false }: {
  value: TemplateSearchCriteria;
  onChange: (c: TemplateSearchCriteria) => void;
  /** 将修改人/审核人并入关键词，隐藏单独的修改人输入框。 */
  mergePeopleIntoKeyword?: boolean;
  /** 报告模板页：关键词同时匹配关联原始记录名称及其对应项目。 */
  includeLinkedRecordInKeyword?: boolean;
}) {
  const active = isSearchActive(value);
  const set = (patch: Partial<TemplateSearchCriteria>) => onChange({ ...value, ...patch });

  return (
    <Space size={8} wrap>
      <span style={{ fontSize: 12, color: '#888' }}><SearchOutlined /> 搜索</span>
      <Input
        size="small" allowClear style={{ width: includeLinkedRecordInKeyword ? 260 : mergePeopleIntoKeyword ? 220 : 180 }}
        placeholder={includeLinkedRecordInKeyword
          ? '名称 / 项目 / 原始记录 / 人员'
          : mergePeopleIntoKeyword ? '名称 / 项目 / 修改人 / 审核人' : '名称 / 项目名称 关键字'}
        value={value.keyword}
        onChange={(e) => set({ keyword: e.target.value })}
      />
      <Select
        size="small" allowClear style={{ width: 135 }}
        placeholder="状态"
        value={value.status}
        onChange={(v) => set({ status: v })}
        options={STATUS_OPTIONS}
      />
      {!mergePeopleIntoKeyword && (
        <Input
          size="small" allowClear style={{ width: 120 }}
          placeholder="修改人"
          value={value.author}
          onChange={(e) => set({ author: e.target.value })}
        />
      )}
      <DatePicker.RangePicker
        size="small" allowEmpty={[true, true]}
        style={{ width: 220 }}
        placeholder={['修改时间从', '至']}
        value={value.range ? [
          value.range[0] ? dayjs(value.range[0]) : null,
          value.range[1] ? dayjs(value.range[1]) : null,
        ] as [Dayjs | null, Dayjs | null] : null}
        onChange={(dates) => set({
          range: dates ? [
            dates[0] ? dates[0].startOf('day').toISOString() : null,
            dates[1] ? dates[1].endOf('day').toISOString() : null,
          ] : null,
        })}
      />
      <Select
        size="small" allowClear style={{ width: 110 }}
        placeholder="母子范围"
        value={value.scope}
        onChange={(v) => set({ scope: v })}
        options={[
          { value: 'parent', label: '仅母模板' },
          { value: 'child', label: '仅子模板' },
        ]}
      />
      {active && (
        <Button size="small" icon={<ClearOutlined />} onClick={() => onChange({})}>重置</Button>
      )}
    </Space>
  );
}
