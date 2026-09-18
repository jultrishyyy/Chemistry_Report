import { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button, message, Spin, Tag, Space, Alert, Modal, Select, Checkbox } from 'antd';
import { SaveOutlined, CheckCircleOutlined, EyeOutlined, ImportOutlined } from '@ant-design/icons';
import FormRenderer from '../../components/FormRenderer';
import AttachmentManager from '../../components/AttachmentManager';
import TypstViewer, { markerHighlightForField, type TypstViewerHandle } from '../../components/TypstViewer';
import { generateTypstWithData } from '../../../../shared/typst-generator';
import { useDeviceMap } from '../../utils/deviceMap';
import type { RecordTemplate } from '../../../../shared/types';
import { createEmptyMatrixValue, stripMatrixFlatKeys, buildFieldDefaults } from '../../../../shared/matrix-flatten';
import { useAuth } from '../../auth';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { useAutoSave } from '../../hooks/useAutoSave';
import { BRAND, APP_BG } from '../../theme';
import axios from 'axios';
import type { WorkOrder } from './order-shared';
import { normalizeLinkedIds } from './order-shared';
import { RecordOrderContextCard } from './OrderProjectInfo';
import { useExclusiveEditLease } from '../../hooks/useCollaboration';
import { rebaseRecordSave } from '../../../../shared/record-save-rebase';
import { ensureRecordIdentityFields } from '../../../../shared/record-template-normalize';
import { figureCaptionFieldKey, figureCaptionGroupKey } from '../../../../shared/figure-caption';
import { isRecordPullSource, matchPublicRecordFields, publicRecordTransferPatch } from '../../../../shared/record-field-transfer';
import DocumentCollaborationStatus from '../../components/DocumentCollaborationStatus';
import EditAttemptGuard from '../../components/EditAttemptGuard';

const API = '/api';

/** 把表单 data 拆成 raw_data / derived_data（主检/审核等自动字段不进 raw_data，computed 进 derived）。 */
function splitData(
  template: RecordTemplate,
  data: Record<string, any>,
  _useBatchShared = false,
  _existingBatchSharedCodes: string[] = [],
) {
  const allFields = template.groups.flatMap(g => g.fields);
  const computedCodes = new Set(allFields.filter(f => f.type === 'computed').map(f => f.code));
  const autoCodes = new Set(allFields.filter(f => f.semantic_role).map(f => f.code));
  // “公共”只控制拉取资格；所有录入值均独立保存在当前记录中。
  const stripped = stripMatrixFlatKeys(template, data);
  const rawData: Record<string, any> = {};
  const derivedData: Record<string, any> = {};
  const sharedData: Record<string, any> = {};
  for (const [k, v] of Object.entries(stripped)) {
    if (autoCodes.has(k)) continue;
    if (computedCodes.has(k)) derivedData[k] = v;
    else rawData[k] = v;
  }
  return { rawData, derivedData, sharedData, allFields };
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

/** 新建原始记录时，服务编号直接取委托单的订单编号。 */
function buildServiceNo(orderNo: string, order: any): string {
  return String(order?.order_no || orderNo || '').trim();
}

/**
 * 样品编号优先使用接口 SampleSortNo（落库为 sort_no）；
 * 手工单或旧接口没有该字段时，回退到条码 / 样品 ID。
 */
function buildSampleNo(sampleId: string, order: any): string {
  const samples = Array.isArray(order?.payload?.samples) ? order.payload.samples : [];
  const sample = samples.find((item: any) => String(item?.id || '') === String(sampleId));
  return String(
    sample?.sort_no ?? sample?.sample_no ?? sample?.barcode ?? sample?.id ?? sampleId ?? '',
  ).trim();
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
  const [recordBatch, setRecordBatch] = useState<any>(null);
  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
  const permissionReadOnly = searchParams.get('readonly') === '1' || !user || !has('record.entry');
  const contentLocked = recordRow?.audit_status === 'reviewed' || !!recordRow?.cancelled_at;
  const leaseEligible = !!recordId && !!recordRow && !permissionReadOnly && !contentLocked;
  const lease = useExclusiveEditLease({
    resourceType: 'record_data', resourceId: recordId,
    enabled: leaseEligible,
  });
  const readOnly = permissionReadOnly || contentLocked || (leaseEligible && (lease.loading || !lease.acquired));
  const shouldRemindStartEditing = leaseEligible && !lease.loading && !lease.acquired && !lease.holderName;
  // 导入 Excel 留存：已保存到订单的附件 + 未保存（pending）的待上传文件
  const [attachments, setAttachments] = useState<Array<{ id: string; filename: string; pending?: boolean; kind?: string; size_bytes?: number }>>([]);
  const pendingExcelsRef = useRef<File[]>([]);
  const savedSigRef = useRef('');
  const savedDataRef = useRef<{ rawData: Record<string, any>; derivedData: Record<string, any>; sharedData: Record<string, any> }>({ rawData: {}, derivedData: {}, sharedData: {} });
  const baselineReadyRef = useRef(false);
  const viewerRef = useRef<TypstViewerHandle>(null);
  const [activeFieldCode, setActiveFieldCode] = useState<string | null>(null);
  const [pullOpen, setPullOpen] = useState(false);
  const [pullLoading, setPullLoading] = useState(false);
  const [pullSources, setPullSources] = useState<any[]>([]);
  const [pullSourceId, setPullSourceId] = useState<number | undefined>();
  const [pullPreview, setPullPreview] = useState<any | null>(null);
  const [replacePulledValues, setReplacePulledValues] = useState(false);
  const pullDifferences = pullPreview?.skipped.filter((item: any) => !item.identical) || [];
  const pullUnchanged = pullPreview?.skipped.filter((item: any) => item.identical) || [];
  const pullCount = (pullPreview?.matched.length || 0) + pullUnchanged.length + (replacePulledValues ? pullDifferences.length : 0);
  const transferText = (value: any) => Array.isArray(value) ? value.join('、')
    : value && typeof value === 'object' ? ('custom' in value ? String(value.custom ?? '') : JSON.stringify(value)) : String(value ?? '');
  const pullRequestRef = useRef(0);

  const effectiveOrderNo = String(recordRow?.order_no || ctxOrderNo || '');
  const effectiveSampleId = String(recordRow?.sample_external_id || ctxSampleId || '');
  const effectiveTestName = String(recordRow?.test_item_name || ctxTestName || '');

  useEffect(() => {
    if (!effectiveOrderNo) { setWorkOrder(null); return; }
    let cancelled = false;
    axios.get(`${API}/work-orders/${encodeURIComponent(effectiveOrderNo)}`)
      .then(response => { if (!cancelled) setWorkOrder(response.data); })
      .catch(() => { if (!cancelled) setWorkOrder(null); });
    return () => { cancelled = true; };
  }, [effectiveOrderNo]);

  const currentSample = workOrder?.payload?.samples?.find(sample => String(sample.id) === effectiveSampleId)
    || workOrder?.payload?.samples?.find(sample => !!ctxSampleName && sample.name === ctxSampleName);
  const currentTest = currentSample?.test_infos?.find(test => test.name === effectiveTestName);
  const pullTemplateIds = [...new Set(currentTest ? normalizeLinkedIds(currentTest) : [])];
  const canPullPublic = pullTemplateIds.length > 1 && pullTemplateIds.includes(Number(recordRow?.template_id || templateId));
  const pullScope = { orderNo: effectiveOrderNo, sampleId: effectiveSampleId, testName: effectiveTestName,
    recordId, templateId: Number(recordRow?.template_id || templateId), templateIds: pullTemplateIds };

  const uploadExcelAttachment = async (id: string | number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', 'excel');   // 标记为 Excel 留存（与通用附件区分，只在数据表区显示）
    const res = await axios.post(`${API}/excel-import/${id}/attachments`, fd);
    return res.data as { id: string; filename: string; size_bytes?: number };
  };
  /** 把暂存（未保存时导入）的 Excel 在拿到 recordId 后补传，并用真实附件替换 pending 占位。 */
  const flushPendingExcels = async (id: string | number) => {
    if (!pendingExcelsRef.current.length) return;
    const files = pendingExcelsRef.current;
    pendingExcelsRef.current = [];
    const uploaded: Array<{ id: string; filename: string; size_bytes?: number }> = [];
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
      setAttachments(prev => [...prev, {
        id: `pending_${Date.now()}`,
        filename: file.name,
        pending: true,
        kind: 'excel',
        size_bytes: file.size,
      }]);
    }
  };

  /** 把 record_data 五列（含审核状态）按 semantic_role 注入到 data，供 FormRenderer 显示。 */
  const injectAuditFields = (tmpl: RecordTemplate, base: Record<string, any>, row: any): Record<string, any> => {
    const out = { ...base };
    for (const f of tmpl.groups.flatMap(g => g.fields)) {
      if (!f.semantic_role) continue;
      if (f.semantic_role === 'inspector') out[f.code] = row?.tester_name || (has('record.entry') ? (user?.display_name ?? '') : '');
      // 保留权威时间戳到最终渲染层再按字段精度格式化，避免中途先截成“日”后无法恢复小时/分钟。
      else if (f.semantic_role === 'inspector_date') out[f.code] = row?.tested_at || (has('record.entry') ? new Date().toISOString() : '');
      else if (f.semantic_role === 'reviewer') out[f.code] = row?.reviewer_name || '';
      else if (f.semantic_role === 'reviewer_date') out[f.code] = row?.reviewed_at || '';
    }
    return out;
  };

  useEffect(() => {
    if (recordId) return;
    if (templateId) {
      baselineReadyRef.current = false;
      setLoading(true);
      axios.get(`${API}/record-templates/${templateId}`)
        .then(async res => {
          const tmpl: RecordTemplate = {
            id: res.data.id,
            name: res.data.name,
            version: res.data.version,
            groups: ensureRecordIdentityFields(res.data.field_definitions),
            typst_source: res.data.typst_source,
            layout_options: res.data.layout_options || {},
          };
          const defaults = buildFieldDefaults(tmpl);
          // 仅新建记录时写入一次可编辑默认值；已存在记录及用户后续手动修改均不受影响。
          const fields = tmpl.groups.flatMap(group => group.fields);
          const serviceField = fields.find(
            field => field.code === 'service_no' || field.label?.trim() === '服务编号',
          );
          const sampleNoField = fields.find(
            field => field.code === 'sample_no' || field.label?.trim() === '样品编号',
          );
          if ((serviceField && ctxOrderNo) || (sampleNoField && ctxSampleId)) {
            let order: any = null;
            if (ctxOrderNo) {
              try {
                const orderRes = await axios.get(`${API}/work-orders/${encodeURIComponent(ctxOrderNo)}`);
                order = orderRes.data;
              } catch {
                // 委托单读取失败时使用路由上下文回退，不阻塞录入。
              }
            }
            const serviceNo = buildServiceNo(ctxOrderNo, order);
            const sampleNo = buildSampleNo(ctxSampleId, order);
            if (serviceField && serviceNo) defaults[serviceField.code] = serviceNo;
            if (sampleNoField && sampleNo) defaults[sampleNoField.code] = sampleNo;
          }
          setTemplate(tmpl);
          // 新建记录：应用模板配置的字段默认值（实验员可改；矩阵默认值走 createEmptyMatrixValue）
          setData(defaults);
        })
        .catch(() => message.error('加载原始记录模板失败'))
        .finally(() => setLoading(false));
    }
  }, [templateId, recordId, ctxOrderNo, ctxSampleId]);

  useEffect(() => {
    if (!recordId) return;
    baselineReadyRef.current = false;
    setLoading(true);
    axios.get(`${API}/record-data/${recordId}`).then(async res => {
      const rec = res.data;
      let sharedData: Record<string, any> = {};
      if (rec.record_batch_id) {
        try {
          const batch = (await axios.get(`${API}/record-batches/${rec.record_batch_id}`)).data;
          setRecordBatch(batch);
          sharedData = batch.shared_data || {};
        } catch { setRecordBatch(null); }
      } else setRecordBatch(null);
      const merged = { ...sharedData, ...rec.raw_data, ...rec.derived_data };
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
        groups: ensureRecordIdentityFields(fieldDefs),
        layout_options: layout,
      };
      setTemplate(tmpl);
      let populated = ensureDataMatrixDefaults(tmpl, merged);
      const identityFields = tmpl.groups.flatMap(group => group.fields);
      const serviceField = identityFields.find(field => field.code === 'service_no' || field.label?.trim() === '服务编号');
      const sampleNoField = identityFields.find(field => field.code === 'sample_no' || field.label?.trim() === '样品编号');
      if ((serviceField && !populated[serviceField.code]) || (sampleNoField && !populated[sampleNoField.code])) {
        let order: any = null;
        if (rec.order_no) {
          try { order = (await axios.get(`${API}/work-orders/${encodeURIComponent(rec.order_no)}`)).data; } catch { /* 路由上下文兜底 */ }
        }
        if (serviceField && !populated[serviceField.code]) {
          populated = { ...populated, [serviceField.code]: buildServiceNo(rec.order_no || '', order) };
        }
        if (sampleNoField && !populated[sampleNoField.code]) {
          populated = { ...populated, [sampleNoField.code]: buildSampleNo(rec.sample_external_id || '', order) };
        }
      }
      setData(injectAuditFields(tmpl, populated, rec));
    }).finally(() => setLoading(false));
  }, [recordId]);

  useEffect(() => {
    if (!template) return;
    setData(d => {
      const next = injectAuditFields(template, ensureDataMatrixDefaults(template, d), recordRow);
      // 基线必须取「注入后」的内容——矩阵默认行/审核字段等自动注入不是用户改动；
      // 此前基线在注入前计算，新建录入一打开（没碰任何字段）就误报"有未保存的修改"。
      savedSigRef.current = computeSig(next);
      const saved = splitData(template, next, !!recordRow?.record_batch_id, Object.keys(recordBatch?.shared_data || {}));
      savedDataRef.current = { rawData: saved.rawData, derivedData: saved.derivedData, sharedData: saved.sharedData };
      baselineReadyRef.current = true;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id, recordRow?.id, recordBatch?.id, user?.user_name]);

  // 「已保存」签名（仅含用户录入的 raw/derived，排除自动注入字段）——用于未保存守卫
  const computeSig = (d: Record<string, any>): string => {
    if (!template) return '';
    const { rawData, derivedData, sharedData } = splitData(template, d, !!recordRow?.record_batch_id, Object.keys(recordBatch?.shared_data || {}));
    return JSON.stringify({ rawData, derivedData, sharedData });
  };

  const isDirty = () => !readOnly && baselineReadyRef.current && !!template && computeSig(data) !== savedSigRef.current;
  const { confirmLeave } = useUnsavedGuard(isDirty);

  const collaborationChanges = useMemo(() => {
    if (!template || !baselineReadyRef.current) return [];
    const current = splitData(template, data, !!recordRow?.record_batch_id, Object.keys(recordBatch?.shared_data || {}));
    const labels = new Map(template.groups.flatMap(group => group.fields).map(field => [field.code, field.label || field.code]));
    template.groups.forEach(group => {
      labels.set(figureCaptionGroupKey(group.id), `${group.label || '图片分区'}（图备注）`);
      group.fields.forEach(field => labels.set(figureCaptionFieldKey(field.code), `${field.label || field.code}（${field.type === 'image' ? '图' : '表'}备注）`));
    });
    const codes = new Set([
      ...Object.keys(savedDataRef.current.rawData), ...Object.keys(savedDataRef.current.derivedData),
      ...Object.keys(savedDataRef.current.sharedData), ...Object.keys(current.rawData), ...Object.keys(current.derivedData), ...Object.keys(current.sharedData),
    ]);
    return [...codes].filter(code => {
      const oldValue = code in savedDataRef.current.sharedData ? savedDataRef.current.sharedData[code]
        : code in savedDataRef.current.rawData ? savedDataRef.current.rawData[code] : savedDataRef.current.derivedData[code];
      const newValue = code in current.sharedData ? current.sharedData[code]
        : code in current.rawData ? current.rawData[code] : current.derivedData[code];
      return JSON.stringify(oldValue) !== JSON.stringify(newValue);
    }).map(code => labels.get(code) || code).slice(0, 12);
  }, [template, data]);
  const backTo = ctxOrderNo ? `/lab/order/${encodeURIComponent(ctxOrderNo)}` : '/lab';


  /** 从同一订单/样品/项目的另一份原始记录中查找可复用数据。 */
  const openPullData = async () => {
    if (!template || !canPullPublic) return;
    const request = ++pullRequestRef.current;
    setPullOpen(true); setPullLoading(true); setPullSources([]); setPullSourceId(undefined); setPullPreview(null);
    setReplacePulledValues(false);
    try {
      const [recordsResult, templatesResult] = await Promise.all([
        axios.get(`${API}/record-data?order_no=${encodeURIComponent(effectiveOrderNo)}`),
        axios.get(`${API}/record-templates`),
      ]);
      const names = new Map((templatesResult.data || []).map((item: any) => [Number(item.id), item.name]));
      if (request !== pullRequestRef.current) return;
      setPullSources((recordsResult.data || []).filter((item: any) => isRecordPullSource(item, pullScope))
        .map((item: any) => ({ ...item, template_name: names.get(Number(item.template_id)) || `模板 #${item.template_id}` })));
    } catch (error: any) { message.error(error?.response?.data?.error || '其他录入记录加载失败'); }
    finally { if (request === pullRequestRef.current) setPullLoading(false); }
  };

  const previewPullData = async (sourceId: number) => {
    if (!template || !pullSources.some(source => Number(source.id) === sourceId)) return;
    const request = ++pullRequestRef.current;
    setPullSourceId(sourceId); setPullPreview(null); setPullLoading(true);
    setReplacePulledValues(false);
    try {
      const source = (await axios.get(`${API}/record-data/${sourceId}`)).data;
      if (!isRecordPullSource(source, pullScope)) throw new Error('该记录已不属于当前项目的可用来源，请重新选择');
      let sourceGroups: any[] = [];
      if (source.template_version_id) {
        sourceGroups = (await axios.get(`${API}/record-templates/${source.template_id}/versions/${source.template_version_id}`)).data.field_definitions || [];
      }
      if (!source.template_version_id) sourceGroups = (await axios.get(`${API}/record-templates/${source.template_id}`)).data.field_definitions || [];
      if (request !== pullRequestRef.current) return;
      setPullPreview(matchPublicRecordFields(template.groups, sourceGroups, data, { ...source.batch_shared_data, ...source.raw_data }));
    } catch (error: any) { if (request === pullRequestRef.current) { message.error(error?.response?.data?.error || error.message || '数据匹配失败'); setPullPreview(null); } }
    finally { if (request === pullRequestRef.current) setPullLoading(false); }
  };

  const applyPulledData = () => {
    if (readOnly || pullLoading || !pullPreview || !pullCount) return;
    const patch = publicRecordTransferPatch(data, pullPreview, replacePulledValues);
    if (!Object.keys(patch).length) { message.info('当前内容已变化，请重新选择来源核对'); return; }
    setData(previous => ({ ...previous, ...publicRecordTransferPatch(previous, pullPreview, replacePulledValues) }));
    message.success(`已填充 ${Object.keys(patch).length} 个字段；请核对，结束编辑时会保存`);
    setPullOpen(false);
  };

  /** 保存数据。status='draft' 存草稿（不校验必填）；'pending' 提交审核（校验必填）。返回是否成功。 */
  const handleSave = async (status: 'draft' | 'pending', options: { silent?: boolean } = {}): Promise<boolean> => {
    if (!template) return false;
    if (!user || !has('record.entry')) {
      message.error('请以主检身份登录后再操作');
      return false;
    }
    const { rawData, derivedData, sharedData, allFields } = splitData(template, data, !!recordRow?.record_batch_id, Object.keys(recordBatch?.shared_data || {}));

    if (status === 'pending') {
      const missing = allFields.filter(f => {
        if (!f.required || f.type === 'computed') return false;
        const storedValue = rawData[f.code];
        // 结论模块的独立字段允许模板给默认值；录入人未覆盖时直接采用默认值，仍可在表单中改写。
        const v = f.conclusion_role && (storedValue === null || storedValue === undefined || storedValue === '')
          ? f.default_value
          : storedValue;
        if (f.type === 'data_matrix') return !matrixHasAnyValue(v);
        if (f.type === 'device_ref') return !Array.isArray(v) || v.length === 0;
        if (f.type === 'record_conclusion') {
          const cfg = f.record_conclusion;
          if (!cfg || !v || typeof v !== 'object' || !String((v as any).project_name ?? cfg.project_name ?? '').trim()) return true;
          const values = Array.isArray((v as any).items) ? (v as any).items : [];
          const reportable = (cfg.items || []).filter(definition => {
            const item = values.find((entry: any) => entry?.item_code === definition.code || entry?.code === definition.code) || {};
            const completed = (item.execution_status || 'completed') === 'completed';
            const enabled = item.report_enabled ?? definition.default_report_enabled !== false;
            const named = cfg.mode === 'overall' || !!String(item.display_name ?? definition.name ?? '').trim();
            return completed && enabled && named;
          });
          if (!reportable.length) return cfg.allow_no_completed_items !== true;
          return reportable.some(definition => {
            const item = values.find((entry: any) => entry?.item_code === definition.code || entry?.code === definition.code) || {};
            const judgmentRequired = definition.judgment_required ?? definition.required !== false;
            const conclusionRequired = definition.conclusion_required ?? definition.required !== false;
            return (judgmentRequired && !String(item.judgment_requirement ?? definition.judgment_requirement ?? '').trim())
              || (conclusionRequired && !String(item.conclusion ?? '').trim());
          });
        }
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
        const rawPatch: Record<string, any> = {};
        const derivedPatch: Record<string, any> = {};
        const removeRaw: string[] = [];
        const removeDerived: string[] = [];
        const collectPatch = (current: Record<string, any>, saved: Record<string, any>, patch: Record<string, any>, removed: string[]) => {
          for (const code of new Set([...Object.keys(current), ...Object.keys(saved)])) {
            if (JSON.stringify(current[code]) === JSON.stringify(saved[code])) continue;
            if (Object.prototype.hasOwnProperty.call(current, code)) patch[code] = current[code];
            else removed.push(code);
          }
        };
        collectPatch(rawData, savedDataRef.current.rawData, rawPatch, removeRaw);
        collectPatch(derivedData, savedDataRef.current.derivedData, derivedPatch, removeDerived);
        const response = await axios.put(`${API}/record-data/${recordId}`, {
          raw_patch: rawPatch, derived_patch: derivedPatch,
          remove_raw_fields: removeRaw, remove_derived_fields: removeDerived,
          status: recordRow?.record_batch_id && status === 'pending' ? 'draft' : status,
          base_raw_data: savedDataRef.current.rawData,
          base_derived_data: savedDataRef.current.derivedData,
        }, { headers: lease.headers });
        await flushPendingExcels(recordId);
        const merged = injectAuditFields(template, ensureDataMatrixDefaults(template, {
          ...(response.data.raw_data || {}), ...(response.data.derived_data || {}), ...sharedData,
        }), response.data);
        setData(current => rebaseRecordSave(data, current, merged));
        setRecordRow(response.data);
        savedDataRef.current = {
          rawData: response.data.raw_data || {}, derivedData: response.data.derived_data || {}, sharedData,
        };
        savedSigRef.current = JSON.stringify(savedDataRef.current);
        baselineReadyRef.current = true;
        if (recordRow?.record_batch_id && status === 'pending') {
          await axios.post(`${API}/record-batches/${recordRow.record_batch_id}/submit`, undefined, { headers: lease.headers });
        }
        if (!options.silent) message.success(status === 'draft' ? '草稿已保存' : '已提交审核');
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
        savedDataRef.current = { rawData: res.data.raw_data || rawData, derivedData: res.data.derived_data || derivedData, sharedData };
        savedSigRef.current = JSON.stringify(savedDataRef.current);
        baselineReadyRef.current = true;
        if (!options.silent) message.success(status === 'draft' ? '草稿已保存' : '已提交审核');
        if (status === 'pending') {
          navigate(backTo);
        } else {
          // 新建记录保存前尚无资源 ID；保存成功后先替当前用户取得编辑权，避免写入 ID 后突然变为只读。
          await axios.post(`${API}/collaboration/leases/acquire`, {
            resource_type: 'record_data', resource_id: String(res.data.id),
          }).catch(() => undefined);
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
    } catch (error: unknown) {
      const responseData = (error as { response?: { data?: { error?: string; code?: string; conflict_fields?: string[] } } })?.response?.data;
      const apiMessage = responseData?.error;
      if (responseData?.code === 'field_edit_conflict' && template) {
        const labelMap = new Map(template.groups.flatMap(group => group.fields).map(field => [field.code, field.label || field.code]));
        message.warning(`保存冲突：${(responseData.conflict_fields || []).map(code => labelMap.get(code) || code).join('、')} 已被其他人员修改，请刷新页面后确认`);
        return false;
      }
      message.error(apiMessage || '保存失败');
      return false;
    } finally {
      setSaving(false);
    }
  };

  useAutoSave({
    enabled: baselineReadyRef.current && !loading && !saving && !!template && !readOnly,
    isDirty,
    save: () => handleSave('draft', { silent: true }),
  });

  // 「测试设备」字段：反查设备名称，PDF 显示「设备名称：管理编号」（录入端只存管理编号数组）。
  const deviceMap = useDeviceMap(template, data);
  const typstSource = template ? generateTypstWithData(template, data, { deviceMap }) : '';

  if (loading) return <Spin style={{ margin: '100px auto', display: 'block' }} />;

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'clip' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #e8ecf3', background: '#fff', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 1px 2px rgba(16,24,40,0.03)' }}>
        <Button onClick={() => confirmLeave(() => navigate(backTo), readOnly ? undefined : () => handleSave('draft'))}>← 返回</Button>
        {template ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span style={{ width: 3, height: 18, borderRadius: 2, background: BRAND }} />
            <h3 style={{ margin: 0, whiteSpace: 'nowrap', color: '#1f2733' }}>{template.name}</h3>
            <Space size={6} wrap>
              {effectiveOrderNo && <Tag color="blue" style={{ fontFamily: 'monospace', margin: 0 }}>{effectiveOrderNo}</Tag>}
              {currentSample && <Tag bordered={false} style={{ margin: 0, background: '#fff7e6', color: '#ad6800' }}>样品编号 {currentSample.sort_no || currentSample.id}</Tag>}
              {(currentSample?.name || ctxSampleName) && <Tag bordered={false} style={{ margin: 0, background: '#eef2f8', color: '#475467' }}>样品 {currentSample?.name || ctxSampleName}</Tag>}
              {effectiveTestName && <Tag bordered={false} style={{ margin: 0, background: '#eef2f8', color: '#475467' }}>项目 {effectiveTestName}</Tag>}
              <Tag bordered={false} style={{ margin: 0, background: '#f1f3f7', color: '#667085' }}>v{template.version}</Tag>
            </Space>
          </div>
        ) : (
          <h3 style={{ margin: 0, flex: 1, color: '#aaa' }}>请从录入工作台选择测试项目进入</h3>
        )}
        {!!recordId && <DocumentCollaborationStatus resourceType="record_data" resourceId={recordId}
          canEdit={leaseEligible} lease={lease} onSaveBeforeRelease={() => handleSave('draft')}
          changes={collaborationChanges} saving={saving} />}
        {readOnly && !leaseEligible ? (
          <Tag icon={<EyeOutlined />} style={{ margin: 0 }}>只读预览</Tag>
        ) : !readOnly ? (
          <Space>
            {canPullPublic && <Button icon={<ImportOutlined />} onClick={openPullData} disabled={!template || !effectiveOrderNo}>拉取公共字段</Button>}
            {!recordId && <Button icon={<SaveOutlined />} onClick={() => handleSave('draft')} loading={saving} disabled={!template}>保存草稿</Button>}
            <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => handleSave('pending')} loading={saving} disabled={!template}>提交审核</Button>
          </Space>
        ) : null}
      </div>
      {template && (!user || !has('record.entry')) && (
        <Alert
          banner type="info" showIcon
          message="当前账号没有录入权限，正在以只读方式预览。"
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
      {template && recordRow?.cancelled_at && (
        <Alert banner type="warning" showIcon
          message="该测试方法已标记为取消检测，当前仅供查看和追溯"
          description={`取消人：${recordRow.cancelled_by_name || '—'}；原因：${recordRow.cancel_reason || '—'}`}
          style={{ borderRadius: 0 }} />
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
          <div style={{ width: '46%', minWidth: 0, minHeight: 0, borderRight: '1px solid #e8ecf3', overflow: 'auto', background: APP_BG }}>
            {currentSample && currentTest && (
              <div style={{ position: 'sticky', top: 0, zIndex: 8, padding: '12px 16px 8px', background: APP_BG, boxShadow: '0 5px 12px rgba(31, 50, 73, 0.08)' }}>
                <RecordOrderContextCard sample={currentSample} test={currentTest} />
              </div>
            )}
            {/* 已审核＝详情只读：编辑器照常显示，但不可交互（pointerEvents:none），仅供查看 */}
            <EditAttemptGuard active={shouldRemindStartEditing} style={readOnly ? { opacity: 0.82 } : undefined}>
              <div style={readOnly ? { pointerEvents: 'none' } : undefined}>
                <FormRenderer template={template} data={data} onChange={setData}
                  activeFieldCode={activeFieldCode}
                  onFocusField={(field, group, detailCode) => {
                    setActiveFieldCode(field.code);
                    viewerRef.current?.scrollToMarker(detailCode || field.code, group.id, detailCode
                      ? { label: field.label ? `当前：${field.label}` : '当前编辑位置', mode: 'text' }
                      : markerHighlightForField(field));
                  }}
                  recordId={recordId}
                  uploadCtx={{ orderNo: ctxOrderNo, recordDir: [ctxSampleName, ctxTestName].filter(Boolean).join('_') }}
                  excelAttachments={attachments.filter(a => (a as any).kind === 'excel' || (a as any).pending)}
                  onExcelImported={handleExcelImported} />
              </div>
            </EditAttemptGuard>
            {/* 录入详情页最下方：通用附件（任意格式），与订单详情页每行「附件」同一出口（record_data.attachments）。
                附件面板放在只读遮罩之外，已审核时仍可下载（上传由 readOnly 关闭） */}
            <div style={{ padding: '8px 16px 16px', borderTop: '1px dashed #e8ecf3', margin: '8px 16px 0' }}>
              <AttachmentManager recordId={recordId} kind="file"
                title={readOnly ? '附件（含导入 Excel，可下载）' : '附件（任意格式，可随时下载）'}
                readOnly={readOnly}
                listAll={readOnly} />     {/* 只读详情时这里汇总所有可下载文件（编辑器内的链接已不可点） */}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <TypstViewer ref={viewerRef} enableSync source={typstSource} mode="view" height="100%"
              downloadName={`${template?.name || '原始记录'}${ctxSampleName ? '-' + ctxSampleName : ''}.pdf`} />
          </div>
        </div>
      )}
      <Modal open={pullOpen} title="拉取公共字段" width={720}
        onCancel={() => { ++pullRequestRef.current; setPullOpen(false); }} onOk={applyPulledData} okText="填充匹配字段"
        okButtonProps={{ disabled: readOnly || !pullCount, loading: pullLoading }}>
        <Select showSearch optionFilterProp="label" style={{ width: '100%' }} loading={pullLoading}
          value={pullSourceId} placeholder="选择一份已有数据的原始记录" onChange={previewPullData}
          options={pullSources.map(source => ({ value: Number(source.id), label: `${source.template_name} · 记录 #${source.id} · ${source.audit_status === 'reviewed' ? '已审核' : source.audit_status === 'pending' ? '待审核' : '草稿'}` }))} />
        {!pullLoading && !pullSources.length && <div style={{ color: '#999', textAlign: 'center', padding: 24 }}>其他原始记录尚未录入，暂无可拉取的数据</div>}
        {pullPreview && <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
          {!pullPreview.matched.length && !pullPreview.skipped.length && <div style={{ color: '#999', textAlign: 'center', padding: 16 }}>没有可匹配的公共字段</div>}
          {!!pullPreview.matched.length && <div><b>匹配的公共字段：</b><div style={{ marginTop: 5 }}>{pullPreview.matched.map((item: any) => <div key={item.code} style={{ padding: '8px 0', borderBottom: '1px solid #eee', whiteSpace: 'pre-wrap' }}><strong>{item.label || item.code}：</strong>{Array.isArray(item.value) ? item.value.join('、') : typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value)}</div>)}</div></div>}
          {!!pullDifferences.length && <div>
            <Checkbox checked={replacePulledValues} onChange={event => setReplacePulledValues(event.target.checked)}>使用来源值替换以下不同内容</Checkbox>
            {pullDifferences.map((item: any) => <div key={item.code} style={{ padding: '8px 0', borderBottom: '1px solid #eee', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              <strong>{item.label}：</strong><div style={{ color: '#777' }}>当前：{transferText(item.value)}</div><div>来源：{transferText(item.sourceValue)}</div>
            </div>)}
          </div>}
          {!!pullUnchanged.length && <div><b>以下内容与来源一致，可直接确认填充：</b><div style={{ marginTop: 5 }}>{pullUnchanged.map((item: any) => <Tag key={item.code}>{item.label || '未命名字段'}</Tag>)}</div></div>}
          {!!pullPreview.unmatched.length && <div><b>需要手工填写或确认：</b><div style={{ marginTop: 5, maxHeight: 130, overflow: 'auto' }}>{pullPreview.unmatched.map((item: any) => <div key={item.code} style={{ color: '#8c5a00', lineHeight: 1.8 }}>{item.label || item.code}：{item.reason}</div>)}</div></div>}
        </div>}
      </Modal>
    </div>
  );
}
