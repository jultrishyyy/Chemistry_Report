/**
 * 模板版本管理面板
 *
 * 嵌入到模板编辑器顶部 / 列表页操作列。承担：
 *   - 状态展示（draft / pending / approved / rejected）+ 紧凑的退回原因入口
 *   - 提交审核按钮 / 撤回按钮（pending → draft）
 *   - 审核 Drawer：修改说明 + 属性级 diff + 新旧版 PDF 对比 + 通过/退回
 *   - 版本历史 Drawer（Tab1 = 版本 Timeline + 每版 diff + 查看此版本；Tab2 = 操作日志）
 *   - 派生关系（Lineage）Drawer + 母 → 子同步入口
 *   - Fork 子模板 Modal / 同步向导（dry-run 预览 → 选择子模板 → 生成待审版本）
 *
 * 通过 kind='record' | 'report' 切换调用的 API。
 */
import { useState, useEffect, useMemo, type ReactNode, type CSSProperties } from 'react';
import { templateActorLabel } from '../utils/templateActorLabel';
import { useNavigate } from 'react-router-dom';
import {
  Button, Space, Tag, Modal, Drawer, Timeline, Empty, message, Input,
  Alert, Tree, Tooltip, Collapse, Tabs, Segmented, Checkbox, Switch, Spin, Popover,
} from 'antd';
import {
  HistoryOutlined, BranchesOutlined, AuditOutlined, SendOutlined, ForkOutlined,
  EyeOutlined, RollbackOutlined, SyncOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { useAuth } from '../auth';
import TypstViewer from './TypstViewer';
import TemplatePdfPreviewModal from './TemplatePdfPreviewModal';
import {
  generateTypst, generateTypstWithData, injectReportFieldsIntoTypst, type ReportRenderCtx,
} from '../../../shared/typst-generator';
import { generateMockData } from '../../../shared/mock-data';
import { FIELD_PROP_LABELS, type TemplateFieldDiff } from '../../../shared/template-diff';
import type { RecordTemplate, TemplateAuditEntry } from '../../../shared/types';

const API = '/api';

export type TemplateKind = 'record' | 'report';

interface VersionRow {
  id: number;
  version_no: number;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'superseded';
  author_name: string;
  submitted_by_name?: string | null;
  submitted_by_job_no?: string | null;
  reviewer_name?: string | null;
  review_note?: string | null;
  change_summary?: string | null;
  diff_from_prev?: any[] | null;
  created_at: string;
  reviewed_at?: string | null;
}

interface OpenDraft {
  id: number;
  version_no: number;
  status: 'draft' | 'pending' | 'rejected';
  author_name: string;
  submitted_by_name?: string | null;
  submitted_by_job_no?: string | null;
  reviewer_name?: string | null;
  review_note?: string | null;
  change_summary?: string | null;
  updated_at?: string;
}

interface Props {
  kind: TemplateKind;
  templateId: number;
  templateName?: string;
  /** 当前 base.current_version_no */
  currentVersionNo?: number;
  /** 当前未关闭的 draft / pending / rejected 版本（来自列表 API 或编辑器加载） */
  openDraft?: OpenDraft | null;
  /** 通知父组件刷新（审核通过 / 退回 / fork 等会改 base） */
  onRefresh?: () => void;
  /** 紧凑模式：只渲染状态 tag + 历史按钮（用于列表页） */
  compact?: boolean;
  /** 仅显示操作按钮（历史 / 派生关系 / 派生子模板 / 审核），不显示状态 tag */
  actionsOnly?: boolean;
  /**
   * actionsOnly 模式下只渲染指定按钮（列表页把按钮拆进不同列用）。
   * 缺省 = 全部。'submit' 隐含按状态显示 提交审核 / 审核 / 撤回。
   */
  buttons?: Array<'history' | 'lineage' | 'fork' | 'submit'>;
  /**
   * 紧凑图标模式（列表页防换行）：版本历史/派生关系 = 紫色文字型图标钮（信息查看组），
   * +子模板 = 描边图标钮；流程操作统一使用带颜色的语义图标，悬停显示完整操作名称。
   */
  iconOnly?: boolean;
  /** 编辑器路由前缀（「查看此版本」用）。report 模板按 template_kind 不同传不同编辑器 */
  editorPathBase?: string;
  /**
   * 提交审核前置校验（编辑器传入）：返回非空字符串＝阻断提交并以此提示，返回 null/undefined＝放行。
   * 用于项目报告模板「检测结论必填」等编辑器侧业务校验（服务端 submit 仍会兜底校验）。
   */
  submitGuard?: () => string | null | undefined;
  /** 仅用于列表的内容操作锁定：历史仍可查看，新增/编辑类按钮统一灰显。 */
  disabled?: boolean;
  /** disabled=true 时向用户说明为什么当前不能执行编辑类流程操作。 */
  disabledReason?: string;
  /** 编辑器顶栏直接显示“同步到同组模板”，无需先打开关系抽屉。 */
  familySyncShortcut?: boolean;
}

const STATUS_COLOR: Record<string, string> = {
  draft: 'default', pending: 'orange', approved: 'green', rejected: 'red', superseded: 'default',
};
const STATUS_LABEL: Record<string, string> = {
  draft: '草稿', pending: '待审核', approved: '已生效', rejected: '已退回', superseded: '已替代',
};
/** 状态对应的 CSS 色值（版本卡片左侧色条用）。 */
const STATUS_HEX: Record<string, string> = {
  draft: '#8a93a3', pending: '#d97706', approved: '#16a34a', rejected: '#dc2626', superseded: '#b0b7c3',
};
/** 时间格式化为 YYYY-MM-DD HH:mm。 */
const fmtDateTime = (s?: string | null): string => {
  if (!s) return '—';
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const apiBase = (kind: TemplateKind) =>
  kind === 'record' ? `${API}/record-templates` : `${API}/report-templates`;

const defaultEditorPath = (kind: TemplateKind) =>
  kind === 'record' ? '/record-templates/editor' : '/report-templates/editor';

type WorkflowAction = 'submit' | 'withdraw' | 'review';
const WORKFLOW_ICON: Record<WorkflowAction, ReactNode> = {
  submit: <SendOutlined />, withdraw: <RollbackOutlined />, review: <AuditOutlined />,
};
const WORKFLOW_STYLE: Record<WorkflowAction, CSSProperties> = {
  submit: { color: '#1677ff', borderColor: '#91caff', background: '#f0f7ff' },
  withdraw: { color: '#d46b08', borderColor: '#ffd591', background: '#fff7e6' },
  review: { color: '#389e0d', borderColor: '#b7eb8f', background: '#f6ffed' },
};

/** 小而明确的流程按钮：颜色 + 常见语义图标 + Tooltip，避免列表操作栏被长文本撑开。 */
export function WorkflowActionButton({ action, title, disabled, onClick }: {
  action: WorkflowAction; title: string; disabled?: boolean; onClick: () => void;
}) {
  return (
    <Tooltip title={title}>
      <Button size="small" shape="circle" icon={WORKFLOW_ICON[action]} aria-label={title}
        disabled={disabled} onClick={onClick}
        style={disabled ? undefined : WORKFLOW_STYLE[action]} />
    </Tooltip>
  );
}

/** 把版本行拼成 shared 生成器可用的模板对象 */
const rowToTemplate = (row: any, name?: string): RecordTemplate => ({
  name: name || row?.name || '',
  version: row?.version_no || 1,
  groups: row?.field_definitions || [],
  layout_options: row?.layout_options || {},
});

/**
 * 构造预览 Typst 源（与编辑器预览同一管线）。
 * report 模板用 ProjectEditor 同款示例上下文（订单/设备 mock）。
 */
function buildPreviewSource(kind: TemplateKind, tpl: RecordTemplate, linkedRecord: RecordTemplate | null): string {
  if (kind === 'record') return generateTypstWithData(tpl, generateMockData(tpl));
  const src = generateTypst(tpl);
  const mock = linkedRecord ? generateMockData(linkedRecord) : {};
  const ctx: ReportRenderCtx = {
    order: { order_no: 'C202512086592', customer_name: '奇瑞汽车', sample_name: '车门内饰板' },
    record_flat_data: mock,
    record_raw_data: mock,
    linked_record_template: linkedRecord,
    equipment_rows: [
      { name: '万能材料试验机', model: 'INSTRON 5967', asset_code: 'HX2020-G101', trace_date: '2025-02-08', expire_date: '2026-02-07' },
      { name: '电子天平', model: 'ME204', asset_code: 'HX2018-G023', trace_date: '2025-04-01', expire_date: '2026-03-31' },
    ],
  };
  return injectReportFieldsIntoTypst(src, tpl, ctx);
}

const fmtVal = (v: any): string => {
  if (v === null || v === undefined) return '（空）';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 80 ? s.slice(0, 80) + '…' : s;
};

/** 字段级 diff 列表（新格式属性级明细 + migration 014 旧格式兼容） */
function DiffList({ diff }: { diff: any[] }) {
  if (!Array.isArray(diff) || diff.length === 0) {
    return <span style={{ color: '#888', fontSize: 12 }}>与对比版本无字段差异</span>;
  }
  return (
    <div style={{ fontSize: 12 }}>
      {diff.map((d: any, idx: number) => {
        const isLegacy = !d.fieldId && d.key;          // 旧存量格式 {key, kind}
        const label = isLegacy ? d.key : `${d.groupLabel || ''}${d.groupLabel ? ' / ' : ''}${d.fieldLabel || d.fieldId}`;
        return (
          <div key={idx} style={{ padding: '4px 0', borderBottom: '1px dashed #f0f0f0' }}>
            <Tag color={d.kind === 'added' ? 'blue' : d.kind === 'removed' ? 'red' : 'orange'} style={{ marginRight: 4 }}>
              {d.kind === 'added' ? '新增' : d.kind === 'removed' ? '删除' : '修改'}
            </Tag>
            <strong>{label}</strong>
            {Array.isArray(d.changes) && d.changes.length > 0 && (
              <ul style={{ margin: '4px 0 0', paddingLeft: 22, color: '#555' }}>
                {d.changes.map((c: any, i: number) => (
                  <li key={i}>
                    {FIELD_PROP_LABELS[c.prop] || c.prop}：
                    <span style={{ color: '#cf1322', background: '#fff1f0', textDecoration: 'line-through', padding: '0 3px', borderRadius: 3, margin: '0 4px' }}>{fmtVal(c.from)}</span>
                    →
                    <span style={{ color: '#16a34a', background: '#f6ffed', padding: '0 3px', borderRadius: 3, marginLeft: 4 }}>{fmtVal(c.to)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  create: '创建模板', update_draft: '保存草稿', submit: '提交审核', withdraw: '撤回审核',
  approve: '审核通过', reject: '审核退回', fork_out: '派生出子模板', fork_in: '由母模板派生创建',
  sync_out: '向子模板发起同步', sync_in: '接收母模板同步',
  archive: '归档（删除批准生效）', archive_request: '申请删除', archive_request_cancel: '撤销删除申请',
  archive_reject: '删除申请被驳回', restore: '恢复',
  rename: '重命名', controlled: '受控登记', rollback: '回退版本',
  family_change: '修改项目组归属',
};
const ACTION_COLOR: Record<string, string> = {
  approve: 'green', reject: 'red', archive: 'red', archive_request: 'volcano', archive_reject: 'green',
  submit: 'orange', sync_out: 'purple', sync_in: 'purple', rollback: 'gold',
  fork_out: 'cyan', fork_in: 'cyan', create: 'blue',
};

function auditDetailText(e: TemplateAuditEntry): string {
  const d = e.detail || {};
  const parts: string[] = [];
  if (d.version_no) parts.push(`v${d.version_no}`);
  if (e.action === 'rename') parts.push(`「${d.from}」→「${d.to}」`);
  if (e.action === 'fork_out') parts.push(`子模板 #${d.child_template_id}「${d.child_name}」`);
  if (e.action === 'fork_in') parts.push(`母模板 #${d.parent_template_id} v${d.source_version_no}`);
  if (e.action === 'sync_out') parts.push(`源 v${d.source_version_no}，应用 ${d.applied?.length ?? 0} 个，跳过 ${d.skipped?.length ?? 0} 个`);
  if (e.action === 'sync_in') {
    const s = d.stats || {};
    parts.push(`来自母模板 #${d.parent_template_id} v${d.source_version_no}（替换${s.replaced?.length ?? 0}·删除${s.removed?.length ?? 0}·新增${s.added?.length ?? 0}）`);
  }
  if (e.action === 'archive' && d.force) parts.push('强制（解除报告模板关联 + 子模板 parent）');
  if (e.action.startsWith('archive') && d.requested_by) parts.push(`申请人：${d.requested_by}`);
  if (e.action === 'archive' && d.request_note) parts.push(`申请原因：${d.request_note}`);
  if (e.action === 'rollback') parts.push(
    d.discard_draft ? `恢复为生效版本 v${d.source_version_no}，丢弃草稿 v${d.discarded_draft_version_no}`
    : d.reset_draft ? `草稿 v${d.draft_version_no} 恢复为 v${d.source_version_no} 内容`
    : `回退到 v${d.source_version_no} → 新建待审 v${d.new_version_no}`);
  if (e.action === 'controlled' && d.controlled_no) parts.push(`受控号 ${d.controlled_no}`);
  if (d.note) parts.push(`备注：${d.note}`);
  if (d.change_summary) parts.push(`说明：${d.change_summary}`);
  return parts.join('　');
}

export default function TemplateVersionPanel({
  kind, templateId, templateName, currentVersionNo, openDraft, onRefresh, compact, actionsOnly, buttons, iconOnly, editorPathBase, submitGuard, disabled, disabledReason,
  familySyncShortcut,
}: Props) {
  const { user, has } = useAuth();
  const editorPath = editorPathBase || defaultEditorPath(kind);
  const canEditKind = has(kind === 'record' ? 'record_template.edit' : 'report_template.edit') && !disabled;
  const isReviewOperator = has(kind === 'record' ? 'record.review' : 'report.review');

  const [historyOpen, setHistoryOpen] = useState(false);
  const [lineageOpen, setLineageOpen] = useState(false);
  const [lineage, setLineage] = useState<{ ancestors: any[]; descendants: any[]; family?: any } | null>(null);
  const [lineageLoading, setLineageLoading] = useState(false);

  const [reviewOpen, setReviewOpen] = useState(false);

  const [forkOpen, setForkOpen] = useState(false);
  const [forkName, setForkName] = useState('');
  const [forkSubmitting, setForkSubmitting] = useState(false);

  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitSummary, setSubmitSummary] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [syncOpen, setSyncOpen] = useState(false);
  const [familySyncOpen, setFamilySyncOpen] = useState(false);

  const loadLineage = async () => {
    setLineageLoading(true);
    try {
      const r = await axios.get(`${apiBase(kind)}/${templateId}/lineage`);
      setLineage(r.data);
      return r.data;
    } finally { setLineageLoading(false); }
  };

  useEffect(() => { if (lineageOpen) loadLineage(); }, [lineageOpen, templateId]);

  // 提交审核：弹窗填写「本次修改说明」（提交时才填，给审核员看），再提交
  const handleSubmit = () => {
    if (!canEditKind) { message.warning('当前账号无提交模板审核权限'); return; }
    if (!openDraft) { message.warning('当前没有可提交的草稿'); return; }
    if (!user) { message.warning('请先登录'); return; }
    const guardMsg = submitGuard?.();
    if (guardMsg) { message.error(guardMsg); return; }
    setSubmitSummary(openDraft.change_summary || '');
    setSubmitOpen(true);
  };

  const doSubmit = async () => {
    if (!openDraft) return;
    setSubmitting(true);
    try {
      await axios.post(`${apiBase(kind)}/${templateId}/submit`, {
        version_id: openDraft.id,
        change_summary: submitSummary.trim() || undefined,
      });
      message.success('已提交审核');
      setSubmitOpen(false);
      onRefresh?.();
    } catch (e: any) {
      message.error('提交失败：' + (e.response?.data?.error || e.message));
    } finally { setSubmitting(false); }
  };

  const doWithdraw = async () => {
    if (!canEditKind) { message.warning('当前账号无撤回模板审核权限'); return; }
    if (!openDraft) return;
    try {
      await axios.post(`${apiBase(kind)}/${templateId}/versions/${openDraft.id}/withdraw`);
      message.success('已撤回为草稿，可继续编辑');
      onRefresh?.();
    } catch (e: any) {
      message.error('撤回失败：' + (e.response?.data?.error || e.message));
    }
  };

  const confirmWithdraw = () => Modal.confirm({
    title: '撤回审核？',
    content: '撤回后版本将恢复为草稿，可继续编辑并重新提交审核。',
    okText: '确认撤回',
    cancelText: '取消',
    onOk: doWithdraw,
  });

  // 注：母模板审核通过后，子模板已由后端【强制自动同步】（各自生成待审版本）。
  // 这里不再弹"是否同步"——同步结果在审核通过的提示里展示；「派生关系」里仍可手动再同步。

  const submitFork = async () => {
    if (!canEditKind) { message.warning('当前账号无派生模板权限'); return; }
    if (!forkName.trim()) { message.warning('请填写新模板名'); return; }
    setForkSubmitting(true);
    try {
      const r = await axios.post(`${apiBase(kind)}/${templateId}/fork`, { name: forkName.trim() });
      message.success(`已派生子模板 #${r.data.id}`);
      setForkOpen(false);
      setForkName('');
      onRefresh?.();
    } catch (e: any) {
      message.error('派生失败：' + (e.response?.data?.error || e.message));
    } finally { setForkSubmitting(false); }
  };

  /** 提交审核弹窗：填写本次修改说明（actionsOnly / 默认模式共用） */
  const submitModal = (
    <Modal
      open={submitOpen}
      title={openDraft ? `提交审核 v${openDraft.version_no} · ${templateName || ''}` : '提交审核'}
      onCancel={() => setSubmitOpen(false)}
      onOk={doSubmit}
      okText="提交审核"
      okButtonProps={{ loading: submitting }}
    >
      <div style={{ marginBottom: 8, fontSize: 13, color: '#666' }}>
        本次修改说明（提交审核时一并展示给审核员，可留空）：
      </div>
      <Input.TextArea
        rows={4} value={submitSummary} onChange={(e) => setSubmitSummary(e.target.value)}
        placeholder="例如：新增了'气味性等级'字段；修正了密度计算公式的小数位"
      />
    </Modal>
  );

  const forkModal = (
    <Modal
      open={forkOpen} title="派生子模板"
      onCancel={() => setForkOpen(false)}
      onOk={submitFork}
      okText="派生"
      okButtonProps={{ loading: forkSubmitting }}
    >
      <Alert
        type="info" showIcon style={{ marginBottom: 12 }}
        message="子模板从当前生效版本快照创建，并自动建立母子字段映射。"
        description="子模板可独立修改（不影响母模板）；母模板更新后可选择同步到子模板——被同步的子模板会生成待审核版本，各自审核通过才生效。子模板里新建的字段不受同步影响。"
      />
      <div style={{ marginBottom: 8, fontSize: 13 }}>新模板名称</div>
      <Input value={forkName} onChange={(e) => setForkName(e.target.value)} placeholder="例如：密度模板·奇瑞专版" />
    </Modal>
  );

  const sharedDrawers = (
    <>
      <HistoryDrawer
        open={historyOpen} onClose={() => setHistoryOpen(false)}
        kind={kind} templateId={templateId} templateName={templateName} editorPath={editorPath}
        onChanged={onRefresh}
      />
      <LineageDrawer
        open={lineageOpen} onClose={() => setLineageOpen(false)}
        templateId={templateId} templateKind={kind} lineage={lineage} loading={lineageLoading}
        editorPathBase={editorPath}
        canSync={canEditKind}
        onSync={() => { setLineageOpen(false); setSyncOpen(true); }}
        onFamilySync={() => { setLineageOpen(false); setFamilySyncOpen(true); }}
      />
      <ReviewDrawer
        open={reviewOpen} onClose={() => setReviewOpen(false)}
        kind={kind} templateId={templateId} templateName={templateName}
        openDraft={openDraft} currentVersionNo={currentVersionNo}
        onDone={() => {
          setReviewOpen(false);
          onRefresh?.();
        }}
      />
      <SyncWizard
        open={syncOpen} onClose={() => setSyncOpen(false)}
        kind={kind} templateId={templateId} templateName={templateName}
        onDone={() => { setSyncOpen(false); onRefresh?.(); }}
      />
      <SyncWizard
        open={familySyncOpen} onClose={() => setFamilySyncOpen(false)} mode="family"
        kind={kind} templateId={templateId} templateName={templateName}
        onDone={() => { setFamilySyncOpen(false); onRefresh?.(); }}
      />
      {submitModal}
      {forkModal}
    </>
  );

  /** 紧凑模式：列表页的小角标 */
  if (compact) {
    return (
      <Space size={4}>
        <Tag color={STATUS_COLOR[openDraft?.status || 'approved']}>
          v{currentVersionNo ?? '?'} {STATUS_LABEL[openDraft?.status || 'approved']}
        </Tag>
        {openDraft && (
          <Tooltip title={`v${openDraft.version_no} ${STATUS_LABEL[openDraft.status]}`}>
            <Tag color={STATUS_COLOR[openDraft.status]}>
              {openDraft.status === 'pending' ? '待审' : openDraft.status === 'rejected' ? '已退' : '草稿'}
            </Tag>
          </Tooltip>
        )}
      </Space>
    );
  }

  // 按“能力 + 当前状态 + 提交人”显示流程操作。
  // 普通审核人不可自审；管理员作为系统职责角色保留自审例外。
  const isSubmitter = !!openDraft && !!user && (
    (!!openDraft.submitted_by_job_no && openDraft.submitted_by_job_no === user.job_no)
    || (!openDraft.submitted_by_job_no && (openDraft.submitted_by_name || openDraft.author_name) === user.display_name)
  );
  const isAdministrator = !!user?.roles?.includes('admin');
  const submitEnabled = !!openDraft
    && (openDraft.status === 'draft' || openDraft.status === 'rejected')
    && canEditKind;
  const withdrawEnabled = !!openDraft
    && openDraft.status === 'pending'
    && isSubmitter
    && canEditKind;
  const reviewEnabled = !!openDraft && openDraft.status === 'pending' && isReviewOperator && (!isSubmitter || isAdministrator);

  /** 仅按钮模式（列表行操作列；buttons 控制渲染哪几个，便于拆进不同列） */
  if (actionsOnly) {
    const show = (b: 'history' | 'lineage' | 'fork' | 'submit') => !buttons || buttons.includes(b);
    // 固定保留三个流程位置；当前状态不适用时灰显，避免列表操作区随状态跳动。
    const flowButtons = (
      <>
        <WorkflowActionButton action="submit"
          title={submitEnabled ? '提交审核' : canEditKind ? '当前没有可提交的草稿' : '当前操作不可用'}
          disabled={!submitEnabled} onClick={handleSubmit} />
        <WorkflowActionButton action="withdraw"
          title={withdrawEnabled ? '撤回审核' : canEditKind ? '当前没有可撤回的待审核版本' : '当前操作不可用'}
          disabled={!withdrawEnabled} onClick={confirmWithdraw} />
        <WorkflowActionButton action="review"
          title={reviewEnabled
            ? (isAdministrator && isSubmitter ? '审核（管理员可自审）' : '审核模板版本')
            : !isReviewOperator ? '当前账号无模板审核权限'
            : isSubmitter ? '提交人不能审核自己提交的版本' : '当前没有待审核版本'}
          disabled={!reviewEnabled} onClick={() => setReviewOpen(true)} />
      </>
    );
    // 信息查看组（版本历史/派生关系）：紫色文字型；操作组（+子模板）：描边型——两组样式可区分
    const infoBtnStyle = { color: '#722ed1' };
    return (
      <>
        <Space size={4}>
          {show('history') && (iconOnly ? (
            <Tooltip title="版本历史 / 操作日志">
              <Button size="small" type="text" style={infoBtnStyle} icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)} />
            </Tooltip>
          ) : (
            <Button size="small" icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}>版本历史</Button>
          ))}
          {show('lineage') && (iconOnly ? (
            <Tooltip title="派生关系（母子模板树 / 发起同步）">
              <Button size="small" type="text" style={infoBtnStyle} icon={<BranchesOutlined />} onClick={() => setLineageOpen(true)} />
            </Tooltip>
          ) : (
            <Button size="small" icon={<BranchesOutlined />} onClick={() => setLineageOpen(true)}>派生关系</Button>
          ))}
          {show('fork') && (iconOnly ? (
            <Tooltip title={canEditKind ? '派生子模板' : '当前账号无模板编辑权限'}>
              <Button size="small" icon={<ForkOutlined />} disabled={!canEditKind}
                onClick={() => { setForkName((templateName || '模板') + ' · 副本'); setForkOpen(true); }} />
            </Tooltip>
          ) : (
            <Button size="small" icon={<ForkOutlined />} disabled={!canEditKind}
              onClick={() => { setForkName((templateName || '模板') + ' · 副本'); setForkOpen(true); }}>+子模板</Button>
          ))}
          {show('submit') && flowButtons}
        </Space>
        {sharedDrawers}
      </>
    );
  }

  /** 状态条 + 操作按钮（编辑器顶栏） */
  return (
    <>
      <Space size={6} wrap>
        <Tag color="green">v{currentVersionNo ?? '?'} 已生效</Tag>
        {openDraft && (
          <Tag color={STATUS_COLOR[openDraft.status]}>
            v{openDraft.version_no} {STATUS_LABEL[openDraft.status]}
          </Tag>
        )}
        <WorkflowActionButton action="submit"
          title={submitEnabled ? '提交审核' : disabled && disabledReason ? disabledReason : canEditKind ? '当前没有可提交的草稿' : '当前账号无模板编辑权限'}
          disabled={!submitEnabled} onClick={handleSubmit} />
        <WorkflowActionButton action="withdraw"
          title={withdrawEnabled ? '撤回审核' : disabled && disabledReason ? disabledReason : canEditKind ? '当前没有可撤回的待审核版本' : '当前账号无模板编辑权限'}
          disabled={!withdrawEnabled} onClick={confirmWithdraw} />
        <WorkflowActionButton action="review"
          title={reviewEnabled
            ? (isAdministrator && isSubmitter ? '审核（管理员可自审）' : '审核模板版本')
            : !isReviewOperator ? '当前账号无模板审核权限'
            : isSubmitter ? '提交人不能审核自己提交的版本' : '当前没有待审核版本'}
          disabled={!reviewEnabled} onClick={() => setReviewOpen(true)} />
        {iconOnly ? (
          <>
            <Tooltip title="版本历史 / 操作日志"><Button size="small" type="text" icon={<HistoryOutlined />} aria-label="版本历史" onClick={() => setHistoryOpen(true)} /></Tooltip>
            <Tooltip title="派生关系"><Button size="small" type="text" icon={<BranchesOutlined />} aria-label="派生关系" onClick={() => setLineageOpen(true)} /></Tooltip>
            <Tooltip title={canEditKind ? '派生子模板' : disabled && disabledReason ? disabledReason : '当前账号无模板编辑权限'}><Button size="small" type="text" icon={<ForkOutlined />} aria-label="派生子模板" disabled={!canEditKind} onClick={() => { setForkName((templateName || '模板') + ' · 副本'); setForkOpen(true); }} /></Tooltip>
          </>
        ) : (
          <>
            <Button size="small" icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}>版本历史</Button>
            <Button size="small" icon={<BranchesOutlined />} onClick={() => setLineageOpen(true)}>派生关系</Button>
            <Button size="small" icon={<ForkOutlined />} disabled={!canEditKind} onClick={() => { setForkName((templateName || '模板') + ' · 副本'); setForkOpen(true); }}>派生子模板</Button>
          </>
        )}
        {familySyncShortcut && (
          <Tooltip title={canEditKind ? '将当前已审核生效版本的相同字段同步到选中的同组模板' : disabledReason || '当前不可执行同组同步'}>
            <Button size="small" icon={<SyncOutlined />} disabled={!canEditKind}
              onClick={() => setFamilySyncOpen(true)}>同步到同组模板</Button>
          </Tooltip>
        )}
      </Space>

      {openDraft?.status === 'rejected' && openDraft.review_note && (
        <Popover
          trigger="click"
          placement="bottomLeft"
          title={`审核未通过（${openDraft.reviewer_name || '审核员'}）`}
          content={
            <div style={{ maxWidth: 360, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.65 }}>
              <span style={{ color: '#8c8c8c' }}>退回原因：</span>
              <strong>{openDraft.review_note}</strong>
            </div>
          }
        >
          <Button size="small" danger icon={<AuditOutlined />}>退回原因</Button>
        </Popover>
      )}

      {sharedDrawers}
    </>
  );
}

// ───────────────────────── 审核 Drawer ─────────────────────────

function ReviewDrawer({ open, onClose, kind, templateId, templateName, openDraft, currentVersionNo, onDone }: {
  open: boolean; onClose: () => void;
  kind: TemplateKind; templateId: number; templateName?: string;
  openDraft?: OpenDraft | null; currentVersionNo?: number;
  onDone: (decision: 'approve' | 'reject') => void;
}) {
  const { user, has } = useAuth();
  const [loading, setLoading] = useState(false);
  const [newVersion, setNewVersion] = useState<any>(null);     // 待审版本完整行
  const [oldContent, setOldContent] = useState<any>(null);     // 当前生效版本内容（GET /:id）
  const [diff, setDiff] = useState<TemplateFieldDiff[] | null>(null);
  const [linkedRecord, setLinkedRecord] = useState<RecordTemplate | null>(null);
  const [pdfMode, setPdfMode] = useState<'new' | 'old' | 'both'>('new');
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !openDraft) return;
    setLoading(true);
    setPdfMode('new'); setDecision('approve'); setNote('');
    (async () => {
      try {
        const [nv, cur, df] = await Promise.all([
          axios.get(`${apiBase(kind)}/${templateId}/versions/${openDraft.id}`),
          axios.get(`${apiBase(kind)}/${templateId}`),
          axios.get(`${apiBase(kind)}/${templateId}/versions/${openDraft.id}/diff`),
        ]);
        setNewVersion(nv.data);
        setOldContent(cur.data);
        setDiff(df.data.diff);
        if (kind === 'report' && cur.data.linked_record_template_id) {
          try {
            const r = await axios.get(`${API}/record-templates/${cur.data.linked_record_template_id}`);
            setLinkedRecord({
              id: r.data.id, name: r.data.name, version: r.data.version,
              groups: r.data.field_definitions, layout_options: r.data.layout_options || {},
            });
          } catch { setLinkedRecord(null); }
        }
      } catch (e: any) {
        message.error('加载审核内容失败：' + (e.response?.data?.error || e.message));
      } finally { setLoading(false); }
    })();
  }, [open, openDraft?.id]);

  // PDF 源仅在抽屉打开时计算（Typst 编译在 TypstViewer 内部做）
  const newSrc = useMemo(
    () => (open && newVersion ? buildPreviewSource(kind, rowToTemplate(newVersion, templateName), linkedRecord) : ''),
    [open, newVersion, linkedRecord]
  );
  const oldSrc = useMemo(
    () => (open && oldContent?.field_definitions
      ? buildPreviewSource(kind, rowToTemplate({ field_definitions: oldContent.field_definitions, layout_options: oldContent.layout_options, version_no: oldContent.current_version_no }, templateName), linkedRecord)
      : ''),
    [open, oldContent, linkedRecord]
  );
  // 新建模板首次送审时不存在“修改前”的生效版本。此前仍渲染空 source，
  // Typst 接口会返回 Missing or invalid "source" field，造成审核页看似渲染失败。
  const hasPreviousPreview = !!oldSrc;
  useEffect(() => {
    if (!hasPreviousPreview && pdfMode !== 'new') setPdfMode('new');
  }, [hasPreviousPreview, pdfMode]);

  const submitReview = async () => {
    if (!openDraft) return;
    if (!has(kind === 'record' ? 'record.review' : 'report.review')) {
      message.warning('当前账号无模板审核权限'); return;
    }
    if (decision === 'reject' && !note.trim()) {
      message.warning('退回必须填写备注'); return;
    }
    setSubmitting(true);
    try {
      if (kind === 'record' && decision === 'approve') {
        // Always reload the pending version; do not inspect the editor's unsaved draft.
        const pending = await axios.get(`${apiBase(kind)}/${templateId}/versions/${openDraft.id}`);
        const impact = await axios.post(`${apiBase(kind)}/${templateId}/report-impact`, {
          groups: pending.data.field_definitions,
        });
        const affected = (impact.data.templates || []).filter((row: any) => row.checked && row.issues?.length);
        if (affected.length) {
          const confirmed = await new Promise<boolean>(resolve => {
            Modal.confirm({
              title: `${affected.length} 个项目模板需要调整来源`,
              content: <div style={{ maxHeight: '40vh', overflowY: 'auto' }}>
                <p>发布后请调整以下模板，已有报告不会自动修改。</p>
                {affected.map((row: any) => <div key={row.id} style={{ marginBlock: 8 }}>
                  <strong>{row.name}</strong>
                  <span style={{ marginLeft: 8, color: '#777' }}>{row.checked_status === 'approved' ? '已发布版本' : row.checked_status === 'pending' ? '待审核版本' : '草稿版本'}</span>
                  {row.issues.map((issue: any, i: number) => <div key={i}>
                    {issue.groupName} / {issue.fieldName}：{issue.reasons.join('；')}
                  </div>)}
                </div>)}
              </div>,
              okText: '继续发布', cancelText: '返回检查',
              onOk: () => resolve(true), onCancel: () => resolve(false),
            });
          });
          if (!confirmed) return;
        }
      }
      const res = await axios.post(`${apiBase(kind)}/${templateId}/versions/${openDraft.id}/review`, {
        decision, note: note.trim() || undefined,
      });
      if (decision === 'approve') {
        const cs = res.data?.child_sync;
        let extra = '';
        if (cs?.error) extra = '；子模板自动同步失败，可在「派生关系」手动同步';
        else if (cs && (cs.applied?.length || cs.skipped?.length)) {
          extra = `；已自动给 ${cs.applied?.length || 0} 个子模板生成待审版本`
            + (cs.skipped?.length ? `，跳过 ${cs.skipped.length} 个（有未定稿/无差异）` : '');
        }
        message.success('审核通过，版本已生效' + extra, extra ? 6 : 3);
      } else {
        message.success('已退回');
      }
      onDone(decision);
    } catch (e: any) {
      message.error('审核失败：' + (e.response?.data?.error || e.message));
    } finally { setSubmitting(false); }
  };

  const pdfH = 'calc(100vh - 270px)';
  return (
    <Drawer
      open={open} onClose={onClose} width="82%"
      title={openDraft ? `审核 v${openDraft.version_no} · ${templateName || ''}（${currentVersionNo ? `当前生效 v${currentVersionNo}` : '尚无生效版本'}）` : '审核'}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Segmented
            value={decision}
            onChange={(value) => setDecision(value as 'approve' | 'reject')}
            options={[{ label: '通过', value: 'approve' }, { label: '退回', value: 'reject' }]}
          />
          <Input
            style={{ flex: 1 }} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={decision === 'reject' ? '退回必填：请说明需要修改的具体内容' : '可选：审核备注'}
          />
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" danger={decision === 'reject'} loading={submitting} onClick={submitReview}>
            {decision === 'approve' ? '审核通过' : '退回'}
          </Button>
        </div>
      }
    >
      {loading ? <Spin style={{ display: 'block', margin: '60px auto' }} /> : (
        <div style={{ display: 'flex', gap: 16, height: '100%' }}>
          {/* 左：说明 + diff */}
          <div style={{ flex: '0 0 360px', overflowY: 'auto', paddingRight: 8, borderRight: '1px solid #eef0f4' }}>
            <div style={{ padding: 12, background: '#fafafa', borderRadius: 4, fontSize: 13, marginBottom: 12 }}>
              <div>提交人：<strong>{templateActorLabel(openDraft?.submitted_by_name || openDraft?.author_name)}</strong></div>
              {user && <div>审核人：<strong>{user.display_name}</strong></div>}
            </div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>修改说明</div>
            <div style={{ padding: '8px 10px', background: newVersion?.change_summary ? '#f6ffed' : '#fafafa', borderRadius: 4, fontSize: 13, marginBottom: 16, whiteSpace: 'pre-wrap' }}>
              {newVersion?.change_summary || <span style={{ color: '#999' }}>（提交人未填写修改说明）</span>}
            </div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              字段变化（vs 当前生效 v{currentVersionNo ?? '?'}）
              {Array.isArray(diff) && <Tag style={{ marginLeft: 6 }}>{diff.length} 项</Tag>}
            </div>
            <DiffList diff={diff || []} />
          </div>
          {/* 右：PDF 对比 */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: 8 }}>
              <Segmented
                value={pdfMode}
                onChange={(v) => setPdfMode(v as any)}
                options={[
                  { label: `修改后 v${openDraft?.version_no ?? ''}`, value: 'new' },
                  ...(hasPreviousPreview ? [
                    { label: `修改前 v${currentVersionNo}`, value: 'old' },
                    { label: '并排对比', value: 'both' },
                  ] : []),
                ]}
              />
            </div>
            {pdfMode === 'both' ? (
              <div style={{ display: 'flex', gap: 8, flex: 1, minHeight: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>修改前 v{currentVersionNo ?? '?'}</div>
                  <TypstViewer source={oldSrc} mode="view" height={pdfH} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>修改后 v{openDraft?.version_no}</div>
                  <TypstViewer source={newSrc} mode="view" height={pdfH} />
                </div>
              </div>
            ) : (
              <TypstViewer source={pdfMode === 'new' ? newSrc : oldSrc} mode="view" height={pdfH} />
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

// ───────────────────────── 版本历史 + 操作日志 Drawer ─────────────────────────

function HistoryDrawer({ open, onClose, kind, templateId, templateName, editorPath, onChanged }: {
  open: boolean; onClose: () => void;
  kind: TemplateKind; templateId: number; templateName?: string; editorPath: string;
  onChanged?: () => void;
}) {
  const navigate = useNavigate();
  const { has } = useAuth();
  const canEditTemplate = has(kind === 'record' ? 'record_template.edit' : 'report_template.edit');
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [auditLog, setAuditLog] = useState<TemplateAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewVersionId, setPreviewVersionId] = useState<number | null>(null);

  const reload = () => {
    setLoading(true);
    Promise.all([
      axios.get(`${apiBase(kind)}/${templateId}/versions`),
      axios.get(`${apiBase(kind)}/${templateId}/audit-log`),
    ])
      .then(([v, a]) => { setVersions(v.data); setAuditLog(a.data); })
      .catch(() => message.error('加载历史失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, templateId]);

  // 有未定稿（草稿/待审）时：回退＝把工作副本内容重置为该版本（pending 先撤回，仍是草稿、不送审）；否则＝克隆为新待审版本
  const openWork = versions.find((v) => v.status === 'draft' || v.status === 'pending');
  const doRollback = (v: VersionRow) => {
    const os = openWork?.status;
    const toEffective = v.status === 'approved';  // 恢复为当前生效版本＝丢弃草稿
    Modal.confirm({
      title: `恢复到 v${v.version_no}？`,
      content: toEffective
        ? (os === 'pending'
            ? `当前 v${openWork?.version_no} 正在审核中。恢复将先撤回该审核，并丢弃草稿回到生效版本（不会留下草稿，无需提交审核）。`
            : `将丢弃当前草稿 v${openWork?.version_no}，回到生效版本（不会留下草稿，无需提交审核）。`)
        : (os === 'pending'
            ? `当前 v${openWork?.version_no} 正在审核中。恢复将先撤回该审核（变回草稿），并把内容重置为本版本（仍是草稿，无需审核）。`
            : os === 'draft'
            ? `将把当前草稿 v${openWork?.version_no} 的内容重置为该版本内容（仍是草稿，无需审核）。`
            : '将以该版本内容创建一个新的「待审核」版本，经审核通过后生效。当前版本与历史全部保留。'),
      okText: toEffective
        ? (os === 'pending' ? '撤回审核并丢弃草稿' : '丢弃草稿并恢复')
        : (os === 'pending' ? '撤回审核并恢复' : os === 'draft' ? '重置草稿为此版本' : '创建回退版本'),
      cancelText: '取消',
      onOk: async () => {
        try {
          const r = await axios.post(`${apiBase(kind)}/${templateId}/versions/${v.id}/rollback`);
          message.success(r.data.discarded
            ? '已恢复为当前生效版本，草稿已丢弃'
            : r.data.status === 'draft'
            ? `已恢复为 v${v.version_no} 内容（草稿${os === 'pending' ? '，已撤回原审核' : ''}）`
            : `已创建回退版本 v${r.data.version_no}，待审核`);
          reload();
          onChanged?.();
        } catch (e: any) {
          message.error('回退失败：' + (e.response?.data?.error || e.message));
        }
      },
    });
  };

  const versionTimeline = versions.length === 0 ? <Empty /> : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {versions.map((v) => {
        const accent = STATUS_HEX[v.status] || '#d0d7e2';
        const canRollback = canEditTemplate
          && (v.status === 'superseded' || (v.status === 'approved' && !!openWork));
        return (
          <div key={v.id} style={{ border: '1px solid #e8ecf3', borderLeft: `3px solid ${accent}`, borderRadius: 8, padding: '10px 12px', background: '#fff' }}>
            {/* 头部：版本 + 状态 + 查看/恢复 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15, color: '#1f2733' }}>v{v.version_no}</span>
              <Tag color={STATUS_COLOR[v.status]} style={{ margin: 0 }}>{STATUS_LABEL[v.status]}</Tag>
              <div style={{ flex: 1 }} />
              <Tooltip title="只读打开该版本的完整内容（字段 + PDF 预览）">
                <Button size="small" type="primary" ghost icon={<EyeOutlined />}
                  onClick={() => {
                    if (canEditTemplate) {
                      onClose();
                      navigate(`${editorPath}?id=${templateId}&version_id=${v.id}`);
                    } else {
                      setPreviewVersionId(v.id);
                    }
                  }}>查看此版本</Button>
              </Tooltip>
              {canRollback && (
                <Tooltip title={openWork
                  ? (openWork.status === 'pending'
                      ? '撤回正在审核的版本，并把内容恢复为此版本（仍是草稿，无需审核）'
                      : '把当前草稿内容重置为此版本（仍是草稿，无需审核）')
                  : '以该历史版本内容创建新的待审核版本（回退）'}>
                  <Button size="small" icon={<RollbackOutlined />} onClick={() => doRollback(v)}>
                    {openWork && v.status === 'approved' ? '恢复为此版本' : '恢复此版本'}
                  </Button>
                </Tooltip>
              )}
            </div>
            {/* 字段：作者 / 审核人 / 日期 */}
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 12px', fontSize: 12, alignItems: 'baseline' }}>
              <span style={{ color: '#8a93a3' }}>作者</span><span style={{ color: '#1f2733', fontWeight: 500 }}>{templateActorLabel(v.author_name)}</span>
              {v.reviewer_name && (<><span style={{ color: '#8a93a3' }}>审核人</span><span style={{ color: '#1f2733' }}>{v.reviewer_name}</span></>)}
              <span style={{ color: '#8a93a3' }}>日期</span><span style={{ color: '#555' }}>{fmtDateTime(v.created_at)}</span>
              {v.change_summary && (<>
                <span style={{ color: '#8a93a3' }}>修改说明</span>
                <span style={{ color: '#333', background: '#f6ffed', borderRadius: 4, padding: '2px 6px', whiteSpace: 'pre-wrap' }}>{v.change_summary}</span>
              </>)}
              {v.review_note && (<>
                <span style={{ color: '#8a93a3' }}>审核备注</span>
                <span style={{ color: v.status === 'rejected' ? '#cf1322' : '#389e0d', background: v.status === 'rejected' ? '#fff1f0' : '#f6ffed', borderRadius: 4, padding: '2px 6px' }}>{v.review_note}</span>
              </>)}
            </div>
            {/* 与上版相比的字段 diff */}
            {Array.isArray(v.diff_from_prev) && v.diff_from_prev.length > 0 && (
              <Collapse size="small" ghost style={{ marginTop: 4 }}
                items={[{
                  key: 'diff',
                  label: <span style={{ fontSize: 12, color: '#1366d9' }}>与上版相比 {v.diff_from_prev.length} 项变化</span>,
                  children: <DiffList diff={v.diff_from_prev} />,
                }]} />
            )}
          </div>
        );
      })}
    </div>
  );

  const auditTimeline = auditLog.length === 0 ? <Empty description="暂无操作记录" /> : (
    <Timeline
      items={auditLog.map((e) => ({
        color: ACTION_COLOR[e.action] || 'gray',
        children: (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Space size={6} wrap>
              <Tag color={ACTION_COLOR[e.action] || 'default'}>{ACTION_LABEL[e.action] || e.action}</Tag>
              <span><strong>{templateActorLabel(e.actor_name)}</strong>{e.actor_role ? <span style={{ color: '#999' }}>（{(e.actor_role === 'reviewer' || e.actor_role === 'test_supervisor' || e.actor_role === 'report_reviewer') ? '审核' : e.actor_role}）</span> : null}</span>
            </Space>
            {auditDetailText(e) && <span style={{ fontSize: 12, color: '#555' }}>{auditDetailText(e)}</span>}
            <span style={{ fontSize: 11, color: '#999' }}>{new Date(e.created_at).toLocaleString()}</span>
          </Space>
        ),
      }))}
    />
  );

  return (<>
    <Drawer open={open} onClose={onClose} title={`版本历史 · ${templateName || ''}`} width={640}>
      {loading ? <div style={{ color: '#888' }}>加载中…</div> : (
        <Tabs
          items={[
            { key: 'versions', label: `版本（${versions.length}）`, children: versionTimeline },
            { key: 'audit', label: `操作日志（${auditLog.length}）`, children: auditTimeline },
          ]}
        />
      )}
    </Drawer>
    <TemplatePdfPreviewModal
      open={previewVersionId != null}
      kind={kind}
      templateId={templateId}
      templateName={templateName || `模板 #${templateId}`}
      initialVersionId={previewVersionId ?? undefined}
      onClose={() => setPreviewVersionId(null)}
    />
  </>);
}

// ───────────────────────── 派生关系 Drawer ─────────────────────────

function LineageDrawer({ open, onClose, templateId, templateKind, lineage, loading, canSync, onSync, onFamilySync, editorPathBase }: {
  open: boolean; onClose: () => void; templateId: number; templateKind?: TemplateKind;
  lineage: { ancestors: any[]; descendants: any[]; family?: any } | null; loading: boolean;
  canSync: boolean;
  onSync: () => void;
  onFamilySync: () => void;
  editorPathBase?: string;
}) {
  const navigate = useNavigate();
  const [previewNode, setPreviewNode] = useState<{ id: number; name: string } | null>(null);
  const editorPath = (id: number) => `${editorPathBase
    || (templateKind === 'report' ? '/report-templates/project/editor' : '/record-templates/editor')}?id=${id}`;

  const directChildren = (lineage?.descendants || []).filter((d) => d.parent_template_id === templateId);

  const renderNodeTitle = (node: any, isCurrent: boolean) => (
    <span>
      <Tag color={isCurrent ? 'blue' : 'orange'} style={{ cursor: isCurrent ? 'default' : 'pointer' }}>
        #{node.id}
      </Tag>
      {isCurrent ? (
        <span>{node.name}<Tag color="blue" style={{ marginLeft: 4 }}>当前</Tag></span>
      ) : (
        <a onClick={(e) => {
          e.preventDefault();
          if (canSync) {
            onClose();
            navigate(editorPath(node.id));
          } else {
            setPreviewNode({ id: node.id, name: node.name });
          }
        }}>
          {node.name}
        </a>
      )}
    </span>
  );

  const treeData = useMemo(() => {
    if (!lineage) return [];
    const root = lineage.ancestors[0];
    if (!root) return [];
    const buildChildren = (id: number): any[] =>
      lineage.descendants
        .filter((d) => d.parent_template_id === id)
        .map((d) => ({
          key: `d-${d.id}`,
          title: renderNodeTitle(d, d.id === templateId),
          children: buildChildren(d.id),
        }));
    const buildAncestor = (idx: number): any => {
      if (idx >= lineage.ancestors.length) return null;
      const a = lineage.ancestors[idx];
      const node: any = {
        key: `a-${a.id}`,
        title: renderNodeTitle(a, a.id === templateId),
        children: [],
      };
      const next = buildAncestor(idx + 1);
      if (next) node.children.push(next);
      else { node.children = buildChildren(a.id); }
      return node;
    };
    const tree = buildAncestor(0);
    return tree ? [tree] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineage, templateId, templateKind, canSync]);

  return (<>
    <Drawer open={open} onClose={onClose} title="模板关系" width={560}>
      <div style={{ marginBottom: 16, padding: 14, border: '1px solid #d6e4ff', borderRadius: 8, background: '#f7faff' }}>
        <Space wrap style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
          <div><b>项目组关系</b><div style={{ color: '#667085', fontSize: 12, marginTop: 2 }}>表示模板归类；不是母子继承关系。</div></div>
          {lineage?.family && <Tag color="blue">{lineage.family.members?.length || 0} 个模板</Tag>}
        </Space>
        {!lineage?.family ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前模板未加入项目组" /> : <>
          <Space wrap style={{ marginBottom: 10 }}>
            <Tag color="cyan">{lineage.family.name}</Tag>
            {(lineage.family.members || []).some((m: any) => Number(m.id) !== Number(templateId) && m.template_kind === lineage.family.template_kind) && <Button size="small" type="primary" ghost
              icon={<SyncOutlined />} disabled={!canSync} onClick={onFamilySync}>同步到同组同类模板…</Button>}
          </Space>
          <div style={{ display: 'grid', gap: 6 }}>
            {(lineage.family.members || []).map((member: any) => <div key={member.id}>
              {member.id === templateId ? <><Tag color="blue">当前模板</Tag>{member.name}</> : <a onClick={() => {
                if (canSync) { onClose(); navigate(templateKind === 'report' ? `/report-templates/${member.template_kind === 'project' ? 'project' : 'cover'}/editor?id=${member.id}` : editorPath(member.id)); }
                else setPreviewNode({ id: member.id, name: member.name });
              }}><Tag>同组</Tag>#{member.id} {member.name}</a>}
            </div>)}
          </div>
        </>}
      </div>

      <div style={{ padding: 14, border: '1px solid #ffe0b2', borderRadius: 8, background: '#fffaf2' }}>
        <Space wrap style={{ width: '100%', justifyContent: 'space-between', marginBottom: 10 }}>
          <div><b>母子派生关系</b><div style={{ color: '#667085', fontSize: 12, marginTop: 2 }}>表示从母模板复制派生的继承链，可按字段映射向子模板同步。</div></div>
          {directChildren.length > 0 && <Tooltip title={canSync ? '把当前生效版本同步到直接子模板' : '当前账号无模板编辑权限'}>
            <Button size="small" type="primary" ghost icon={<SyncOutlined />} disabled={!canSync} onClick={onSync}>
              同步到子模板（{directChildren.length}）…
            </Button>
          </Tooltip>}
        </Space>
        {loading ? <div style={{ color: '#888' }}>加载中…</div>
          : !lineage || (lineage.ancestors.length <= 1 && lineage.descendants.length === 0)
            ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无母子派生关系" />
            : <Tree treeData={treeData} defaultExpandAll showLine />}
      </div>
    </Drawer>
    <TemplatePdfPreviewModal
      open={!!previewNode}
      kind={templateKind || 'record'}
      templateId={previewNode?.id ?? 0}
      templateName={previewNode?.name || ''}
      onClose={() => setPreviewNode(null)}
    />
  </>);
}

// ───────────────────────── 同步向导 ─────────────────────────

interface SyncPreviewRow {
  id: number; name: string;
  stats: { replaced: string[]; removed: string[]; added: string[] };
  blocked?: string;
}

function SyncWizard({ open, onClose, kind, templateId, templateName, onDone, mode = 'children' }: {
  open: boolean; onClose: () => void;
  kind: TemplateKind; templateId: number; templateName?: string;
  onDone: () => void;
  mode?: 'children' | 'family';
}) {
  const [loading, setLoading] = useState(false);
  const [includeAdded, setIncludeAdded] = useState(true);
  const [preview, setPreview] = useState<SyncPreviewRow[]>([]);
  const [sourceVersionNo, setSourceVersionNo] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const runDryRun = async (inclAdded: boolean) => {
    setLoading(true);
    try {
      const lin = (await axios.get(`${apiBase(kind)}/${templateId}/lineage`)).data;
      const targetIds = mode === 'family'
        ? (lin.family?.members || []).filter((member: any) => Number(member.id) !== Number(templateId) && member.template_kind === lin.family.template_kind).map((member: any) => member.id)
        : (lin.descendants || []).filter((d: any) => d.parent_template_id === templateId).map((d: any) => d.id);
      if (targetIds.length === 0) {
        setPreview([]); setSelected([]);
        return;
      }
      const r = await axios.post(`${apiBase(kind)}/${templateId}/${mode === 'family' ? 'sync-to-family' : 'sync-to-children'}`, {
        [mode === 'family' ? 'target_ids' : 'child_ids']: targetIds, include_added: inclAdded, dry_run: true,
      });
      setSourceVersionNo(r.data.source_version_no);
      const rows: SyncPreviewRow[] = r.data.preview || [];
      setPreview(rows);
      setSelected(rows.filter((p) => !p.blocked).map((p) => p.id));
    } catch (e: any) {
      message.error('预览同步失败：' + (e.response?.data?.error || e.message));
    } finally { setLoading(false); }
  };

  useEffect(() => { if (open) runDryRun(includeAdded); }, [open]);

  const toggleIncludeAdded = (v: boolean) => {
    setIncludeAdded(v);
    runDryRun(v);
  };

  const doSync = async () => {
    if (selected.length === 0) { message.warning('请选择要同步的目标模板'); return; }
    setSubmitting(true);
    try {
      const r = await axios.post(`${apiBase(kind)}/${templateId}/${mode === 'family' ? 'sync-to-family' : 'sync-to-children'}`, {
        [mode === 'family' ? 'target_ids' : 'child_ids']: selected, include_added: includeAdded,
      });
      const { applied, skipped } = r.data;
      Modal.success({
        title: '同步完成',
        content: (
          <div style={{ fontSize: 13 }}>
            {applied.length > 0 && (
              <p>已为 {applied.length} 个目标模板生成<strong>待审核版本</strong>（需各自审核通过后才生效）：
                {applied.map((a: any) => `「${a.name}」v${a.version_no}`).join('、')}</p>
            )}
            {skipped.length > 0 && (
              <p style={{ color: '#cf7d00' }}>跳过 {skipped.length} 个：
                {skipped.map((s: any) => `「${s.name}」（${s.reason}）`).join('、')}</p>
            )}
          </div>
        ),
      });
      onDone();
    } catch (e: any) {
      message.error('同步失败：' + (e.response?.data?.error || e.message));
    } finally { setSubmitting(false); }
  };

  const statText = (s: SyncPreviewRow['stats']) => {
    const parts: string[] = [];
    if (s.replaced.length) parts.push(`替换 ${s.replaced.length}`);
    if (s.removed.length) parts.push(`删除 ${s.removed.length}`);
    if (s.added.length) parts.push(`新增 ${s.added.length}`);
    return parts.length ? parts.join(' · ') : '无变化';
  };

  return (
    <Modal
      open={open} onCancel={onClose} width={680}
      title={`${mode === 'family' ? '同步到同组模板' : '同步到子模板'} · ${templateName || ''}${sourceVersionNo ? `（源：当前生效 v${sourceVersionNo}）` : ''}`}
      okText={`同步选中的 ${selected.length} 个模板`}
      okButtonProps={{ loading: submitting, disabled: selected.length === 0 }}
      onOk={doSync}
    >
      <Alert
        type="warning" showIcon style={{ marginBottom: 12 }}
        message={kind === 'record'
          ? '只同步编码和类型能够匹配的普通字段。'
          : mode === 'family' ? '系统会自动识别并匹配同组模板中的相同字段。' : '同步会用母版字段定义覆盖子模板中的对应字段。'}
        description={kind === 'record'
          ? '数据表格、图片、审核、判定/结论、计算及动态结构不会同步，分区样式和目标专有字段也保持不变；结果仍会生成待审核版本。'
          : '同步结果会为每个目标模板生成待审核版本；未匹配的目标专有字段不会被修改。'}
      />
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Switch size="small" checked={includeAdded} onChange={toggleIncludeAdded} />
        <span style={{ fontSize: 13 }}>包含来源模板新增的{kind === 'record' ? '普通' : ''}字段（追加到匹配分区；无法匹配分区时新建分区）</span>
      </div>
      {loading ? <Spin style={{ display: 'block', margin: '24px auto' }} /> : preview.length === 0 ? (
        <Empty description="没有可同步的目标模板" />
      ) : (
        <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 4, padding: 8 }}>
          {preview.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', borderBottom: '1px dashed #f0f0f0' }}>
              <Checkbox
                disabled={!!p.blocked}
                checked={selected.includes(p.id)}
                onChange={(e) => setSelected((prev) => e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id))}
              />
              <span style={{ flex: 1 }}>#{p.id} {p.name}</span>
              {p.blocked
                ? <Tag color="orange">{p.blocked}</Tag>
                : (
                  <Tooltip title={[
                    p.stats.replaced.length ? `替换：${p.stats.replaced.join('、')}` : '',
                    p.stats.removed.length ? `删除：${p.stats.removed.join('、')}` : '',
                    p.stats.added.length ? `新增：${p.stats.added.join('、')}` : '',
                  ].filter(Boolean).join('\n') || '无变化'}>
                    <Tag color={statText(p.stats) === '无变化' ? 'default' : 'blue'}>{statText(p.stats)}</Tag>
                  </Tooltip>
                )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
