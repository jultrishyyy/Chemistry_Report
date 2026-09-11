export interface ImageProcessOptions {
  rotation?: number;
  width?: number;
  height?: number;
  quality?: number;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

// 同一次页面会话内标记已经过 Canvas 处理的文件，避免“调整并替换”后在上传链路再次按 50% 重复压缩。
const preparedImageFiles = new WeakSet<File>();

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取该图片格式'));
    };
    image.src = url;
  });
}

export async function imageDimensions(file: Blob): Promise<ImageDimensions> {
  const image = await loadImage(file);
  return { width: image.naturalWidth, height: image.naturalHeight };
}

/** Canvas 重采样并转为 JPEG；白底避免透明 PNG 转换后出现黑底。 */
export async function processImageFile(file: File, options: ImageProcessOptions = {}): Promise<File> {
  const image = await loadImage(file);
  const rotation = ((Math.round((options.rotation || 0) / 90) * 90) % 360 + 360) % 360;
  const swap = rotation === 90 || rotation === 270;
  const rotatedWidth = swap ? image.naturalHeight : image.naturalWidth;
  const rotatedHeight = swap ? image.naturalWidth : image.naturalHeight;
  const outputWidth = Math.max(1, Math.round(options.width || rotatedWidth));
  const outputHeight = Math.max(1, Math.round(options.height || rotatedHeight));
  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持图片处理');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, outputWidth, outputHeight);
  context.translate(outputWidth / 2, outputHeight / 2);
  context.rotate(rotation * Math.PI / 180);
  const drawWidth = swap ? outputHeight : outputWidth;
  const drawHeight = swap ? outputWidth : outputHeight;
  context.drawImage(
    image,
    -drawWidth / 2,
    -drawHeight / 2,
    drawWidth,
    drawHeight,
  );
  const quality = Math.max(0.2, Math.min(1, options.quality ?? 0.5));
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    result => result ? resolve(result) : reject(new Error('图片处理失败')),
    'image/jpeg',
    quality,
  ));
  const base = file.name.replace(/\.[^.]+$/, '') || 'image';
  const result = new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  preparedImageFiles.add(result);
  return result;
}

/** 新上传图片统一做温和压缩，避免相机原图直接进入 PDF。 */
export async function prepareImageForUpload(file: File): Promise<File> {
  if (preparedImageFiles.has(file)) return file;
  try {
    const dimensions = await imageDimensions(file);
    return await processImageFile(file, {
      width: dimensions.width,
      height: dimensions.height,
      quality: 0.5,
    });
  } catch {
    // 浏览器无法解码的格式仍交给原上传链路，避免阻断录入。
    return file;
  }
}

export async function imageSourceToFile(src: string, name = 'image'): Promise<File> {
  const response = await fetch(src);
  if (!response.ok) throw new Error('无法读取服务器图片');
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || 'image/jpeg', lastModified: Date.now() });
}
