import { useState, type CSSProperties } from 'react';
import { reportPreviewPhotoSrc, type ReportImagePreviewModel } from '../../../../shared/report-image-preview';
import { reportFontStack } from '../../../../shared/report-body-layout';
import type { StyleOverride } from '../../../../shared/types';

function PreviewPhoto({ src, alt, style }: { src: string; alt: string; style: CSSProperties }) {
  const [failed, setFailed] = useState<string>();
  return failed === src ? <span role="status">图片加载失败，请检查附件</span>
    : <img src={src} alt={alt} style={style} onError={() => setFailed(src)} />;
}

/** Paper layout stays visible; supported image collections may edit titles in place. */
export default function ReportImagePreview({ model, onTitleChange }: { model: ReportImagePreviewModel; onTitleChange?: (index: number, title: string) => void }) {
  const items = model.items.length ? model.items : [{ title: '', photo: undefined }];
  const solo = items.length % model.cols === 1 ? (model.solo === 'first' ? 0 : items.length - 1) : -1;
  const titleStyle = (style: StyleOverride | undefined = model.titleStyle): CSSProperties => ({
    fontFamily: style?.font ? reportFontStack(style.font, true) : undefined,
    fontSize: style?.size,
    fontWeight: style?.weight === 'regular' ? 400 : 700,
    fontStyle: style?.italic ? 'italic' : 'normal', color: style?.color,
    paddingBlock: model.titleInsetY != null ? `${model.titleInsetY}pt` : undefined,
  });
  return <div className="report-image-preview">
    {model.aboveText && <p>{model.aboveText}</p>}
    {(model.captionLabel || model.caption) && <p>{model.captionLabel && <strong>{model.captionLabel}：</strong>}{model.caption}</p>}
    {model.title && <div className="report-image-preview-title" style={titleStyle()}>{model.title}</div>}
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${model.cols}, minmax(0, 1fr))`, gap: model.seamless ? 0 : 8 }}>
      {items.map((item, index) => {
        const photo = item.photo;
        const customWidth = Number(photo?.display_width_cm), customHeight = Number(photo?.display_height_cm);
        const src = reportPreviewPhotoSrc(photo);
        const width = Number.isFinite(customWidth) && customWidth > 0 ? Math.min(customWidth, 30) : model.width;
        const height = Number.isFinite(customHeight) && customHeight > 0 ? Math.min(customHeight, 40) : model.height;
        const rotation = Number.isFinite(Number(photo?.display_rotation)) ? Number(photo.display_rotation) : 0;
        return <figure key={index} tabIndex={0} data-report-photo-index={index} aria-label={`图片框 ${index + 1}`} onClick={event => { if (!(event.target as HTMLElement).closest('[contenteditable="true"]')) event.currentTarget.focus(); }} style={{ margin: 0, minWidth: 0, border: '1px solid #ddd', gridColumn: index === solo ? '1 / -1' : undefined }}>
          {(item.title || onTitleChange) && <figcaption className="report-image-preview-title"
            contentEditable={!!onTitleChange} suppressContentEditableWarning role={onTitleChange ? 'textbox' : undefined}
            aria-label={onTitleChange ? `图片 ${index + 1} 标题` : undefined}
            style={{ ...titleStyle(item.titleStyle), ...(onTitleChange ? { minHeight: '1.4em', cursor: 'text' } : {}) }}
            onClick={onTitleChange ? event => event.stopPropagation() : undefined}
            onKeyDown={onTitleChange ? event => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
              if (event.key === 'Escape') { event.currentTarget.textContent = item.title; event.currentTarget.blur(); }
            } : undefined}
            onBlur={onTitleChange ? event => { const value = event.currentTarget.textContent || ''; if (value !== item.title) onTitleChange(index, value); } : undefined}>{item.title}</figcaption>}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: `${model.insetY ?? 6}pt ${model.insetX ?? 6}pt`, overflow: 'hidden' }}>
            {src ? <PreviewPhoto src={src} alt={item.title || '报告图片'} style={{ display: 'block', width: `${width}cm`, maxWidth: '100%', aspectRatio: `${width} / ${height}`, objectFit: (customWidth > 0 || customHeight > 0) ? 'fill' : 'contain', transform: rotation ? `rotate(${rotation}deg)` : undefined }} />
              : <span className="report-image-empty">暂无图片</span>}
          </div>
        </figure>;
      })}
    </div>
    {model.belowText && <p>{model.belowText}</p>}
  </div>;
}
