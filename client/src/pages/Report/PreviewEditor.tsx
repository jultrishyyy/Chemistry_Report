/**
 * 报告预览 + 二次编辑（基础版）
 * 支持：查看 final_typst 源码 + PDF 预览 + 手动编辑 Typst 后保存升版本
 */
import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button, message, Spin, Alert, Tag, Space, Tooltip } from 'antd';
import { SaveOutlined, DownloadOutlined } from '@ant-design/icons';
import axios from 'axios';
import TypstViewer from '../../components/TypstViewer';

const API = '/api';

export default function ReportPreviewEditor() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const id = searchParams.get('id');
  const [report, setReport] = useState<any>(null);
  const [source, setSource] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    axios.get(`${API}/reports/${id}`)
      .then(res => {
        setReport(res.data);
        setSource(res.data.final_typst || '');
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await axios.put(`${API}/reports/${id}`, { final_typst: source });
      message.success('保存成功，版本号已升级');
      setReport({ ...report, version: report.version + 1 });
    } catch (e: any) {
      message.error('保存失败：' + (e.message || ''));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spin style={{ margin: '100px auto', display: 'block' }} />;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #d9d9d9', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button onClick={() => navigate('/report')}>← 返回工作台</Button>
        <h3 style={{ margin: 0 }}>报告预览 / 编辑</h3>
        {report && (
          <Space>
            <Tag color="blue" style={{ fontFamily: 'monospace' }}>{report.order_no}</Tag>
            <Tag>v{report.version}</Tag>
            <span style={{ color: '#888', fontSize: 12 }}>生成于 {new Date(report.generated_at).toLocaleString()}</span>
          </Space>
        )}
        <div style={{ flex: 1 }} />
        <Button type="primary" ghost onClick={() => navigate(`/report/edit?id=${id}`)}>结构化编辑</Button>
        <Button icon={<DownloadOutlined />} onClick={() => window.open(`${API}/reports/${id}/pdf`, '_blank')}>下载 PDF</Button>
        <Tooltip title="DOCX 是 PDF 副本，复杂表格/排版可能与 PDF 有差异，仅供文字微调">
          <Button icon={<DownloadOutlined />} onClick={() => window.open(`${API}/reports/${id}/docx`, '_blank')}>下载 DOCX</Button>
        </Tooltip>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存（升版本）</Button>
      </div>

      {report?.warnings?.length > 0 && (
        <Alert
          type="warning"
          banner
          message={`生成时有 ${report.warnings.length} 个警告`}
          description={
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {report.warnings.map((w: any, i: number) => (
                <li key={i} style={{ fontSize: 12 }}>
                  {w.type === 'equipment_missing_date' && `设备「${w.name}」(${w.asset_code}) 缺溯源/到期日期，未填入设备表`}
                  {w.type === 'equipment_not_found' && `设备库未找到管理编号「${w.asset_code}」`}
                  {w.type === 'project_template_missing' && `记录 ${w.record_data_id} 未指派项目模板`}
                  {w.type === 'record_missing' && `项目模板 ${w.project_template_id} 未找到对应记录`}
                  {w.type === 'compile_failed' && `Typst 编译失败：${w.detail}`}
                </li>
              ))}
            </ul>
          }
        />
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        <TypstViewer source={source} mode="split" onChange={setSource} height="calc(100vh - 50px)"
          downloadName={`报告${report?.order_no ? '-' + report.order_no : ''}.pdf`} />
      </div>
    </div>
  );
}
