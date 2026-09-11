/**
 * AttachmentManager — 某条 record_data 的附件上传 / 列表 / 下载（自包含，按 recordId 自取）。
 *
 * 两处复用、同一出口（record_data.attachments，经 /api/excel-import/:id/attachments）：
 *  - 订单详情页每行「图片」按钮旁的「附件」弹窗；
 *  - 录入详情页（Record）最下方。
 * kind 区分：'file'＝通用附件（任意格式）；'excel'＝导入留存的 Excel（一般由 Excel 导入流程写入）。
 * 同一条记录的两处都读写同一 attachments 列表，刷新即一致。未保存（无 recordId）时提示先保存。
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, message, Popconfirm, Space, Spin, Tag, Tooltip } from 'antd';
import {
  UploadOutlined, PaperClipOutlined, DownloadOutlined, DeleteOutlined, CheckSquareOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { formatFileBytes } from './ImageProcessButton';

const API = '/api';

interface Attachment { id: string; filename: string; kind?: string; uploaded_at?: string; size_bytes?: number }

export default function AttachmentManager({
  recordId, kind = 'file', title = '附件', readOnly = false, listAll = false, ensureRecordId, style,
}: {
  recordId: number | string | null;
  kind?: 'file' | 'excel';
  title?: string;
  /** 已审核锁定等只读场景：隐藏上传，仅保留下载 */
  readOnly?: boolean;
  /** true＝列表显示【全部】附件（含 Excel），但上传仍按 kind 归类。订单详情页「附件」用它，方便一处下载所有文件 */
  listAll?: boolean;
  /** 尚无 record_data 时延迟创建草稿：仅在用户真正选择附件后调用，避免打开弹窗就产生空记录。 */
  ensureRecordId?: () => Promise<number | string | null>;
  style?: React.CSSProperties;
}) {
  const [effectiveRecordId, setEffectiveRecordId] = useState<number | string | null>(recordId);
  const [list, setList] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 列表过滤：listAll＝全部显示；否则 excel 列只取 excel、通用附件取非 excel（含旧数据无 kind）
  const matches = (a: Attachment) => listAll || (kind === 'excel' ? a.kind === 'excel' : a.kind !== 'excel');

  const reload = async (targetId = effectiveRecordId) => {
    if (!targetId) { setList([]); setSelectedIds(new Set()); return; }
    setLoading(true);
    try {
      const res = await axios.get(`${API}/record-data/${targetId}`);
      const atts: Attachment[] = Array.isArray(res.data?.attachments) ? res.data.attachments : [];
      setList(atts.filter(matches));
      setSelectedIds(new Set());
    } catch { /* 取不到忽略 */ } finally { setLoading(false); }
  };
  useEffect(() => {
    setEffectiveRecordId(recordId);
    reload(recordId);
    /* eslint-disable-next-line */
  }, [recordId]);

  /** 接口一次接收一个文件；前端将本次选择的文件串行上传，避免首次建草稿时并发创建多条记录。 */
  const handleUpload = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      let targetId = effectiveRecordId;
      if (!targetId && ensureRecordId) {
        targetId = await ensureRecordId();
        if (targetId) setEffectiveRecordId(targetId);
      }
      if (!targetId) { message.warning('请先保存草稿后再上传附件'); return; }
      const failed: string[] = [];
      for (const file of files) {
        try {
          const fd = new FormData();
          fd.append('file', file);
          fd.append('kind', kind);
          await axios.post(`${API}/excel-import/${targetId}/attachments`, fd);
        } catch {
          failed.push(file.name);
        }
      }
      await reload(targetId);
      const uploadedCount = files.length - failed.length;
      if (uploadedCount) message.success(`已上传 ${uploadedCount} 个附件`);
      if (failed.length) message.error(`上传失败：${failed.join('、')}`);
    } catch (e: any) {
      message.error('上传失败：' + (e?.response?.data?.error || e.message || ''));
    } finally { setUploading(false); }
  };

  const removeAttachment = async (attachment: Attachment) => {
    if (!effectiveRecordId) return;
    setDeletingId(attachment.id);
    try {
      await axios.delete(`${API}/excel-import/${effectiveRecordId}/attachments/${attachment.id}`);
      setList(prev => prev.filter(item => item.id !== attachment.id));
      setSelectedIds(prev => { const next = new Set(prev); next.delete(attachment.id); return next; });
      message.success('附件已删除');
    } catch (error: any) {
      message.error(`删除失败：${error?.response?.data?.error || error?.message || ''}`);
    } finally {
      setDeletingId(null);
    }
  };

  const removeSelected = async () => {
    if (!effectiveRecordId || !selectedIds.size) return;
    const ids = [...selectedIds];
    setBatchDeleting(true);
    const results = await Promise.allSettled(ids.map(id => axios.delete(`${API}/excel-import/${effectiveRecordId}/attachments/${id}`)));
    const removed = ids.filter((_, index) => results[index].status === 'fulfilled');
    const failed = ids.length - removed.length;
    if (removed.length) setList(prev => prev.filter(item => !removed.includes(item.id)));
    setSelectedIds(new Set());
    setBatchDeleting(false);
    if (removed.length) message.success(`已删除 ${removed.length} 个附件`);
    if (failed) message.error(`${failed} 个附件删除失败，请重试`);
  };

  const downloadSelected = () => {
    if (!effectiveRecordId || !selectedIds.size) return;
    const selected = list.filter(item => selectedIds.has(item.id));
    selected.forEach((attachment) => {
      const link = document.createElement('a');
      link.href = `${API}/excel-import/${effectiveRecordId}/attachments/${attachment.id}`;
      link.download = attachment.filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
    message.success(`已开始下载 ${selected.length} 个附件`);
  };

  const allSelected = list.length > 0 && list.every(item => selectedIds.has(item.id));

  return (
    <div style={style}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span title={title} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 600, color: '#555' }}>
          <PaperClipOutlined /> {title}
          {list.length > 0 && <span style={{ marginLeft: 5, color: '#8a94a6', fontWeight: 400 }}>({list.length})</span>}
        </span>
        {loading && <Spin size="small" />}
        {!readOnly && (
          <>
            <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.target.value = '';
                void handleUpload(files);
              }} />
          </>
        )}
        <Space.Compact size="small" style={{ flex: 'none', whiteSpace: 'nowrap' }}>
          {!readOnly && (
            <Tooltip title={!effectiveRecordId && !ensureRecordId ? '请先保存草稿后再上传附件' : '一次可选择多个附件'}>
              <Button icon={<UploadOutlined />} loading={uploading}
                disabled={!effectiveRecordId && !ensureRecordId}
                onClick={() => fileInputRef.current?.click()}>上传</Button>
            </Tooltip>
          )}
          <Tooltip title={!list.length ? '暂无可选择的附件' : (allSelected ? '取消选择全部附件' : '选择全部附件')}>
            <Button icon={<CheckSquareOutlined />} type={allSelected ? 'primary' : 'default'} disabled={!list.length}
              onClick={() => setSelectedIds(allSelected ? new Set() : new Set(list.map(item => item.id)))}>全选</Button>
          </Tooltip>
          <Tooltip title={!selectedIds.size ? '请先选择需要下载的附件' : `下载已选的 ${selectedIds.size} 个附件`}>
            <Button icon={<DownloadOutlined />} disabled={!selectedIds.size} onClick={downloadSelected}>
              下载{selectedIds.size > 0 ? ` ${selectedIds.size}` : ''}
            </Button>
          </Tooltip>
          {!readOnly && (
            <Popconfirm title={`删除已选的 ${selectedIds.size} 个附件？`} description="删除后无法恢复。" okText="删除" cancelText="取消"
              disabled={!selectedIds.size} onConfirm={removeSelected}>
              <Tooltip title={!selectedIds.size ? '请先选择需要删除的附件' : `删除已选的 ${selectedIds.size} 个附件`}>
                <Button danger icon={<DeleteOutlined />} disabled={!selectedIds.size} loading={batchDeleting} aria-label="批量删除附件" />
              </Tooltip>
            </Popconfirm>
          )}
        </Space.Compact>
      </div>
      {!effectiveRecordId && !readOnly && (
        <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
          {ensureRecordId ? '选择文件后将自动创建草稿记录' : '保存草稿后可上传附件'}
        </div>
      )}
      {list.length > 0 ? (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {list.map(a => (
            <div key={a.id} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Checkbox checked={selectedIds.has(a.id)}
                onChange={(event) => setSelectedIds(prev => { const next = new Set(prev); if (event.target.checked) next.add(a.id); else next.delete(a.id); return next; })} />
              <a href={`${API}/excel-import/${effectiveRecordId}/attachments/${a.id}`} target="_blank" rel="noreferrer"
                title={a.filename}
                style={{ flex: 1, display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, overflow: 'hidden' }}>
                <DownloadOutlined style={{ flex: 'none' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.filename}</span>
                {a.size_bytes != null && <span style={{ color: '#8a94a6' }}>· {formatFileBytes(a.size_bytes)}</span>}
                {a.kind === 'excel' && <Tag color="green" style={{ marginLeft: 6, fontSize: 10 }}>导入Excel</Tag>}
              </a>
              {!readOnly && <Popconfirm title="删除此附件？" description="删除后无法恢复。" okText="删除" cancelText="取消"
                onConfirm={() => removeAttachment(a)}>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} loading={deletingId === a.id} aria-label={`删除 ${a.filename}`} />
              </Popconfirm>}
            </div>
          ))}
        </div>
      ) : (
        effectiveRecordId && !loading && <div style={{ fontSize: 11, color: '#bbb', marginTop: 4 }}>暂无附件</div>
      )}
    </div>
  );
}
