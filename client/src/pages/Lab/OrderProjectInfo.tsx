import { Button, Collapse, Popover, Space, Tag, Tooltip } from 'antd';
import { ProfileOutlined } from '@ant-design/icons';
import type { Sample, TestInfo } from './order-shared';

const PROJECT_FIELDS: Array<{ key: keyof TestInfo; label: string }> = [
  { key: 'main_engine_factory', label: '主机厂' },
  { key: 'standard', label: '标准号' },
  { key: 'test_method', label: '测试方法' },
  { key: 'test_condition', label: '测试条件' },
  { key: 'sampling_mode', label: '制样方式' },
  { key: 'sampling_requirement', label: '制样要求' },
  { key: 'limit_name', label: '限值名称（牌号）' },
  { key: 'limit_content', label: '限值内容' },
  { key: 'leader', label: '分单负责人' },
  { key: 'start_date', label: '开始测试日期' },
  { key: 'end_date', label: '结束测试日期' },
  { key: 'remark', label: '制样备注' },
  { key: 'sample_description', label: '样品描述' },
  { key: 'test_remark', label: '检测备注' },
  { key: 'material_uploader', label: '分单人' },
];

const displayValue = (value: unknown) => {
  if (value === null || value === undefined || String(value).trim() === '') return '—';
  return String(value);
};

export function ProjectInfoGrid({ test }: { test: TestInfo }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
      gap: '8px 18px', padding: '2px 0 4px',
    }}>
      {PROJECT_FIELDS.map(field => {
        const value = test[field.key];
        const empty = value === null || value === undefined || String(value).trim() === '';
        return (
          <div key={field.key} style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: '#8a93a3', marginBottom: 2 }}>{field.label}</div>
            <div style={{
              fontSize: 12, color: empty ? '#b0b7c3' : '#273142',
              whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.5,
            }}>{displayValue(value)}</div>
          </div>
        );
      })}
    </div>
  );
}

function populatedCount(test: TestInfo) {
  return PROJECT_FIELDS.filter(field => {
    const value = test[field.key];
    return value !== null && value !== undefined && String(value).trim() !== '';
  }).length;
}

/** 订单详情表格内：浮层查看分单信息，不参与表格行高计算。 */
export function ProjectInfoInline({ test }: { test: TestInfo }) {
  const count = populatedCount(test);
  return (
    <div onClick={event => event.stopPropagation()}>
      <Tooltip title={`查看分单信息（${count} 项有值）`}>
        <Popover trigger="click" placement="bottomLeft"
          content={(
            <div style={{ width: 'min(680px, calc(100vw - 72px))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingBottom: 9, marginBottom: 9, borderBottom: '1px solid #dce3ed' }}>
                <ProfileOutlined style={{ color: '#1677ff' }} />
                <strong style={{ color: '#273142' }}>分单信息</strong>
                <Tag bordered={false} color={count ? 'blue' : 'default'} style={{ margin: 0 }}>{count} 项有值</Tag>
                <span style={{ marginLeft: 'auto', color: '#8a93a3', fontSize: 12 }}>{test.name}</span>
              </div>
              <div style={{ maxHeight: 'min(460px, calc(100vh - 180px))', overflowY: 'auto', paddingRight: 6 }}>
                <ProjectInfoGrid test={test} />
              </div>
            </div>
          )}>
          <Button size="small" type="text" shape="circle" icon={<ProfileOutlined />}
            aria-label={`查看 ${test.name} 的分单信息`}
            style={{ color: '#476b96', background: '#f1f6fc', border: '1px solid #d9e6f5' }} />
        </Popover>
      </Tooltip>
    </div>
  );
}

/** 数据录入页：当前样品 × 项目的分单上下文卡片，默认收起。 */
export function RecordOrderContextCard({ sample, test }: { sample: Sample; test: TestInfo }) {
  const sampleNo = sample.sort_no || sample.id;
  return (
    <Collapse size="small" style={{ borderColor: '#c9d8ef', background: '#f8fbff' }}
      items={[{
        key: 'order-context',
        label: (
          <Space size={7} wrap>
            <ProfileOutlined style={{ color: '#1677ff' }} />
            <strong style={{ color: '#234a75' }}>分单信息</strong>
            <Tag style={{ margin: 0 }}>样品编号：{sampleNo}</Tag>
            <Tag style={{ margin: 0 }}>{sample.name}</Tag>
            <Tag color="blue" style={{ margin: 0 }}>{test.name}</Tag>
          </Space>
        ),
        children: (
          <div style={{ maxHeight: 'min(440px, calc(100vh - 250px))', overflowY: 'auto', paddingRight: 6 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginBottom: 12, fontSize: 12 }}>
              <span><span style={{ color: '#8a93a3' }}>样品编号：</span>{displayValue(sample.sort_no || sample.id)}</span>
              <span><span style={{ color: '#8a93a3' }}>样品名称：</span>{displayValue(sample.name)}</span>
              <span><span style={{ color: '#8a93a3' }}>样品条码：</span>{displayValue(sample.barcode)}</span>
              <span><span style={{ color: '#8a93a3' }}>型号：</span>{displayValue(sample.model)}</span>
            </div>
            <ProjectInfoGrid test={test} />
          </div>
        ),
      }]} />
  );
}
