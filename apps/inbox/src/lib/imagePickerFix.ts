const TARGET_BYTES = 4.5 * 1024 * 1024;
const MAX_DIMENSION = 2048;
const processedInputs = new WeakSet<HTMLInputElement>();

function guessedMime(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return '';
}

async function toBitmap(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

async function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Gagal memproses gambar.')), 'image/jpeg', quality);
  });
}

async function normalizeImage(file: File): Promise<File> {
  const mime = guessedMime(file);
  if (!mime.startsWith('image/')) return file;
  if (file.size <= TARGET_BYTES && file.type) return file;

  try {
    const bitmap = await toBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas tidak tersedia.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    let quality = 0.9;
    let blob = await canvasBlob(canvas, quality);
    while (blob.size > TARGET_BYTES && quality > 0.5) {
      quality -= 0.1;
      blob = await canvasBlob(canvas, quality);
    }

    const baseName = file.name.replace(/\.[^.]+$/, '') || `image-${Date.now()}`;
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    if (!file.type && mime) {
      return new File([file], file.name, { type: mime, lastModified: file.lastModified });
    }
    return file;
  }
}

export function installImagePickerFix(): void {
  document.addEventListener('change', async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.accept.includes('image')) return;
    if (processedInputs.has(input)) {
      processedInputs.delete(input);
      return;
    }

    const file = input.files?.[0];
    if (!file) return;
    const mime = guessedMime(file);
    if (!mime.startsWith('image/')) return;

    const needsNormalization = !file.type || file.size > TARGET_BYTES;
    if (!needsNormalization) return;

    event.stopImmediatePropagation();
    const normalized = await normalizeImage(file);
    const transfer = new DataTransfer();
    transfer.items.add(normalized);
    input.files = transfer.files;
    processedInputs.add(input);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, true);
}

