/**
 * 原始记录只读查看器（报告端用）
 *
 * 报告生成的文员有权限查看某条 record_data 的原始记录，但【不可编辑】。
 * 渲染遵循合规要求：按 record_data.template_version_id 锁定的模板版本快照渲染，
 * 而不是模板当前最新版本（与报告生成 reports.ts 的回放口径一致）。
 *
 * 纯前端复用：record-data + record-templates 版本快照 + generateTypstWithData + TypstViewer(view)。
 */
import { useEffect, useState } from 'react';
import { Drawer, Spin, Tag, Space, Alert, Button, Modal, Input, message } from 'antd';
import { RollbackOutlined } from '@ant-design/icons';
import axios from 'axios';
import TypstViewer from './TypstViewer';
import { generateTypstWithData } from '../../../shared/typst-generator';
import { collectDeviceCodes, fetchDeviceMap } from '../utils/deviceMap';
import { createEmptyMatrixValue } from '../../../shared/matrix-flatten';
import type { RecordTemplate } from '../../../shared/types';

const API = '/api';

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

/** 日期统一 yyyy-mm-dd（本地时区，与出报告端口径一致）。 */
function ymd(v: any): string {
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 把 record_data 的 tester/reviewer 等权威列按 semantic_role 注入，供只读渲染显示签字。 */
function injectAuditFields(tmpl: RecordTemplate, base: Record<string, any>, row: any): Record<string, any> {
  const out = { ...base };
  for (const f of tmpl.groups.flatMap(g => g.fields)) {
    if (!f.semantic_role) continue;
    if (f.semantic_role === 'inspector') out[f.code] = row?.tester_name || '';
    else if (f.semantic_role === 'inspector_date') out[f.code] = row?.tested_at ? ymd(row.tested_at) : '';
    else if (f.semantic_role === 'reviewer') out[f.code] = row?.reviewer_name || '';
    else if (f.semantic_role === 'reviewer_date') out[f.code] = row?.reviewed_at ? ymd(row.reviewed_at) : '';
  }
  return out;
}

const STATUS_TAG: Record<string, { color: string; text: string }> = {
  pending: { color: 'blue', text: '待审核' },
  reviewed: { color: 'green', text: '已审核' },
  rejected: { color: 'red', text: '已退回' },
};

interface Props {
  recordId: number | null;
  open: boolean;
  onClose: () => void;
  /** 抽屉标题补充信息（样品 / 项目名） */
  subtitle?: string;
  /** 退回原始记录成功后回调（父组件据此刷新录入进度 / 报告失效标记） */
  onRejected?: () => void;
  /** 退回时关联的报告 id（报告编辑器场景传入）——工单挂到该报告，交付/重生成据此阻断、可溯源 */
  reportId?: number | null;
  /** 隐藏「退回原始记录」(报告端 rework) 按钮——录入数据审核场景用，退回走审核弹窗，避免两套退回入口 */
  hideReject?: boolean;
  /**
   * 历史版本快照渲染：传入某个版本的【合并后】数据快照（record_audit_log.data_snapshot）后，
   * 按该快照（而非记录当前数据）渲染；同时自动隐藏「退回」按钮、标题显示版本标签。
   */
  snapshotData?: Record<string, any> | null;
  /** 历史版本标签（如「v3 · 提交」），仅快照模式展示 */
  versionLabel?: string;
}

export default function ReadonlyRecordViewer({ recordId, open, onClose, subtitle, onRejected, hideReject, snapshotData, versionLabel, reportId }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [row, setRow] = useState<any>(null);
  const [source, setSource] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const submitReject = async () => {
    if (!recordId || !row) return;
    if (!reason.trim()) { message.warning('请填写退回原因'); return; }
    setRejecting(true);
    try {
      await axios.post(`${API}/rework`, {
        order_no: row.order_no, scope: 'record', record_data_id: recordId,
        origin_stage: 'report_gen', target_stage: 'data_entry', reason: reason.trim(),
        ...(reportId ? { report_id: reportId } : {}),
      });
      message.success('已退回原始记录，主检将在「实验室录入」看到待返工');
      setRejectOpen(false);
      setReason('');
      onRejected?.();
      onClose();
    } catch (e: any) {
      message.error('退回失败：' + (e?.response?.data?.error || e.message || ''));
    } finally {
      setRejecting(false);
    }
  };

  useEffect(() => {
    if (!open || !recordId) return;
    setLoading(true);
    setError(null);
    setSource('');
    (async () => {
      try {
        const rd = (await axios.get(`${API}/record-data/${recordId}`)).data;
        setRow(rd);
        // 优先按锁定版本快照渲染；老数据(无 version_id)回退到当前生效版本
        const base = (await axios.get(`${API}/record-templates/${rd.template_id}`)).data;
        let groups = base.field_definitions;
        let layout = base.layout_options || {};
        if (rd.template_version_id) {
          try {
            const v = (await axios.get(`${API}/record-templates/${rd.template_id}/versions/${rd.template_version_id}`)).data;
            if (v?.field_definitions) { groups = v.field_definitions; layout = v.layout_options || {}; }
          } catch { /* 版本拉取失败则用 base 兜底 */ }
        }
        const tmpl: RecordTemplate = {
          id: base.id, name: base.name, version: base.version, groups, layout_options: layout,
        };
        // 历史版本：用传入的快照数据渲染；否则用记录当前数据。
        const merged = snapshotData
          ? { ...snapshotData }
          : { ...(rd.raw_data || {}), ...(rd.derived_data || {}) };
        const withDefaults = ensureDataMatrixDefaults(tmpl, merged);
        const data = injectAuditFields(tmpl, withDefaults, rd);
        // 「测试设备」反查设备名称 → 显示「设备名称：管理编号」（记录只存管理编号数组）。
        const deviceMap = await fetchDeviceMap(collectDeviceCodes(tmpl, data));
        setSource(generateTypstWithData(tmpl, data, { deviceMap }));
      } catch (e: any) {
        setError(e?.response?.data?.error || e.message || '加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [open, recordId, snapshotData]);

  const st = row?.audit_status ? STATUS_TAG[row.audit_status] : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="68%"
      title={
        <Space wrap>
          <span>原始记录（只读）</span>
          {subtitle && <span style={{ color: '#888', fontSize: 13 }}>{subtitle}</span>}
          {versionLabel ? <Tag color="purple">{versionLabel}</Tag> : st && <Tag color={st.color}>{st.text}</Tag>}
          {row?.tester_name && <span style={{ fontSize: 12, color: '#888' }}>主检：{row.tester_name}</span>}
          {row?.reviewer_name && <span style={{ fontSize: 12, color: '#888' }}>审核：{row.reviewer_name}</span>}
        </Space>
      }
      extra={
        row && !hideReject && !snapshotData && row.audit_status !== 'rejected' ? (
          <Button danger icon={<RollbackOutlined />} onClick={() => setRejectOpen(true)}>
            退回原始记录
          </Button>
        ) : null
      }
    >
      <Alert
        type="info" showIcon banner style={{ marginBottom: 12 }}
        message={snapshotData
          ? '历史版本快照（只读）：按该版本提交/审核时的数据 + 当时锁定的模板版本渲染，仅供查看与追溯。'
          : '只读视图：报告端无权修改原始记录。发现数据有误可「退回原始记录」，由主检在「实验室录入」修改并重走审核。'}
      />
      <Modal
        title="退回原始记录给主检"
        open={rejectOpen}
        onOk={submitReject}
        confirmLoading={rejecting}
        onCancel={() => setRejectOpen(false)}
        okText="确认退回" okButtonProps={{ danger: true }} cancelText="取消"
      >
        <Alert type="warning" showIcon style={{ marginBottom: 12 }}
          message="退回后该记录回到「已退回」，主检修改重审通过后，引用它的已生成报告会被标记为「源数据已更新」。" />
        <Input.TextArea rows={3} value={reason} onChange={e => setReason(e.target.value)}
          placeholder="请说明退回原因（如：燃烧速率单位疑似填错）" />
      </Modal>
      {loading && <Spin style={{ margin: '80px auto', display: 'block' }} />}
      {error && <Alert type="error" showIcon message="加载失败" description={error} />}
      {!loading && !error && source && (
        <TypstViewer source={source} mode="view" height="calc(100vh - 200px)"
          downloadName={`原始记录${subtitle ? '-' + subtitle.replace(/[\\/:*?"<>|]/g, '-') : ''}.pdf`} />
      )}
    </Drawer>
  );
}
