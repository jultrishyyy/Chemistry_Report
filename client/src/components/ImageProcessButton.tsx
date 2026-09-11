import { useEffect, useRef, useState } from 'react';
import { Button, InputNumber, Modal, Slider, Space, message } from 'antd';
import { EditOutlined, RotateLeftOutlined, RotateRightOutlined } from '@ant-design/icons';
import {
  imageDimensions,
  imageSourceToFile,
  processImageFile,
} from '../utils/imageProcessing';

export function formatFileBytes(bytes?: number | null) {
  if (bytes == null || !Number.isFinite(bytes)) return '未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 100 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
export const formatImageBytes = formatFileBytes;

export default function ImageProcessButton({
  src, name, onProcessed, compact = false, disabled = false, sizeBytes, showSize = true,
  displaySize, displayRotation = 0, onDisplaySizeChange, onPreviewChange,
}: {
  src?: string;
  name?: string;
  onProcessed: (file: File) => Promise<any> | any;
  compact?: boolean;
  /** 未上传图片时显示置灰的“调整”按钮，保持操作列位置一致。 */
  disabled?: boolean;
  /** 服务端保存后的实际文件大小。 */
  sizeBytes?: number;
  /** 是否在调整按钮下方显示大小；横向列表可自行把大小放到名称输入框右侧。 */
  showSize?: boolean;
  /** PDF 中的显示尺寸（厘米）。不传时仍可仅做旋转/压缩处理。 */
  displaySize?: { widthCm?: number; heightCm?: number };
  displayRotation?: number;
  /** 显示尺寸变更会即时回写，供右侧 PDF 实时刷新；取消时会自动恢复原值。 */
  onDisplaySizeChange?: (size: { widthCm?: number; heightCm?: number }) => void;
  /** 尺寸及旋转的临时 PDF 预览状态；保存图片后旋转会归零。 */
  onPreviewChange?: (value: { widthCm?: number; heightCm?: number; rotation: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [rotation, setRotation] = useState(0);
  const [displayWidth, setDisplayWidth] = useState<number | undefined>(displaySize?.widthCm);
  const [displayHeight, setDisplayHeight] = useState<number | undefined>(displaySize?.heightCm);
  const [quality, setQuality] = useState(50);
  const [projectedSize, setProjectedSize] = useState<number | null>(null);
  const [calculatingSize, setCalculatingSize] = useState(false);
  const initialPreviewRef = useRef<{ widthCm?: number; heightCm?: number; rotation: number }>({ rotation: 0 });

  const initialize = async (source: File) => {
    const dimensions = await imageDimensions(source);
    setFile(source);
    setNatural(dimensions);
    // 高度始终以具体厘米数呈现。若旧数据只保存了宽度，则按原图比例计算高度，
    // 用户仍可分别改写两个值；不再把“自动”暴露在编辑界面中。
    const widthCm = displaySize?.widthCm;
    const calculatedHeight = widthCm && dimensions.width > 0
      ? Math.round((widthCm * dimensions.height / dimensions.width) * 10) / 10
      : undefined;
    const initial = { widthCm, heightCm: displaySize?.heightCm ?? calculatedHeight, rotation: displayRotation };
    initialPreviewRef.current = initial;
    setRotation(initial.rotation);
    setDisplayWidth(initial.widthCm);
    setDisplayHeight(initial.heightCm);
    setQuality(50);
    setProjectedSize(null);
    setOpen(true);
  };
  const close = (restoreDisplaySize = false) => {
    if (restoreDisplaySize) {
      const initial = initialPreviewRef.current;
      onDisplaySizeChange?.(initial);
      onPreviewChange?.(initial);
    }
    setOpen(false);
  };
  const show = async () => {
    if (!src) return;
    setLoading(true);
    try {
      const source = await imageSourceToFile(src, name || 'image');
      await initialize(source);
    } catch (error: any) {
      message.error(error.message || '图片读取失败');
    } finally {
      setLoading(false);
    }
  };
  const rotate = (degrees: number) => setRotation(value => {
    const next = ((value + degrees) % 360 + 360) % 360;
    onPreviewChange?.({ widthCm: displayWidth, heightCm: displayHeight, rotation: next });
    return next;
  });

  const setPdfSize = (patch: { widthCm?: number; heightCm?: number }) => {
    // 宽、高是独立的 PDF 尺寸；用户可按版面需要自由调整。
    const next = { widthCm: patch.widthCm ?? displayWidth, heightCm: patch.heightCm ?? displayHeight };
    if ('widthCm' in patch) setDisplayWidth(patch.widthCm);
    if ('heightCm' in patch) setDisplayHeight(patch.heightCm);
    onDisplaySizeChange?.(next);
    onPreviewChange?.({ ...next, rotation });
  };

  // 旋转或质量变化后，短暂编码一次，仅计算实际文件大小；PDF 预览由右侧渲染器负责。
  useEffect(() => {
    if (!open || !file) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setCalculatingSize(true);
      try {
        const processed = await processImageFile(file, {
          rotation,
          width: rotation % 180 === 0 ? natural.width : natural.height,
          height: rotation % 180 === 0 ? natural.height : natural.width,
          quality: quality / 100,
        });
        if (!cancelled) {
          setProjectedSize(processed.size);
        }
      } catch {
        if (!cancelled) setProjectedSize(null);
      } finally {
        if (!cancelled) setCalculatingSize(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [file, natural.height, natural.width, open, quality, rotation]);

  const save = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const processed = await processImageFile(file, {
        rotation,
        width: rotation % 180 === 0 ? natural.width : natural.height,
        height: rotation % 180 === 0 ? natural.height : natural.width,
        quality: quality / 100,
      });
      await onProcessed(processed);
      // 文件已按 rotation 实际处理，清除仅供 PDF 即时预览的旋转，避免二次旋转。
      onPreviewChange?.({ widthCm: displayWidth, heightCm: displayHeight, rotation: 0 });
      close();
      message.success(`图片已调整，${Math.round(processed.size / 1024)}KB`);
    } catch (error: any) {
      message.error(error.message || '图片处理失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        <Button size="small" icon={<EditOutlined />} loading={loading} onClick={show} disabled={disabled || !src}
          style={compact ? { paddingInline: 6, fontSize: 11 } : undefined}>
          调整
        </Button>
        {showSize && !disabled && src && sizeBytes != null && (
          <span style={{ color: '#8a94a6', fontSize: 10, lineHeight: 1.2, whiteSpace: 'nowrap' }}>
            {formatImageBytes(sizeBytes)}
          </span>
        )}
      </span>
      {/* 非模态编辑面板：右侧 PDF 保持可滚动、可检查实时效果。 */}
      <Modal title="调整图片" open={open} onCancel={() => close(true)} onOk={save}
        okText="调整并替换" cancelText="取消" confirmLoading={loading}
        mask={false} transitionName="" maskTransitionName="" wrapClassName="image-process-modeless-wrap"
        width={430} style={{ top: 96, margin: 0, left: 'calc(25vw - 215px)', maxWidth: 'calc(50vw - 24px)' }}
        styles={{ body: { maxHeight: 'calc(100vh - 190px)', overflowY: 'auto', overscrollBehavior: 'contain', paddingRight: 6 } }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Button icon={<RotateLeftOutlined />} onClick={() => rotate(-90)}>左转90°</Button>
          <Button icon={<RotateRightOutlined />} onClick={() => rotate(90)}>右转90°</Button>
          <span style={{ color: '#667085' }}>
            调整前 {natural.width}×{natural.height}px · {formatImageBytes(file?.size)}
          </span>
        </Space>
        {onDisplaySizeChange && <div style={{ display: 'grid', gridTemplateColumns: '88px minmax(130px, 1fr)', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <span>PDF 宽度</span>
          <InputNumber min={1} max={30} step={0.1} value={displayWidth} addonAfter="cm" placeholder="自动" style={{ width: '100%' }}
            onChange={value => setPdfSize({ widthCm: value == null ? undefined : Number(value) })} />
          <span>PDF 高度</span>
          <InputNumber min={1} max={40} step={0.1} value={displayHeight} addonAfter="cm" placeholder="自动" style={{ width: '100%' }}
            onChange={value => setPdfSize({ heightCm: value == null ? undefined : Number(value) })} />
        </div>}
        <div style={{ display: 'grid', gridTemplateColumns: '88px minmax(150px, 1fr) 82px', gap: 10, alignItems: 'center' }}>
          <span>压缩质量</span>
          <Slider min={20} max={95} step={1} value={quality} onChange={setQuality} />
          <InputNumber min={20} max={95} value={quality} addonAfter="%" onChange={value => setQuality(value || 50)} />
        </div>
        <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 6, background: '#f6f8fb', color: '#475467', fontSize: 12 }}>
          调整后文件：{calculatingSize ? '正在计算大小…' : formatImageBytes(projectedSize)}
          {file && projectedSize != null && (
            <span style={{ color: projectedSize <= file.size ? '#389e0d' : '#d46b08', marginLeft: 8 }}>
              （{projectedSize <= file.size ? '减少' : '增加'} {formatImageBytes(Math.abs(file.size - projectedSize))}）
            </span>
          )}
        </div>
        <div style={{ marginTop: 8, color: '#667085', fontSize: 12 }}>
          PDF 尺寸以厘米计，宽高可分别调整，并即时显示在右侧 PDF；旋转和压缩会在保存时替换原图片。
        </div>
      </Modal>
    </>
  );
}
