import { useEffect, useState } from 'react';
import { Alert, Modal, Select, Space, Spin, Tag } from 'antd';
import axios from 'axios';
import PdfPreviewModal from './PdfPreviewModal';
import { getRecordTemplatePreviewPdf, getReportTemplatePreviewPdf } from '../utils/pdfDownload';

type Kind = 'record' | 'report';
interface Props {
  open: boolean;
  kind: Kind;
  templateId: number;
  templateName: string;
  /** 从版本历史点开时指定初始版本；仍然只在 PDF 弹窗中预览。 */
  initialVersionId?: number;
  onClose: () => void;
}
interface VersionOption {
  id: number;
  version_no: number;
  status: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  pending: '待审核',
  rejected: '已退回',
  approved: '当前生效',
  superseded: '历史生效',
};
const STATUS_COLOR: Record<string, string> = {
  draft: 'default',
  pending: 'orange',
  rejected: 'red',
  approved: 'green',
  superseded: 'blue',
};

/**
 * 模板预览弹窗：
 *  - 默认优先当前生效版本；
 *  - 从未生效时回退到最新工作版本（草稿 / 待审 / 已退回）；
 *  - 历史版本全部只在 PDF 弹窗中查看，不进入编辑器。
 */
export default function TemplatePdfPreviewModal(props: Props) {
  // A different template or a fresh opening must never reuse the previous version selection.
  if (!props.open) return null;
  return <TemplatePreviewSession key={`${props.kind}:${props.templateId}:${props.initialVersionId ?? ''}`} {...props} />;
}

function TemplatePreviewSession({
  open, kind, templateId, templateName, initialVersionId, onClose,
}: Props) {
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [error, setError] = useState('');
  const [versions, setVersions] = useState<VersionOption[]>([]);
  const [selected, setSelected] = useState<number | undefined>();

  useEffect(() => {
    if (!open) return;
    let active = true;
    const controller = new AbortController();
    setLoadingMeta(true);
    setError('');
    const api = `/api/${kind === 'record' ? 'record-templates' : 'report-templates'}/${templateId}`;
    Promise.all([axios.get(api, { signal: controller.signal }), axios.get(`${api}/versions`, { signal: controller.signal })])
      .then(([baseRes, versionsRes]) => {
        if (!active) return;
        if (!Array.isArray(versionsRes.data)) throw Error('版本信息异常，请关闭后重试');
        const allowed = (versionsRes.data as VersionOption[])
          .filter(v => v && Number.isSafeInteger(Number(v.id)) && Number(v.id) > 0)
          .map(v => ({ ...v, id: Number(v.id), version_no: Number(v.version_no) }))
          .sort((a, b) => b.version_no - a.version_no);
        const currentId = Number(baseRes.data?.current_version_id);
        const requested = initialVersionId == null
          ? undefined
          : allowed.find(v => v.id === Number(initialVersionId));
        const current = Number.isFinite(currentId)
          ? allowed.find(v => v.id === currentId)
          : undefined;
        // 没有生效版本时，优先取最近的草稿/待审/已退回工作版本。
        const latestWork = allowed.find(v =>
          v.status === 'draft' || v.status === 'pending' || v.status === 'rejected');
        const initial = requested || current || latestWork || allowed[0];
        setVersions(allowed);
        setSelected(initial?.id);
        if (!initial) setError('该模板尚无任何可预览版本');
      })
      .catch((e: any) => {
        if (active) setError(e?.response?.data?.error || e?.message || '版本信息加载失败');
      })
      .finally(() => { if (active) setLoadingMeta(false); });
    return () => { active = false; controller.abort(); };
  }, [open, kind, templateId, initialVersionId]);

  if (loadingMeta) {
    return <Modal open={open} title={`预览 · ${templateName}`} footer={null} onCancel={onClose}>
      <div style={{ height: 260, display: 'grid', placeItems: 'center' }}><Spin tip="正在读取生效版本…" /></div>
    </Modal>;
  }
  if (error || !selected) {
    return <Modal open={open} title={`预览 · ${templateName}`} footer={null} onCancel={onClose}>
      <Alert type="info" showIcon message="暂无可预览版本" description={error || '该模板尚无任何版本'} />
    </Modal>;
  }

  const selectedVersion = versions.find(v => v.id === selected);
  return (
    <PdfPreviewModal
      open={open}
      title={`预览 · ${templateName}`}
      reloadKey={selected}
      loadPdf={() => kind === 'record'
        ? getRecordTemplatePreviewPdf(templateId, selected)
        : getReportTemplatePreviewPdf(templateId, selected)}
      downloadName={`${templateName}-v${selectedVersion?.version_no || ''}.pdf`}
      toolbar={
        <Space wrap>
          <span style={{ color: '#667085' }}>当前预览</span>
          <Select
            value={selected}
            style={{ minWidth: 220 }}
            onChange={setSelected}
            options={versions.map(v => ({
              value: v.id,
              label: `v${v.version_no} · ${STATUS_LABEL[v.status] || v.status}`,
            }))}
          />
          {selectedVersion && <Tag color={STATUS_COLOR[selectedVersion.status] || 'default'}>
            {STATUS_LABEL[selectedVersion.status] || selectedVersion.status}
          </Tag>}
        </Space>
      }
      onClose={onClose}
    />
  );
}
