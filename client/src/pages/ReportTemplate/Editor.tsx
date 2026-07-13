import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button, message, Spin } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import FieldMappingEditor, { type MappingItem } from '../../components/FieldMappingEditor';
import TypstViewer from '../../components/TypstViewer';
import { execute } from '../../../../shared/formula-engine';
import axios from 'axios';

const API = '/api';

export default function ReportTemplateEditor() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const templateId = searchParams.get('id');

  const [template, setTemplate] = useState<any>(null);
  const [mappings, setMappings] = useState<MappingItem[]>([]);
  const [recordData, setRecordData] = useState<Record<string, any>>({});
  const [availableFields, setAvailableFields] = useState<{ code: string; label: string; group: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!templateId) return;
    setLoading(true);
    Promise.all([
      axios.get(`${API}/report-templates/${templateId}`),
      axios.get(`${API}/mappings/${templateId}`),
      axios.get(`${API}/record-data`),
      axios.get(`${API}/record-templates`),
    ]).then(([tRes, mRes, rdRes, rtRes]) => {
      setTemplate(tRes.data);
      setMappings(mRes.data.map((m: any) => ({
        placeholder: m.placeholder,
        source_type: m.source_type,
        source_field_code: m.source_field_code,
        literal_value: m.literal_value,
        formula: m.formula,
        transform: m.transform,
      })));

      // Merge all record data for preview
      const merged: Record<string, any> = {};
      for (const rd of rdRes.data) {
        if (rd.raw_data) Object.assign(merged, rd.raw_data);
        if (rd.derived_data) Object.assign(merged, rd.derived_data);
      }
      setRecordData(merged);

      // Build available fields from record templates' field definitions (with labels)
      const fields: { code: string; label: string; group: string }[] = [];
      for (const rt of rtRes.data) {
        // Load full template to get field_definitions
        axios.get(`${API}/record-templates/${rt.id}`).then(fullRes => {
          const groups = fullRes.data.field_definitions || [];
          for (const g of groups) {
            for (const f of g.fields || []) {
              if (!fields.find(x => x.code === f.code)) {
                fields.push({ code: f.code, label: f.label || f.code, group: `${rt.name} / ${g.label}` });
              }
            }
          }
          setAvailableFields([...fields]);
        });
      }

      // Also add raw data keys not in templates
      for (const key of Object.keys(merged)) {
        if (!fields.find(x => x.code === key)) {
          fields.push({ code: key, label: key, group: '实验数据' });
        }
      }
      setAvailableFields([...fields]);

      // Add system fields
      fields.push({ code: 'current_date', label: '当前日期', group: '系统字段' });
      fields.push({ code: 'report_no', label: '报告编号', group: '系统字段' });
      setAvailableFields([...fields]);
    }).catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, [templateId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.post(`${API}/mappings/${templateId}/batch`, { mappings });
      message.success('映射保存成功');
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const resolvedData = resolveMappings(mappings, recordData);
  const typstSource = template ? injectDataIntoTypst(template.typst_source, resolvedData) : '';

  if (loading) return <Spin style={{ margin: '100px auto', display: 'block' }} />;
  if (!template) return <div style={{ padding: 24 }}>模板未找到</div>;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #d9d9d9', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button onClick={() => navigate('/report-templates')}>← 返回</Button>
        <h3 style={{ margin: 0, flex: 1 }}>{template.name} — 字段映射</h3>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存映射</Button>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ width: '45%', borderRight: '1px solid #d9d9d9', overflow: 'auto' }}>
          <FieldMappingEditor
            placeholders={template.placeholders || []}
            mappings={mappings}
            availableFields={availableFields}
            onChange={setMappings}
          />
        </div>
        <div style={{ flex: 1 }}>
          <TypstViewer source={typstSource} mode="view" height="calc(100vh - 50px)"
            downloadName={`${template?.name || '报告模板'}.pdf`} />
        </div>
      </div>
    </div>
  );
}

function resolveMappings(mappings: MappingItem[], data: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const m of mappings) {
    switch (m.source_type) {
      case 'record_data':
        if (m.source_field_code) result[m.placeholder] = data[m.source_field_code] ?? null;
        break;
      case 'literal':
        if (m.literal_value) result[m.placeholder] = m.literal_value;
        break;
      case 'system':
        if (m.source_field_code === 'current_date') result[m.placeholder] = new Date().toISOString().split('T')[0];
        break;
      case 'computed':
        if (m.formula) {
          try {
            result[m.placeholder] = execute(m.formula, { ...data, ...result });
          } catch {
            result[m.placeholder] = null;
          }
        }
        break;
      case 'order':
      case 'sample':
        if (m.source_field_code) result[m.placeholder] = data[m.source_field_code] ?? null;
        break;
    }
  }
  return result;
}

function injectDataIntoTypst(source: string, data: Record<string, any>): string {
  let result = source;
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && value !== undefined) {
      const escaped = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const typstVal = typeof value === 'number' ? String(value) : `"${escaped}"`;
      result = result.replace(new RegExp(`${escapeRegex(key)}:\\s*none`, 'g'), `${key}: ${typstVal}`);
    }
  }
  return result;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
