/**
 * PdfDownloadButton — 列表行「下载 PDF」按钮（编译可能要点时间，带 loading + 错误提示）。
 * onDownload 自己负责生成/取 PDF 并触发下载（见 utils/pdfDownload.ts）。
 */
import { useState } from 'react';
import { Button, Tooltip, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';

export default function PdfDownloadButton({
  onDownload, title = '下载渲染后的 PDF', size = 'small', type, children,
}: {
  onDownload: () => Promise<void>;
  title?: string;
  size?: 'small' | 'middle' | 'large';
  type?: 'default' | 'text' | 'link' | 'primary' | 'dashed';
  children?: React.ReactNode;
}) {
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    try { await onDownload(); } catch (e: any) {
      message.error('下载失败：' + (e?.response?.data?.error || e?.message || '编译/取文件失败'));
    } finally { setLoading(false); }
  };
  return (
    <Tooltip title={title}>
      <Button size={size} type={type} icon={<DownloadOutlined />} loading={loading} onClick={run}>{children}</Button>
    </Tooltip>
  );
}
