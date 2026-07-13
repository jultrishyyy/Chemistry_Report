/**
 * 委托单高级搜索栏（录入工作台 TaskList 用）
 *
 * 关键字常驻；其余条件（来源 / 状态 / 接收日期 / 主检 / 审核）可展开。
 * 纯前端过滤（订单整页加载），条件经 filterOrders 应用。
 */
import { Button, Input, Select, DatePicker, Space, Tag } from 'antd';
import { SearchOutlined, ClearOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { type OrderSearchCriteria, isOrderSearchActive } from '../pages/Lab/order-shared';

const STATUS_OPTIONS = [
  { value: 'unlinked', label: '有未关联项目' },
  { value: 'unrecorded', label: '有未录入项目' },
  { value: 'pending', label: '有待审核' },
  { value: 'rejected', label: '有退回' },
  { value: 'reviewed', label: '整单已审核' },
];

export default function OrderSearchBar({ value, onChange, total, shown, statusOptions = STATUS_OPTIONS, keywordPlaceholder = '单号 / 客户 / 样品 / 测试项目', showPeople = true }: {
  value: OrderSearchCriteria;
  onChange: (c: OrderSearchCriteria) => void;
  total: number;
  shown: number;
  /** 状态下拉选项（默认录入侧；报告侧传报告状态选项） */
  statusOptions?: { value: string; label: string }[];
  keywordPlaceholder?: string;
  /** 是否显示「主检人 / 审核人」筛选（报告侧无意义，传 false 隐藏） */
  showPeople?: boolean;
}) {
  const active = isOrderSearchActive(value);
  const set = (patch: Partial<OrderSearchCriteria>) => onChange({ ...value, ...patch });

  return (
    <div style={{ padding: '12px 16px', background: '#fff', border: '1px solid #f0f0f0', borderRadius: 8, marginBottom: 16 }}>
      <Space size={8} wrap>
        <span style={{ fontSize: 12, color: '#888' }}><SearchOutlined /> 搜索</span>
        <Input
          size="small" allowClear style={{ width: 240 }}
          placeholder={keywordPlaceholder}
          value={value.keyword}
          onChange={(e) => set({ keyword: e.target.value })}
        />
        <Select
          size="small" allowClear style={{ width: 150 }}
          placeholder="状态"
          value={value.status}
          onChange={(v) => set({ status: v })}
          options={statusOptions}
        />
        <DatePicker.RangePicker
          size="small" allowEmpty={[true, true]}
          placeholder={['接收日期从', '至']}
          value={value.range ? [
            value.range[0] ? dayjs(value.range[0]) : null,
            value.range[1] ? dayjs(value.range[1]) : null,
          ] as [Dayjs | null, Dayjs | null] : null}
          onChange={(dates) => set({
            range: dates ? [
              dates[0] ? dates[0].startOf('day').toISOString() : null,
              dates[1] ? dates[1].endOf('day').toISOString() : null,
            ] : undefined,
          })}
        />
        {showPeople && (
          <>
            <Input
              size="small" allowClear style={{ width: 130 }}
              placeholder="主检人"
              value={value.tester}
              onChange={(e) => set({ tester: e.target.value })}
            />
            <Input
              size="small" allowClear style={{ width: 130 }}
              placeholder="审核人"
              value={value.reviewer}
              onChange={(e) => set({ reviewer: e.target.value })}
            />
          </>
        )}
        {active && (
          <>
            <Button size="small" icon={<ClearOutlined />} onClick={() => onChange({})}>重置</Button>
            <Tag color="blue" style={{ margin: 0 }}>筛选出 {shown} / {total} 张</Tag>
          </>
        )}
      </Space>
    </div>
  );
}
