import { useState } from 'react';
import { Card, Select, Button, Tag, Space, Modal, Progress } from 'antd';
import { LinkOutlined, ThunderboltOutlined } from '@ant-design/icons';
import FormulaEditor from '../FormulaEditor';
import type { Formula } from '../../../../shared/formula-engine';
import AutoGrowTextArea from '../AutoGrowTextArea';

export interface MappingItem {
  placeholder: string;
  source_type: string;
  source_field_code?: string;
  literal_value?: string;
  formula?: Formula;
  transform?: string;
}

interface FieldMappingEditorProps {
  placeholders: string[];
  mappings: MappingItem[];
  availableFields: { code: string; label: string; group: string }[];
  onChange: (mappings: MappingItem[]) => void;
}

const SOURCE_TYPES = [
  { value: 'record_data', label: '实验数据' },
  { value: 'order', label: '委托单字段' },
  { value: 'sample', label: '样品字段' },
  { value: 'system', label: '系统字段' },
  { value: 'literal', label: '固定值' },
  { value: 'computed', label: '计算公式' },
];
const friendlyPlaceholder = (value: string) => /^(field|fld|item|cell)_[a-z0-9_-]+$/i.test(value)
  ? '未命名报告数据项' : value;

export default function FieldMappingEditor({ placeholders, mappings, availableFields, onChange }: FieldMappingEditorProps) {
  const [editingPlaceholder, setEditingPlaceholder] = useState<string | null>(null);
  const [formulaPlaceholder, setFormulaPlaceholder] = useState<string | null>(null);

  const mappingMap = new Map(mappings.map(m => [m.placeholder, m]));
  const configured = mappings.filter(m => m.source_type).length;

  const updateMapping = (placeholder: string, patch: Partial<MappingItem>) => {
    const existing = mappingMap.get(placeholder);
    const updated: MappingItem = { placeholder, source_type: 'record_data', ...existing, ...patch };
    const newMappings = mappings.filter(m => m.placeholder !== placeholder);
    newMappings.push(updated);
    onChange(newMappings);
  };

  const autoMatch = () => {
    const newMappings = [...mappings];
    for (const ph of placeholders) {
      if (mappingMap.has(ph)) continue;
      const match = availableFields.find(f => f.code === ph || f.code.includes(ph) || ph.includes(f.code));
      if (match) {
        newMappings.push({ placeholder: ph, source_type: 'record_data', source_field_code: match.code });
      }
    }
    onChange(newMappings);
  };

  return (
    <div style={{ padding: 12, overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <span>完成度:</span>
          <Progress percent={Math.round((configured / placeholders.length) * 100)} size="small" style={{ width: 120 }} />
          <Tag>{configured}/{placeholders.length}</Tag>
        </Space>
        <Button icon={<ThunderboltOutlined />} onClick={autoMatch}>自动匹配</Button>
      </div>

      {placeholders.map(ph => {
        const mapping = mappingMap.get(ph);
        const isConfigured = !!mapping?.source_type;
        const sourceLabel = SOURCE_TYPES.find(item => item.value === mapping?.source_type)?.label || '已配置';
        const fieldLabel = availableFields.find(field => field.code === mapping?.source_field_code)?.label;

        return (
          <Card key={ph} size="small" style={{ marginBottom: 6, borderLeft: isConfigured ? '3px solid #52c41a' : '3px solid #faad14' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Tag color={isConfigured ? 'green' : 'orange'}>{friendlyPlaceholder(ph)}</Tag>
              <LinkOutlined />
              {isConfigured ? (
                <Space>
                  <Tag color="blue">{sourceLabel}</Tag>
                  <span>{fieldLabel || mapping!.literal_value || (mapping!.formula ? '计算结果' : '已选择数据项')}</span>
                </Space>
              ) : (
                <span style={{ color: '#999' }}>未配置</span>
              )}
              <div style={{ flex: 1 }} />
              <Button size="small" onClick={() => setEditingPlaceholder(ph)}>配置</Button>
            </div>
          </Card>
        );
      })}

      <Modal
        title={`配置数据来源 · ${friendlyPlaceholder(editingPlaceholder || '')}`}
        open={!!editingPlaceholder}
        onCancel={() => setEditingPlaceholder(null)}
        footer={null}
        width={500}
      >
        {editingPlaceholder && (
          <MappingForm
            placeholder={editingPlaceholder}
            mapping={mappingMap.get(editingPlaceholder)}
            availableFields={availableFields}
            onSave={(m) => { updateMapping(editingPlaceholder, m); setEditingPlaceholder(null); }}
            onFormula={() => { setFormulaPlaceholder(editingPlaceholder); setEditingPlaceholder(null); }}
          />
        )}
      </Modal>

      <Modal
        title={`编辑计算公式 · ${friendlyPlaceholder(formulaPlaceholder || '')}`}
        open={!!formulaPlaceholder}
        onCancel={() => setFormulaPlaceholder(null)}
        footer={null}
        width={520}
      >
        {formulaPlaceholder && (
          <FormulaEditor
            value={mappingMap.get(formulaPlaceholder)?.formula}
            availableFields={availableFields.map(f => ({ code: f.code, label: f.label }))}
            onChange={(formula) => {
              updateMapping(formulaPlaceholder, { source_type: 'computed', formula });
              setFormulaPlaceholder(null);
            }}
            onCancel={() => setFormulaPlaceholder(null)}
          />
        )}
      </Modal>
    </div>
  );
}

function MappingForm({ mapping, availableFields, onSave, onFormula }: {
  placeholder: string;
  mapping?: MappingItem;
  availableFields: { code: string; label: string; group: string }[];
  onSave: (m: Partial<MappingItem>) => void;
  onFormula: () => void;
}) {
  const [sourceType, setSourceType] = useState(mapping?.source_type || 'record_data');
  const [fieldCode, setFieldCode] = useState(mapping?.source_field_code || '');
  const [literalValue, setLiteralValue] = useState(mapping?.literal_value || '');

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontWeight: 'bold' }}>数据来源</label>
        <Select value={sourceType} onChange={setSourceType} style={{ width: '100%', marginTop: 4 }} options={SOURCE_TYPES} />
      </div>

      {sourceType === 'record_data' && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: 'bold' }}>关联字段</label>
          <Select
            value={fieldCode}
            onChange={setFieldCode}
            style={{ width: '100%', marginTop: 4 }}
            showSearch
            placeholder="搜索字段"
            options={availableFields.map(f => ({ value: f.code, label: `${f.label || '未命名字段'} [${f.group}]` }))}
          />
        </div>
      )}

      {sourceType === 'literal' && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: 'bold' }}>固定值</label>
          <AutoGrowTextArea value={literalValue} onChange={(e) => setLiteralValue(e.target.value)} style={{ marginTop: 4 }} />
        </div>
      )}

      {sourceType === 'computed' && (
        <div style={{ marginBottom: 12 }}>
          <Button onClick={onFormula}>打开公式编辑器</Button>
        </div>
      )}

      <Button type="primary" onClick={() => onSave({ source_type: sourceType, source_field_code: fieldCode || undefined, literal_value: literalValue || undefined })}>
        保存
      </Button>
    </div>
  );
}
