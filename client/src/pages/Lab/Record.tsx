import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button, message, Spin, Tag, Space, Alert } from 'antd';
import { SaveOutlined, CheckCircleOutlined } from '@ant-design/icons';
import FormRenderer from '../../components/FormRenderer';
import AttachmentManager from '../../components/AttachmentManager';
import TypstViewer from '../../components/TypstViewer';
import { generateTypstWithData } from '../../../../shared/typst-generator';
import { useDeviceMap } from '../../utils/deviceMap';
import type { RecordTemplate } from '../../../../shared/types';
import { createEmptyMatrixValue, stripMatrixFlatKeys, buildFieldDefaults } from '../../../../shared/matrix-flatten';
import { useAuth } from '../../auth';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { BRAND, APP_BG } from '../../theme';
import axios from 'axios';

const API = '/api';

/** 把表单 data 拆成 raw_data / derived_data（主检/审核等自动字段不进 raw_data，computed 进 derived）。 */
function splitData(template: RecordTemplate, data: Record<string, any>) {
  const allFields = template.groups.flatMap(g => g.fields);
  const computedCodes = new Set(allFields.filter(f => f.type === 'computed').map(f => f.code));
  const autoCodes = new Set(allFields.filter(f => f.semantic_role).map(f => f.code));
  const stripped = stripMatrixFlatKeys(template, data);
  const rawData: Record<string, any> = {};
  const derivedData: Record<string, any> = {};
  for (const [k, v] of Object.entries(stripped)) {
    if (autoCodes.has(k)) continue;
    if (computedCodes.has(k)) derivedData[k] = v;
    else rawData[k] = v;
  }
  return { rawData, derivedData, allFields };
}

function ensureDataMatrixDefaults(template: RecordTemplate, d: Record<string, any>): Record<string, any> {
  const next = { ...d };
  for (const f of template.groups.flatMap(g => g.fields)) {
    if (f.type !== 'data_matrix' || !f.matrix) continue;
    if (!next[f.code] || typeof next[f.code] !== 'object' || !Array.isArray((next[f.code] as any).sample_ids)) {
      next[f.code] = createEmptyMatrixValue(f.matrix);
    }
  }
  return next;
}

function matrixHasAnyValue(v: any): boolean {
  if (!v || typeof v !== 'object' || !v.cells) return false;
  return Object.values(v.cells).some(x => x !== '' && x !== null && x !== undefined);
}

export default function LabRecord() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, has } = useAuth();
  const templateId = searchParams.get('template_id');
  const recordId = searchParams.get('id');
  const ctxOrderNo = searchParams.get('order_no') || '';
  const ctxSampleId = searchParams.get('sample_id') || '';
  const ctxSampleName = searchParams.get('sample_name') || '';
  const ctxTestName = searchParams.get('test_name') || '';

  const [template, setTemplate] = useState<RecordTemplate | null>(null);
  const [data, setData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recordRow, setRecordRow] = useState<any>(null);
  // 导入 Excel 留存：已保存到订单的附件 + 未保存（pending）的待上传文件
  const [attachments, setAttachments] = useState<Array<{ id: string; filename: string; pending?: boolean }>>([]);
  const pendingExcelsRef = useRef<File[]>([]);

  const uploadExcelAttachment = async (id: string | number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', 'excel');   // 标记为 Excel 留存（与通用附件区分，只在数据表区显示）
    const res = await axios.post(`${API}/excel-import/${id}/attachments`, fd);
    return res.data as { id: string; filename: string };
  };
  /** 把暂存（未保存时导入）的 Excel 在拿到 recordId 后补传，并用真实附件替换 pending 占位。 */
  const flushPendingExcels = async (id: string | number) => {
    if (!pendingExcelsRef.current.length) return;
    const files = pendingExcelsRef.current;
    pendingExcelsRef.current = [];
    const uploaded: Array<{ id: string; filename: string }> = [];
    for (const f of files) {
      try { uploaded.push(await uploadExcelAttachment(id, f)); } catch { /* 留存失败不阻断保存 */ }
    }
    setAttachments(prev => [...prev.filter(a => !a.pending), ...uploaded]);
  };
  /** FormRenderer 顶部导入一份 Excel 后回调：已存草稿→即时留存；未存→暂存待保存时补传。 */
  const handleExcelImported = async (file: File) => {
    if (recordId) {
      try {
        const att = await uploadExcelAttachment(recordId, file);
        setAttachments(prev => [...prev, att]);
      } catch { message.error('Excel 留存失败（数据已填充，可重试导入或保存后重传）'); }
    } else {
      pendingExcelsRef.current.push(file);
      setAttachments(prev => [...prev, { id: `pending_${Date.now()}`, filename: file.name, pending: true }]);
    }
  };

  /** 日期统一格式化为 yyyy-mm-dd（本地时区，与出报告端 formatDateOnly/toISOString 口径一致，避免 6/30/2026 的本地化格式）。 */
  const ymd = (v: any): string => {
    const d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /** 把 record_data 五列（含审核状态）按 semantic_role 注入到 data，供 FormRenderer 显示。 */
  const injectAuditFields = (tmpl: RecordTemplate, base: Record<string, any>, row: any): Record<string, any> => {
    const out = { ...base };
    for (const f of tmpl.groups.flatMap(g => g.fields)) {
      if (!f.semantic_role) continue;
      if (f.semantic_role === 'inspector') out[f.code] = row?.tester_name || (has('record.entry') ? (user?.display_name ?? '') : '');
      else if (f.semantic_role === 'inspector_date') out[f.code] = row?.tested_at ? ymd(row.tested_at) : (has('record.entry') ? ymd(new Date()) : '');
      else if (f.semantic_role === 'reviewer') out[f.code] = row?.reviewer_name || '';
      else if (f.semantic_role === 'reviewer_date') out[f.code] = row?.reviewed_at ? ymd(row.reviewed_at) : '';
    }
    return out;
  };

  useEffect(() => {
    if (recordId) return;
    if (templateId) {
      setLoading(true);
      axios.get(`${API}/record-templates/${templateId}`)
        .then(res => {
          const tmpl: RecordTemplate = {
            id: res.data.id,
            name: res.data.name,
            version: res.data.version,
            groups: res.data.field_definitions,
            typst_source: res.data.typst_source,
            layout_options: res.data.layout_options || {},
          };
          setTemplate(tmpl);
          // 新建记录：应用模板配置的字段默认值（实验员可改；矩阵默认值走 createEmptyMatrixValue）
          setData(buildFieldDefaults(tmpl));
        })
        .finally(() => setLoading(false));
    }
  }, [templateId, recordId]);

  useEffect(() => {
    if (!recordId) return;
    setLoading(true);
    axios.get(`${API}/record-data/${recordId}`).then(async res => {
      const rec = res.data;
      const merged = { ...rec.raw_data, ...rec.derived_data };
      setRecordRow(rec);
      setAttachments(Array.isArray(rec.attachments) ? rec.attachments : []);
      // ⚠️ 数据一致性：编辑已有记录【按录入时锁定的模板版本加载】，而不是当前最新版本——
      // 模板后续修改不会改变已生成记录的结构。无锁定版本（历史数据）才回退到当前版本。
      const baseRes = await axios.get(`${API}/record-templates/${rec.template_id}`);
      let fieldDefs = baseRes.data.field_definitions;
      let layout = baseRes.data.layout_options || {};
      let versionNo = baseRes.data.version;
      if (rec.template_version_id) {
        try {
          const ver = await axios.get(`${API}/record-templates/${rec.template_id}/versions/${rec.template_version_id}`);
          if (ver.data?.field_definitions) {
            fieldDefs = ver.data.field_definitions;
            layout = ver.data.layout_options || {};
            versionNo = ver.data.version_no ?? versionNo;
          }
        } catch { /* 取不到锁定版本则用当前版本兜底 */ }
      }
      const tmpl: RecordTemplate = {
        id: baseRes.data.id,
        name: baseRes.data.name,
        version: versionNo,
        groups: fieldDefs,
        layout_options: layout,
      };
      setTemplate(tmpl);
      setData(injectAuditFields(tmpl, ensureDataMatrixDefaults(tmpl, merged), rec));
    }).finally(() => setLoading(false));
  }, [recordId]);

  useEffect(() => {
    if (!template) return;
    setData(d => {
      const next = injectAuditFields(template, ensureDataMatrixDefaults(template, d), recordRow);
      // 基线必须取「注入后」的内容——矩阵默认行/审核字段等自动注入不是用户改动；
      // 此前基线在注入前计算，新建录入一打开（没碰任何字段）就误报"有未保存的修改"。
      savedSigRef.current = computeSig(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id, recordRow?.id, user?.user_name]);

  // 「已保存」签名（仅含用户录入的 raw/derived，排除自动注入字段）——用于未保存守卫
  const savedSigRef = useRef('');
  const computeSig = (d: Record<string, any>): string => {
    if (!template) return '';
    const { rawData, derivedData } = splitData(template, d);
    return JSON.stringify({ rawData, derivedData });
  };

  const isDirty = () => !!template && computeSig(data) !== savedSigRef.current;
  const { confirmLeave } = useUnsavedGuard(isDirty);

  const backTo = ctxOrderNo ? `/lab/order/${encodeURIComponent(ctxOrderNo)}` : '/lab';

  /** 保存数据。status='draft' 存草稿（不校验必填）；'pending' 提交审核（校验必填）。返回是否成功。 */
  const handleSave = async (status: 'draft' | 'pending'): Promise<boolean> => {
    if (!template) return false;
    if (!user || !has('record.entry')) {
      message.error('请以主检身份登录后再操作');
      return false;
    }
    const { rawData, derivedData, allFields } = splitData(template, data);

    if (status === 'pending') {
      const missing = allFields.filter(f => {
        if (!f.required || f.type === 'computed') return false;
        if (f.type === 'data_matrix') return !matrixHasAnyValue(rawData[f.code]);
        const v = rawData[f.code];
        if (v === null || v === undefined || v === '') return true;
        if (typeof v === 'object' && 'custom' in v && !(v as any).custom) return true;
        return false;
      });
      if (missing.length > 0) {
        message.error(`提交审核前请填写必填字段: ${missing.map(f => f.label).join(', ')}`);
        return false;
      }
    }

    setSaving(true);
    try {
      if (recordId) {
        await axios.put(`${API}/record-data/${recordId}`, { raw_data: rawData, derived_data: derivedData, status });
        await flushPendingExcels(recordId);
        savedSigRef.current = computeSig(data);
        message.success(status === 'draft' ? '草稿已保存' : '已提交审核');
        if (status === 'pending') navigate(backTo);
      } else {
        const res = await axios.post(`${API}/record-data`, {
          template_id: template.id,
          template_version: template.version,
          raw_data: rawData,
          derived_data: derivedData,
          order_no: ctxOrderNo || undefined,
          sample_external_id: ctxSampleId || undefined,
          test_item_name: ctxTestName || undefined,
          status,
        });
        await flushPendingExcels(res.data.id);
        savedSigRef.current = computeSig(data);
        message.success(status === 'draft' ? '草稿已保存' : '已提交审核');
        if (status === 'pending') {
          navigate(backTo);
        } else {
          // 首次存草稿：把 id 写进 URL，后续保存走 PUT
          const params = new URLSearchParams({ id: String(res.data.id), template_id: String(template.id) });
          if (ctxOrderNo) params.set('order_no', ctxOrderNo);
          if (ctxSampleId) params.set('sample_id', ctxSampleId);
          if (ctxSampleName) params.set('sample_name', ctxSampleName);
          if (ctxTestName) params.set('test_name', ctxTestName);
          navigate(`/lab/record?${params.toString()}`, { replace: true });
        }
      }
      return true;
    } catch {
      message.error('保存失败');
      return false;
    } finally {
      setSaving(false);
    }
  };

  // 「测试设备」字段：反查设备名称，PDF 显示「设备名称：管理编号」（录入端只存管理编号数组）。
  const deviceMap = useDeviceMap(template, data);
  const typstSource = template ? generateTypstWithData(template, data, { deviceMap }) : '';

  if (loading) return <Spin style={{ margin: '100px auto', display: 'block' }} />;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #e8ecf3', background: '#fff', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 1px 2px rgba(16,24,40,0.03)' }}>
        <Button onClick={() => confirmLeave(() => navigate(backTo), () => handleSave('draft'))}>← 返回</Button>
        {template ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span style={{ width: 3, height: 18, borderRadius: 2, background: BRAND }} />
            <h3 style={{ margin: 0, whiteSpace: 'nowrap', color: '#1f2733' }}>{template.name}</h3>
            <Space size={6} wrap>
              {ctxOrderNo && <Tag color="blue" style={{ fontFamily: 'monospace', margin: 0 }}>{ctxOrderNo}</Tag>}
              {ctxSampleName && <Tag bordered={false} style={{ margin: 0, background: '#eef2f8', color: '#475467' }}>样品 {ctxSampleName}</Tag>}
              {ctxTestName && <Tag bordered={false} style={{ margin: 0, background: '#eef2f8', color: '#475467' }}>项目 {ctxTestName}</Tag>}
              <Tag bordered={false} style={{ margin: 0, background: '#f1f3f7', color: '#667085' }}>v{template.version}</Tag>
            </Space>
          </div>
        ) : (
          <h3 style={{ margin: 0, flex: 1, color: '#aaa' }}>请从录入工作台选择测试项目进入</h3>
        )}
        <Space>
          <Button icon={<SaveOutlined />} onClick={() => handleSave('draft')} loading={saving} disabled={!template || recordRow?.audit_status === 'reviewed'}>保存草稿</Button>
          <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => handleSave('pending')} loading={saving} disabled={!template || recordRow?.audit_status === 'reviewed'}>提交审核</Button>
        </Space>
      </div>
      {template && !user && (
        <Alert
          banner type="warning" showIcon
          message="未登录 — 提交将失败。请先在右上角以主检身份登录。"
          style={{ borderRadius: 0 }}
        />
      )}
      {template && recordRow?.audit_status === 'rejected' && recordRow?.reject_note && (
        <Alert
          banner type="error" showIcon
          message={`审核未通过，请修改后重新提交`}
          description={<span>退回备注：<strong>{recordRow.reject_note}</strong></span>}
          style={{ borderRadius: 0 }}
        />
      )}
      {template && recordRow?.audit_status === 'draft' && (
        <Alert
          banner type="info" showIcon
          message="草稿——尚未提交审核。填写完成后点右上角「提交审核」送审。"
          style={{ borderRadius: 0 }}
        />
      )}
      {template && recordRow?.audit_status === 'reviewed' && (
        <Alert
          banner type="success" showIcon
          message={`已审核通过（${recordRow.reviewer_name}）——已锁定，不可修改。如需修改请在报告生成处「退回原始记录」。`}
          style={{ borderRadius: 0 }}
        />
      )}
      {template && (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ width: '46%', borderRight: '1px solid #e8ecf3', overflow: 'auto', background: APP_BG }}>
            {/* 已审核＝详情只读：编辑器照常显示，但不可交互（pointerEvents:none），仅供查看 */}
            <div style={recordRow?.audit_status === 'reviewed' ? { pointerEvents: 'none' } : undefined}>
              <FormRenderer template={template} data={data} onChange={setData}
                recordId={recordId}
                uploadCtx={{ orderNo: ctxOrderNo, recordDir: [ctxSampleName, ctxTestName].filter(Boolean).join('_') }}
                excelAttachments={attachments.filter(a => (a as any).kind === 'excel' || (a as any).pending)}
                onExcelImported={handleExcelImported} />
            </div>
            {/* 录入详情页最下方：通用附件（任意格式），与订单详情页每行「附件」同一出口（record_data.attachments）。
                附件面板放在只读遮罩之外，已审核时仍可下载（上传由 readOnly 关闭） */}
            <div style={{ padding: '8px 16px 16px', borderTop: '1px dashed #e8ecf3', margin: '8px 16px 0' }}>
              <AttachmentManager recordId={recordId} kind="file"
                title={recordRow?.audit_status === 'reviewed' ? '附件（含导入 Excel，可下载）' : '附件（任意格式，可随时下载）'}
                readOnly={recordRow?.audit_status === 'reviewed'}
                listAll={recordRow?.audit_status === 'reviewed'} />     {/* 锁定详情时这里汇总所有可下载文件（编辑器内的链接已不可点） */}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <TypstViewer source={typstSource} mode="view" height="calc(100vh - 50px)"
              downloadName={`${template?.name || '原始记录'}${ctxSampleName ? '-' + ctxSampleName : ''}.pdf`} />
          </div>
        </div>
      )}
    </div>
  );
}
