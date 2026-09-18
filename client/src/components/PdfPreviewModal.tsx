import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Modal, Spin } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import PdfPreview from './TypstViewer/PdfPreview';

interface Props {
  open: boolean;
  title: string;
  loadPdf: () => Promise<string>;
  downloadName?: string;
  reloadKey?: string | number;
  toolbar?: ReactNode;
  onClose: () => void;
}

/** 列表就地 PDF 预览：不进入编辑器，关闭时释放 blob URL。 */
export default function PdfPreviewModal({ open, title, loadPdf, downloadName = '预览.pdf', reloadKey = '', toolbar, onClose }: Props) {
  const loaderRef = useRef(loadPdf);
  loaderRef.current = loadPdf;
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    let createdUrl = '';
    setLoading(true);
    setError('');
    setUrl('');
    Promise.resolve().then(() => loaderRef.current())
      .then(next => {
        createdUrl = next;
        if (active) setUrl(next);
        else if (next.startsWith('blob:')) URL.revokeObjectURL(next);
      })
      .catch((e: any) => {
        if (active) setError(e?.response?.data?.message || e?.response?.data?.error || e?.message || '预览加载失败');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      if (createdUrl.startsWith('blob:')) URL.revokeObjectURL(createdUrl);
    };
  }, [open, reloadKey]);

  return (
    <Modal
      open={open}
      title={title}
      width="min(980px, calc(100vw - 32px))"
      style={{ top: 16, paddingBottom: 0 }}
      styles={{
        container: {
          height: 'min(820px, calc(100dvh - 32px))',
          maxHeight: 'calc(100dvh - 32px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        },
        header: { flex: '0 0 auto' },
        body: {
          padding: 0,
          flex: '1 1 auto',
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        },
        footer: { flex: '0 0 auto' },
      }}
      footer={url ? (
        <Button type="primary" icon={<DownloadOutlined />} href={url} download={downloadName}>下载 PDF</Button>
      ) : null}
      onCancel={onClose}
      destroyOnHidden
    >
      {toolbar && <div style={{ flex: '0 0 auto', padding: '10px 16px', borderBottom: '1px solid #eef1f5', background: '#fafcff' }}>{toolbar}</div>}
      {loading && <div style={{ flex: '1 1 auto', minHeight: 0, display: 'grid', placeItems: 'center' }}><Spin tip="正在生成预览…" /></div>}
      {!loading && error && <Alert type="error" showIcon message="预览加载失败" description={error} style={{ margin: 16 }} />}
      {!loading && url && (
        <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
          <PdfPreview url={url} height="100%" />
        </div>
      )}
    </Modal>
  );
}
