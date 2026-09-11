/**
 * BlockConfigPanel — 报告模板编辑器右侧的块配置面板
 * 根据当前选中块的 kind 渲染对应配置 UI
 */
import { Form, InputNumber, Select, Button, Space, Alert } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ReportBlock, CellBinding, RecordTemplate } from '../../../../shared/types';
import BindingEditor from './BindingEditor';
import AutoGrowTextArea from '../AutoGrowTextArea';

interface Props {
  block: ReportBlock | null;
  onChange: (b: ReportBlock) => void;
  /** project 类型编辑器需要的关联记录模板（用于 cell binding） */
  linkedRecord?: RecordTemplate | null;
}

export default function BlockConfigPanel({ block, onChange, linkedRecord }: Props) {
  if (!block) {
    return (
      <div style={{ padding: 24, color: '#888', textAlign: 'center' }}>
        请在左侧选择一个块开始配置
      </div>
    );
  }

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      {block.kind === 'rich_text' && <RichTextConfig block={block} onChange={onChange} />}
      {block.kind === 'cover_meta' && <CoverMetaConfig block={block} onChange={onChange} linkedRecord={linkedRecord} />}
      {block.kind === 'conclusion_table' && <ConclusionTableConfig block={block} onChange={onChange} />}
      {block.kind === 'sample_image_table' && <SampleImageConfig block={block} onChange={onChange} />}
      {block.kind === 'equipment_table' && <EquipmentTableConfig />}
      {block.kind === 'result_table' && <ResultTableConfig block={block} onChange={onChange} linkedRecord={linkedRecord} />}
      {block.kind === 'kv_list' && <KvListConfig block={block} onChange={onChange} linkedRecord={linkedRecord} />}
    </div>
  );
}

// ─── rich_text ─────────────────────────────────────────────────────────
function RichTextConfig({ block, onChange }: { block: Extract<ReportBlock, { kind: 'rich_text' }>; onChange: (b: ReportBlock) => void }) {
  return (
    <Form layout="vertical" size="small">
      <Form.Item label="文本内容" extra="支持普通文字 + 换行；可用作标题或段落">
        <AutoGrowTextArea autoSize={{ minRows: 3, maxRows: 8 }} value={block.html}
          onChange={(e) => onChange({ ...block, html: e.target.value })}
          placeholder="如：本报告依据 GB/T 1040.1-2025 标准对样品进行检测..." />
      </Form.Item>
    </Form>
  );
}

// ─── cover_meta ────────────────────────────────────────────────────────
function CoverMetaConfig({ block, onChange, linkedRecord }: {
  block: Extract<ReportBlock, { kind: 'cover_meta' }>;
  onChange: (b: ReportBlock) => void;
  linkedRecord?: RecordTemplate | null;
}) {
  const updateField = (i: number, patch: { label?: string; binding?: CellBinding }) => {
    const next = [...block.fields];
    next[i] = { ...next[i], ...patch };
    onChange({ ...block, fields: next });
  };
  const removeField = (i: number) => onChange({ ...block, fields: block.fields.filter((_, j) => j !== i) });
  const addField = () => onChange({ ...block, fields: [...block.fields, { label: '新字段', binding: { source: 'literal', text: '' } }] });

  return (
    <Form layout="vertical" size="small">
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="元数据键值对：左列是标签（写死），右列从委托单/系统/原始记录取值。" />
      {block.fields.map((f, i) => (
        <div key={i} style={{ marginBottom: 12, padding: 8, border: '1px solid #e8e8e8', borderRadius: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <AutoGrowTextArea style={{ flex: 1 }} value={f.label}
              onChange={(e) => updateField(i, { label: e.target.value })}
              placeholder="标签（如：报告编号）" />
            <Button danger size="small" icon={<DeleteOutlined />} onClick={() => removeField(i)} />
          </div>
          <BindingEditor value={f.binding} onChange={(b) => updateField(i, { binding: b })}
            linkedRecord={linkedRecord} />
        </div>
      ))}
      <Button type="dashed" icon={<PlusOutlined />} block onClick={addField}>添加字段</Button>
    </Form>
  );
}

// ─── conclusion_table ──────────────────────────────────────────────────
function ConclusionTableConfig({ block, onChange }: { block: Extract<ReportBlock, { kind: 'conclusion_table' }>; onChange: (b: ReportBlock) => void }) {
  const cols = block.columns || ['项目', '标准', '结论'];
  return (
    <Form layout="vertical" size="small">
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="结论汇总表：行数自动 = 报告中包含的项目数；这里只配置列。"
        description="生成报告时系统按当前单号下所有项目报告的'结论行'自动汇集。" />
      <Form.Item label="列定义">
        <Select mode="tags" value={cols} style={{ width: '100%' }}
          onChange={(v) => onChange({ ...block, columns: v })}
          placeholder="输入列名，回车添加（默认：项目 / 标准 / 结论）"
          tokenSeparators={[',', '，']} />
      </Form.Item>
    </Form>
  );
}

// ─── sample_image_table ────────────────────────────────────────────────
function SampleImageConfig({ block, onChange }: { block: Extract<ReportBlock, { kind: 'sample_image_table' }>; onChange: (b: ReportBlock) => void }) {
  return (
    <Form layout="vertical" size="small">
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="样品图片表：固定行列，单元格按顺序填入原始记录中的 image 字段值。" />
      <Form.Item label="每行图片数">
        <InputNumber min={1} max={4} value={block.columns}
          onChange={(v) => onChange({ ...block, columns: v ?? 2 })} />
      </Form.Item>
      <Form.Item label="行数">
        <InputNumber min={1} max={6} value={block.rows}
          onChange={(v) => onChange({ ...block, rows: v ?? 2 })} />
      </Form.Item>
    </Form>
  );
}

// ─── equipment_table ───────────────────────────────────────────────────
function EquipmentTableConfig() {
  return (
    <Alert type="info" showIcon
      message="设备汇总表（无需配置）"
      description="生成报告时，系统会自动遍历单号下所有原始记录的设备引用字段，按管理编号查询设备库，汇总为「设备名称 / 设备型号 / 设备编号 / 校准有效期」。校准有效期格式：溯源日期 ~ 到期日期。缺日期的设备不填入但会顶部告警。" />
  );
}

// ─── result_table ──────────────────────────────────────────────────────
function ResultTableConfig({ block, onChange, linkedRecord }: {
  block: Extract<ReportBlock, { kind: 'result_table' }>;
  onChange: (b: ReportBlock) => void;
  linkedRecord?: RecordTemplate | null;
}) {
  const cols = block.columns;
  const rows = block.rows;
  const cells = block.cells;

  const findCell = (rowId: string, colId: string) => cells.find(c => c.rowId === rowId && c.colId === colId);

  const updateCell = (rowId: string, colId: string, binding: CellBinding) => {
    const idx = cells.findIndex(c => c.rowId === rowId && c.colId === colId);
    const next = [...cells];
    if (idx >= 0) next[idx] = { rowId, colId, binding };
    else next.push({ rowId, colId, binding });
    onChange({ ...block, cells: next });
  };

  const addColumn = () => {
    const id = `c_${Date.now()}`;
    onChange({ ...block, columns: [...cols, { id, label: `列${cols.length + 1}` }] });
  };
  const removeColumn = (id: string) => {
    onChange({ ...block, columns: cols.filter(c => c.id !== id), cells: cells.filter(c => c.colId !== id) });
  };
  const renameColumn = (id: string, label: string) => {
    onChange({ ...block, columns: cols.map(c => c.id === id ? { ...c, label } : c) });
  };
  const addRow = () => {
    const id = `r_${Date.now()}`;
    onChange({ ...block, rows: [...rows, { id, label: '' }] });
  };
  const removeRow = (id: string) => {
    onChange({ ...block, rows: rows.filter(r => r.id !== id), cells: cells.filter(c => c.rowId !== id) });
  };
  const renameRow = (id: string, label: string) => {
    onChange({ ...block, rows: rows.map(r => r.id === id ? { ...r, label } : r) });
  };

  return (
    <div>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="结果表（画布式）"
        description={linkedRecord
          ? `已关联到原始记录模板「${linkedRecord.name}」，每个单元格可绑定到该模板的字段或矩阵单元。`
          : '请先在顶部选择"关联的原始记录模板"，再来配置每个格子。'} />

      <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
        <thead>
          <tr>
            <th style={th}>行 \ 列</th>
            {cols.map(c => (
              <th key={c.id} style={th}>
                <AutoGrowTextArea size="small" style={{ width: 120, marginBottom: 4 }} value={c.label}
                  onChange={(e) => renameColumn(c.id, e.target.value)} />
                <Button size="small" type="link" danger icon={<DeleteOutlined />}
                  onClick={() => removeColumn(c.id)} />
              </th>
            ))}
            <th style={th}>
              <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addColumn}>列</Button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td style={td}>
                <AutoGrowTextArea size="small" placeholder="行标签" value={r.label || ''}
                  onChange={(e) => renameRow(r.id, e.target.value)} style={{ width: 100 }} />
                <Button size="small" type="link" danger icon={<DeleteOutlined />}
                  onClick={() => removeRow(r.id)} />
              </td>
              {cols.map(c => (
                <td key={c.id} style={td}>
                  <BindingEditor
                    compact
                    value={findCell(r.id, c.id)?.binding || { source: 'literal', text: '' }}
                    onChange={(b) => updateCell(r.id, c.id, b)}
                    linkedRecord={linkedRecord}
                  />
                </td>
              ))}
              <td style={td} />
            </tr>
          ))}
          <tr>
            <td colSpan={cols.length + 2} style={{ ...td, textAlign: 'center', background: '#fafafa' }}>
              <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addRow}>+ 添加行</Button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── kv_list ───────────────────────────────────────────────────────────
function KvListConfig({ block, onChange, linkedRecord }: {
  block: Extract<ReportBlock, { kind: 'kv_list' }>;
  onChange: (b: ReportBlock) => void;
  linkedRecord?: RecordTemplate | null;
}) {
  const updateItem = (i: number, patch: { label?: string; binding?: CellBinding }) => {
    const next = [...block.items];
    next[i] = { ...next[i], ...patch };
    onChange({ ...block, items: next });
  };
  const remove = (i: number) => onChange({ ...block, items: block.items.filter((_, j) => j !== i) });
  const add = () => onChange({ ...block, items: [...block.items, { label: '新字段', binding: { source: 'literal', text: '' } }] });

  return (
    <Form layout="vertical" size="small">
      {block.items.map((it, i) => (
        <div key={i} style={{ marginBottom: 12, padding: 8, border: '1px solid #e8e8e8', borderRadius: 4 }}>
          <Space style={{ width: '100%', marginBottom: 8 }}>
            <AutoGrowTextArea value={it.label} onChange={(e) => updateItem(i, { label: e.target.value })}
              placeholder="标签" style={{ width: 200 }} />
            <Button danger size="small" icon={<DeleteOutlined />} onClick={() => remove(i)} />
          </Space>
          <BindingEditor value={it.binding} onChange={(b) => updateItem(i, { binding: b })}
            linkedRecord={linkedRecord} />
        </div>
      ))}
      <Button type="dashed" icon={<PlusOutlined />} block onClick={add}>添加键值</Button>
    </Form>
  );
}

const th: React.CSSProperties = { border: '1px solid #ddd', padding: 6, background: '#fafafa', fontWeight: 'normal' };
const td: React.CSSProperties = { border: '1px solid #ddd', padding: 6, verticalAlign: 'top' };
