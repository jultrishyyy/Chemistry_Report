import { useState, useEffect } from 'react';
import { Button, Select, Space, message, Card, Descriptions, Alert } from 'antd';
import { DownloadOutlined, FileTextOutlined } from '@ant-design/icons';
import axios from 'axios';
import PdfPreview from '../../components/TypstViewer/PdfPreview';

const API = '/api';

export default function ReportDetail() {
  const [reportTemplateId, setReportTemplateId] = useState<number | undefined>();
  const [pdfUrl, setPdfUrl] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [selectedRecords, setSelectedRecords] = useState<number[]>([]);
  const [recordDetails, setRecordDetails] = useState<any[]>([]);

  useEffect(() => {
    axios.get(`${API}/report-templates`).then(res => setTemplates(res.data));
    axios.get(`${API}/record-data`).then(res => setRecords(res.data));
  }, []);

  useEffect(() => () => {
    if (pdfUrl.startsWith('blob:')) URL.revokeObjectURL(pdfUrl);
  }, [pdfUrl]);

  useEffect(() => {
    if (selectedRecords.length === 0) { setRecordDetails([]); return; }
    Promise.all(selectedRecords.map(id => axios.get(`${API}/record-data/${id}`)))
      .then(results => setRecordDetails(results.map(r => r.data)));
  }, [selectedRecords]);

  const selectedTemplate = templates.find(t => t.id === reportTemplateId);
  const placeholderCount = selectedTemplate?.placeholders?.length || 0;

  const handleGenerate = async () => {
    if (!reportTemplateId) { message.warning('请选择报告模板'); return; }
    if (selectedRecords.length === 0) { message.warning('请至少选择一条实验数据'); return; }
    setLoading(true);
    try {
      const response = await axios.post(`${API}/reports/generate`, {
        report_template_id: reportTemplateId,
        record_data_ids: selectedRecords,
      }, { responseType: 'blob' });

      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
      message.success('报告生成成功');
    } catch {
      message.error('生成失败，请检查映射配置是否完整');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!pdfUrl) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = `report-${reportTemplateId}.pdf`;
    a.click();
  };

  const mergedDataKeys = new Set<string>();
  for (const rd of recordDetails) {
    if (rd.raw_data) Object.keys(rd.raw_data).forEach(k => mergedDataKeys.add(k));
    if (rd.derived_data) Object.keys(rd.derived_data).forEach(k => mergedDataKeys.add(k));
  }

  return (
    <div style={{ padding: 24, height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <h2>报告生成</h2>

      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          placeholder="选择报告模板"
          style={{ width: 280 }}
          options={templates.map(t => {
            if (t.current_status !== 'approved') return { value: t.id, label: `${t.name}（未审核通过，无法选用）`, disabled: true };
            if (!(t.current_field_group_count > 0)) return { value: t.id, label: `${t.name}（模板无内容/旧版，无法用于生成）`, disabled: true };
            return { value: t.id, label: `${t.name} (${t.placeholders?.length || 0} 个占位符)` };
          })}
          onChange={setReportTemplateId}
        />
        <Select
          mode="multiple"
          placeholder="选择实验数据（可多选）"
          style={{ width: 350 }}
          options={records.map(r => ({ value: r.id, label: `记录 #${r.id} (模板 ${r.template_id}, ${new Date(r.submitted_at).toLocaleDateString()})` }))}
          onChange={setSelectedRecords}
        />
        <Button type="primary" icon={<FileTextOutlined />} onClick={handleGenerate} loading={loading}
          disabled={!reportTemplateId || selectedRecords.length === 0}>
          生成报告
        </Button>
        {pdfUrl && <Button icon={<DownloadOutlined />} onClick={handleDownload}>下载 PDF</Button>}
      </Space>

      {selectedTemplate && selectedRecords.length > 0 && !pdfUrl && (
        <Card size="small" style={{ marginBottom: 12 }}>
          <Descriptions size="small" column={2}>
            <Descriptions.Item label="报告模板">{selectedTemplate.name}</Descriptions.Item>
            <Descriptions.Item label="占位符数">{placeholderCount}</Descriptions.Item>
            <Descriptions.Item label="选中记录">{selectedRecords.length} 条</Descriptions.Item>
            <Descriptions.Item label="可用字段数">{mergedDataKeys.size}</Descriptions.Item>
          </Descriptions>
          {placeholderCount > 0 && mergedDataKeys.size < placeholderCount && (
            <Alert type="warning" message={`注意：报告需要 ${placeholderCount} 个字段，当前数据只有 ${mergedDataKeys.size} 个，部分占位符可能为空`} style={{ marginTop: 8 }} showIcon />
          )}
        </Card>
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        {pdfUrl ? (
          <div style={{ width: '100%', height: '100%', border: '1px solid #d9d9d9' }}>
            <PdfPreview url={pdfUrl} height="100%" />
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#f5f5f5', color: '#999', flexDirection: 'column', gap: 8 }}>
            <FileTextOutlined style={{ fontSize: 48 }} />
            <span>选择报告模板和实验数据后，点击"生成报告"</span>
          </div>
        )}
      </div>
    </div>
  );
}
