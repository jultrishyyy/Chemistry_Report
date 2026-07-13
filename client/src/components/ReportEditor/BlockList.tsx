/**
 * BlockList — 报告模板编辑器的左侧块列表
 * 支持：增加块、删除块、上下移动顺序、点击选中
 */
import { Button, Dropdown, Tag } from 'antd';
import { PlusOutlined, DeleteOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import type { ReportBlock } from '../../../../shared/types';

const BLOCK_LABELS: Record<ReportBlock['kind'], string> = {
  rich_text: '富文本',
  cover_meta: '元数据键值对',
  conclusion_table: '结论汇总表',
  sample_image_table: '样品图片表',
  equipment_table: '设备汇总表',
  result_table: '结果表',
  kv_list: '键值对列表',
};

interface Props {
  blocks: ReportBlock[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChange: (blocks: ReportBlock[]) => void;
  /** 允许添加的 block 类型集合（cover 与 project 不同） */
  allowedKinds: ReportBlock['kind'][];
}

export default function BlockList({ blocks, selectedId, onSelect, onChange, allowedKinds }: Props) {
  const addBlock = (kind: ReportBlock['kind']) => {
    const id = `b_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let newBlock: ReportBlock;
    switch (kind) {
      case 'rich_text':
        newBlock = { id, kind, html: '' }; break;
      case 'cover_meta':
        newBlock = { id, kind, fields: [
          { label: '报告编号', binding: { source: 'order', key: 'order_no' } },
          { label: '委托方', binding: { source: 'order', key: 'customer_name' } },
          { label: '样品名称', binding: { source: 'order', key: 'sample_name' } },
          { label: '检验日期', binding: { source: 'system', key: 'today' } },
        ]}; break;
      case 'conclusion_table':
        newBlock = { id, kind, columns: ['项目', '标准', '结论'] }; break;
      case 'sample_image_table':
        newBlock = { id, kind, columns: 2, rows: 2 }; break;
      case 'equipment_table':
        newBlock = { id, kind }; break;
      case 'result_table':
        newBlock = { id, kind, columns: [
          { id: 'col_label', label: '项目' },
          { id: 'col_result', label: '结果' },
        ], rows: [
          { id: 'r1', label: '示例行' },
        ], cells: [] }; break;
      case 'kv_list':
        newBlock = { id, kind, items: [] }; break;
    }
    onChange([...blocks, newBlock]);
    onSelect(id);
  };

  const remove = (id: string) => {
    onChange(blocks.filter(b => b.id !== id));
    if (selectedId === id) onSelect(blocks[0]?.id ?? '');
  };

  const move = (id: string, dir: -1 | 1) => {
    const idx = blocks.findIndex(b => b.id === id);
    if (idx < 0) return;
    const next = [...blocks];
    const target = idx + dir;
    if (target < 0 || target >= blocks.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  };

  const addItems = allowedKinds.map(k => ({
    key: k,
    label: BLOCK_LABELS[k],
    onClick: () => addBlock(k),
  }));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>
        <Dropdown menu={{ items: addItems }} trigger={['click']}>
          <Button type="primary" icon={<PlusOutlined />} block>添加块</Button>
        </Dropdown>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {blocks.length === 0 && (
          <div style={{ color: '#aaa', textAlign: 'center', padding: 20, fontSize: 12 }}>
            暂无块，点上方"添加块"开始
          </div>
        )}
        {blocks.map((b, i) => {
          const active = b.id === selectedId;
          return (
            <div key={b.id}
              style={{
                padding: '8px 10px',
                marginBottom: 4,
                border: active ? '2px solid #1677ff' : '1px solid #e0e0e0',
                borderRadius: 4,
                background: active ? '#e6f4ff' : '#fff',
                cursor: 'pointer',
              }}
              onClick={() => onSelect(b.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Tag color="blue" style={{ margin: 0 }}>{i + 1}</Tag>
                <strong style={{ fontSize: 12, flex: 1 }}>{BLOCK_LABELS[b.kind]}</strong>
                <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={i === 0}
                  onClick={(e) => { e.stopPropagation(); move(b.id, -1); }} />
                <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={i === blocks.length - 1}
                  onClick={(e) => { e.stopPropagation(); move(b.id, 1); }} />
                <Button size="small" type="text" danger icon={<DeleteOutlined />}
                  onClick={(e) => { e.stopPropagation(); remove(b.id); }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
