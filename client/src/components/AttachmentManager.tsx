/**
 * AttachmentManager — 某条 record_data 的附件上传 / 列表 / 下载（自包含，按 recordId 自取）。
 *
 * 两处复用、同一出口（record_data.attachments，经 /api/excel-import/:id/attachments）：
 *  - 订单详情页每行「图片」按钮旁的「附件」弹窗；
 *  - 录入详情页（Record）最下方。
 * kind 区分：'file'＝通用附件（任意格式）；'excel'＝导入留存的 Excel（一般由 Excel 导入流程写入）。
 * 同一条记录的两处都读写同一 attachments 列表，刷新即一致。未保存（无 recordId）时提示先保存。
 */
import { useEffect, useState } from 'react';
import { Button, Upload, message, Spin, Tag } from 'antd';
import { UploadOutlined, PaperClipOutlined, DownloadOutlined } from '@ant-design/icons';
import axios from 'axios';

const API = '/api';

interface Attachment { id: string; filename: string; kind?: string; uploaded_at?: string }

export default function AttachmentManager({
  recordId, kind = 'file', title = '附件', readOnly = false, listAll = false, style,
}: {
  recordId: number | string | null;
  kind?: 'file' | 'excel';
  title?: string;
  /** 已审核锁定等只读场景：隐藏上传，仅保留下载 */
  readOnly?: boolean;
  /** true＝列表显示【全部】附件（含 Excel），但上传仍按 kind 归类。订单详情页「附件」用它，方便一处下载所有文件 */
  listAll?: boolean;
  style?: React.CSSProperties;
}) {
  const [list, setList] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  // 列表过滤：listAll＝全部显示；否则 excel 列只取 excel、通用附件取非 excel（含旧数据无 kind）
  const matches = (a: Attachment) => listAll || (kind === 'excel' ? a.kind === 'excel' : a.kind !== 'excel');

  const reload = async () => {
    if (!recordId) { setList([]); return; }
    setLoading(true);
    try {
      const res = await axios.get(`${API}/record-data/${recordId}`);
      const atts: Attachment[] = Array.isArray(res.data?.attachments) ? res.data.attachments : [];
      setList(atts.filter(matches));
    } catch { /* 取不到忽略 */ } finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [recordId]);

  const handleUpload = async (file: File) => {
    if (!recordId) { message.warning('请先保存草稿后再上传附件'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      await axios.post(`${API}/excel-import/${recordId}/attachments`, fd);
      message.success('附件已上传');
      await reload();
    } catch (e: any) {
      message.error('上传失败：' + (e?.response?.data?.error || e.message || ''));
    } finally { setUploading(false); }
  };

  return (
    <div style={style}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#555' }}><PaperClipOutlined /> {title}</span>
        {!readOnly && (
          <Upload showUploadList={false} beforeUpload={(f) => { handleUpload(f as File); return false; }} disabled={!recordId}>
            <Button size="small" icon={<UploadOutlined />} loading={uploading} disabled={!recordId}>上传附件（任意格式）</Button>
          </Upload>
        )}
        {!recordId && <span style={{ fontSize: 11, color: '#999' }}>（保存草稿后可上传）</span>}
        {loading && <Spin size="small" />}
      </div>
      {list.length > 0 ? (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {list.map(a => (
            <a key={a.id} href={`${API}/excel-import/${recordId}/attachments/${a.id}`} target="_blank" rel="noreferrer"
              style={{ fontSize: 12 }}>
              <DownloadOutlined /> {a.filename}
              {a.kind === 'excel' && <Tag color="green" style={{ marginLeft: 6, fontSize: 10 }}>导入Excel</Tag>}
            </a>
          ))}
        </div>
      ) : (
        recordId && !loading && <div style={{ fontSize: 11, color: '#bbb', marginTop: 4 }}>暂无附件</div>
      )}
    </div>
  );
}
