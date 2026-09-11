/**
 * 报告预览 + 二次编辑（基础版）
 * 支持：查看 final_typst 源码 + PDF 预览 + 手动编辑 Typst 后保存升版本
 */
import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button, message, Spin, Alert, Tag, Space, Tooltip } from 'antd';
import { SaveOutlined, DownloadOutlined } from '@ant-design/icons';
import axios from 'axios';
import TypstViewer from '../../components/TypstViewer';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { useAutoSave } from '../../hooks/useAutoSave';
import { useExclusiveEditLease } from '../../hooks/useCollaboration';
import DocumentCollaborationStatus from '../../components/DocumentCollaborationStatus';

const API = '/api';

export default function ReportPreviewEditor() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const id = searchParams.get('id');
  const permissionReadOnly = searchParams.get('readonly') === '1';
  const lease = useExclusiveEditLease({
    resourceType: 'report_instance', resourceId: id, enabled: !!id && !permissionReadOnly,
  });
  const readOnly = permissionReadOnly || lease.loading || !lease.acquired;
  const [report, setReport] = useState<any>(null);
  const [source, setSource] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const savedSourceRef = useRef('');
  const baselineReadyRef = useRef(false);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const isDirty = () => !readOnly && baselineReadyRef.current && sourceRef.current !== savedSourceRef.current;
  const { confirmLeave } = useUnsavedGuard(isDirty);

  useEffect(() => {
    if (!id) return;
    baselineReadyRef.current = false;
    setLoading(true);
    axios.get(`${API}/reports/${id}`)
      .then(res => {
        setReport(res.data);
        const loadedSource = res.data.final_typst || '';
        setSource(loadedSource);
        savedSourceRef.current = loadedSource;
        baselineReadyRef.current = true;
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async (options: { silent?: boolean } = {}): Promise<boolean> => {
    if (!id) return false;
    setSaving(true);
    try {
      const current = sourceRef.current;
      await axios.put(`${API}/reports/${id}`, { final_typst: current }, { headers: lease.headers });
      savedSourceRef.current = current;
      if (!options.silent) message.success('保存成功，版本号已升级');
      setReport((previous: any) => previous ? { ...previous, version: previous.version + 1 } : previous);
      return true;
    } catch (e: any) {
      if (e.response?.status === 423) message.warning(e.response?.data?.error || '该报告已由其他用户占用编辑，当前为只读');
      else message.error('保存失败：' + (e.message || ''));
      return false;
    } finally {
      setSaving(false);
    }
  };

  useAutoSave({
    enabled: baselineReadyRef.current && !loading && !saving && !!id && !readOnly,
    isDirty,
    save: () => handleSave({ silent: true }),
  });

  if (loading) return <Spin style={{ margin: '100px auto', display: 'block' }} />;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #d9d9d9', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Button onClick={() => confirmLeave(() => navigate('/report'), () => handleSave())}>← 返回工作台</Button>
        <h3 style={{ margin: 0 }}>报告预览 / 编辑</h3>
        {report && (
          <Space>
            <Tag color="blue" style={{ fontFamily: 'monospace' }}>{report.order_no}</Tag>
            <Tag>v{report.version}</Tag>
            <span style={{ color: '#888', fontSize: 12 }}>生成于 {new Date(report.generated_at).toLocaleString()}</span>
          </Space>
        )}
        <div style={{ flex: 1 }} />
        <DocumentCollaborationStatus resourceType="report_instance" resourceId={id}
          canEdit={!permissionReadOnly} lease={lease} onSaveBeforeRelease={() => handleSave()}
          changes={isDirty() ? ['Typst 源代码（未保存）'] : []} />
        <Button type="primary" ghost onClick={() => confirmLeave(
          () => navigate(`/report/edit?id=${id}`),
          () => handleSave(),
        )}>结构化编辑</Button>
        <Button icon={<DownloadOutlined />} onClick={() => window.open(`${API}/reports/${id}/pdf`, '_blank')}>下载 PDF</Button>
        <Tooltip title="DOCX 是 PDF 副本，复杂表格/排版可能与 PDF 有差异，仅供文字微调">
          <Button icon={<DownloadOutlined />} onClick={() => window.open(`${API}/reports/${id}/docx`, '_blank')}>下载 DOCX</Button>
        </Tooltip>
        <Button type="primary" icon={<SaveOutlined />} onClick={() => handleSave()} loading={saving} disabled={readOnly}>保存（升版本）</Button>
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
                  {w.type === 'record_free_grid_structure_changed' && `原始记录的“${(w.tables || []).join('、')}”在录入时新增了非试样行/列；临时结构未自动映射到项目报告，请核对报告内容`}
                  {w.type === 'record_free_grid_header_changed' && <>
                    {`原始记录“${(w.tables || []).join('、')}”修改了表头名称，请核对报告表头及对应数据。`}
                    <ul>{(w.changes || []).map((change: any, index: number) => <li key={index}>{change.table}：{change.before || '（空）'} → {change.after || '（空）'}</li>)}</ul>
                  </>}
                  {w.type === 'compile_failed' && `Typst 编译失败：${w.detail}`}
                </li>
              ))}
            </ul>
          }
        />
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        <TypstViewer source={source} mode={readOnly ? 'view' : 'split'} onChange={readOnly ? undefined : setSource} height="calc(100vh - 50px)"
          downloadName={`报告${report?.order_no ? '-' + report.order_no : ''}.pdf`} />
      </div>
    </div>
  );
}
