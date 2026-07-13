import { useState, useEffect } from 'react';
import { Select, InputNumber, Input, Button, Space, Tag } from 'antd';
import { FORMULA_TYPES, execute, type Formula, type FormulaType } from '../../../../shared/formula-engine';

interface FormulaEditorProps {
  value?: Formula;
  onChange: (formula: Formula) => void;
  availableFields: { code: string; label: string }[];
  onCancel?: () => void;
}

export default function FormulaEditor({ value, onChange, availableFields, onCancel }: FormulaEditorProps) {
  const [formulaType, setFormulaType] = useState<FormulaType>(value?.type || 'average');
  const [sources, setSources] = useState<string[]>(value?.sources || []);
  const [decimals, setDecimals] = useState<number | undefined>(value?.decimals ?? 2);
  const [params, setParams] = useState<Record<string, any>>(value?.params || {});
  const [preview, setPreview] = useState<string>('');

  useEffect(() => {
    const formula: Formula = { type: formulaType, sources, decimals, params };
    const mockData: Record<string, any> = {};
    availableFields.forEach((f, i) => { mockData[f.code] = (i + 1) * 10; });
    try {
      const result = execute(formula, mockData);
      setPreview(result !== null ? String(result) : '(无结果)');
    } catch {
      setPreview('(计算错误)');
    }
  }, [formulaType, sources, decimals, params, availableFields]);

  const handleSave = () => {
    onChange({ type: formulaType, sources, decimals, params });
  };

  const needsSources = !['round_format'].includes(formulaType) || true;

  return (
    <div style={{ padding: 16, border: '1px solid #d9d9d9', borderRadius: 8, background: '#fafafa' }}>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: 4 }}>公式类型</label>
        <Select
          value={formulaType}
          onChange={setFormulaType}
          style={{ width: '100%' }}
          options={FORMULA_TYPES.map(f => ({ value: f.type, label: `${f.label} — ${f.description}` }))}
        />
      </div>

      {needsSources && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: 4 }}>数据源字段</label>
          <Select
            mode="multiple"
            value={sources}
            onChange={setSources}
            style={{ width: '100%' }}
            placeholder="选择字段"
            options={availableFields.map(f => ({ value: f.code, label: `${f.label} (${f.code})` }))}
          />
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: 4 }}>保留小数位</label>
        <InputNumber value={decimals} onChange={(v) => setDecimals(v ?? undefined)} min={0} max={10} />
      </div>

      {formulaType === 'threshold' && (
        <div style={{ marginBottom: 12 }}>
          <Space>
            <Select value={params.operator || '>='} onChange={(v) => setParams({ ...params, operator: v })} style={{ width: 80 }}
              options={[{ value: '>=' }, { value: '>' }, { value: '<=' }, { value: '<' }, { value: '==' }]} />
            <InputNumber value={params.threshold ?? 0} onChange={(v) => setParams({ ...params, threshold: v })} placeholder="阈值" />
          </Space>
        </div>
      )}

      {formulaType === 'range' && (
        <div style={{ marginBottom: 12 }}>
          <Space>
            <InputNumber value={params.lower ?? 0} onChange={(v) => setParams({ ...params, lower: v })} placeholder="下限" />
            <span>~</span>
            <InputNumber value={params.upper ?? 100} onChange={(v) => setParams({ ...params, upper: v })} placeholder="上限" />
          </Space>
        </div>
      )}

      {formulaType === 'unit_convert' && (
        <div style={{ marginBottom: 12 }}>
          <Space>
            <span>× </span>
            <InputNumber value={params.factor ?? 1} onChange={(v) => setParams({ ...params, factor: v })} placeholder="系数" />
            <span>+ </span>
            <InputNumber value={params.offset ?? 0} onChange={(v) => setParams({ ...params, offset: v })} placeholder="偏移" />
          </Space>
        </div>
      )}

      {formulaType === 'text_concat' && (
        <div style={{ marginBottom: 12 }}>
          <Input value={params.separator ?? ', '} onChange={(e) => setParams({ ...params, separator: e.target.value })} placeholder="分隔符" addonBefore="分隔符" />
        </div>
      )}

      <div style={{ marginBottom: 12, padding: 8, background: '#e6f7ff', borderRadius: 4 }}>
        <strong>实时预览：</strong> <Tag color="blue">{preview}</Tag>
        <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
          (使用 mock 数据: {availableFields.slice(0, 3).map((f, i) => `${f.code}=${(i + 1) * 10}`).join(', ')}...)
        </div>
      </div>

      <Space>
        <Button type="primary" onClick={handleSave}>保存公式</Button>
        {onCancel && <Button onClick={onCancel}>取消</Button>}
      </Space>
    </div>
  );
}
