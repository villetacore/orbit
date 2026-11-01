export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_OUTPUT = 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    img.src = src;
  });
}

// cropImage renders the selected square of the image into a JPEG blob.
// The server validates and re-encodes it again, so this is only about UX
// and keeping uploads small.
export async function cropImage(src: string, crop: PixelCrop): Promise<Blob> {
  const img = await loadImage(src);
  const size = Math.min(Math.round(crop.width), MAX_OUTPUT);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas недоступен');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, size, size);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось подготовить файл'))), 'image/jpeg', 0.92),
  );
}
