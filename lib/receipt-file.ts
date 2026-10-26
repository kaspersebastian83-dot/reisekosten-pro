import type { Receipt } from './types';

/*
 * Belegfotos werden beim Erfassen verkleinert: längste Seite höchstens RECEIPT_MAX_SIDE Pixel, JPEG.
 * Ein Handyfoto (3–5 MB) wird so meist 0,2–0,6 MB groß und bleibt gut lesbar. Die Originalbelege gehen
 * ohnehin an die Steuerberatung. PDFs bleiben unverändert. Kann ein Bild nicht gelesen werden oder wäre
 * das Ergebnis nicht kleiner, bleibt die Datei wie sie ist – der Beleg geht nie verloren.
 * Der Fingerabdruck (hash) kommt weiter von der Originaldatei: Dasselbe Foto wird als Duplikat erkannt.
 */
export const RECEIPT_MAX_SIDE = 2000;
export const RECEIPT_JPEG_QUALITY = 0.75;

const IMAGE_NAME = /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i;
export const isShrinkableImage = (file: { name: string; type: string }) =>
  file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name) && (file.type.startsWith('image/') || IMAGE_NAME.test(file.name));

/** Zielgröße: Seitenverhältnis bleibt, nie vergrößern. */
export function receiptTargetSize(width: number, height: number, max = RECEIPT_MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export const jpegName = (name: string) => (name.replace(/\.[a-z0-9]{2,5}$/i, '') || 'Beleg') + '.jpg';

type Drawable = { width: number; height: number; source: CanvasImageSource; close: () => void };

/** Bild lesen, Ausrichtung aus den Kameradaten übernehmen. Erst createImageBitmap, sonst <img> (z. B. HEIC in Safari). */
async function decode(file: Blob): Promise<Drawable | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() };
    } catch { /* weiter mit <img> */ }
  }
  if (typeof document === 'undefined' || typeof URL === 'undefined') return null;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('decode')); image.src = url; });
    if (!image.naturalWidth || !image.naturalHeight) return null;
    return { width: image.naturalWidth, height: image.naturalHeight, source: image, close: () => URL.revokeObjectURL(url) };
  } catch { URL.revokeObjectURL(url); return null; }
}

/** Verkleinertes JPEG oder null (dann bleibt das Original). */
export async function shrinkReceiptImage(file: File): Promise<Blob | null> {
  if (!isShrinkableImage(file)) return null;
  const image = await decode(file);
  if (!image) return null;
  try {
    const { width, height } = receiptTargetSize(image.width, image.height);
    let blob: Blob | null = null;
    if (typeof OffscreenCanvas === 'function') {
      const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);   // transparente PNGs: weißer Grund
        context.drawImage(image.source, 0, 0, width, height);
        blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: RECEIPT_JPEG_QUALITY }).catch(() => null);
      }
    }
    if (!blob && typeof document !== 'undefined') {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
        context.drawImage(image.source, 0, 0, width, height);
        blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', RECEIPT_JPEG_QUALITY));
      }
    }
    return blob && blob.size > 0 && blob.size < file.size ? blob : null;
  } catch { return null; }
  finally { image.close(); }
}

const asDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error || new Error('Beleg konnte nicht gelesen werden.'));
  reader.onabort = () => reject(new Error('Lesen des Belegs abgebrochen.'));
  reader.readAsDataURL(blob);
});

export async function readReceiptFile(file: File): Promise<Omit<Receipt, 'id'>> {
  const hash = crypto.subtle ? await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    .then(bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2,'0')).join('')) : `${file.name}-${file.size}`;
  const small = await shrinkReceiptImage(file);
  if (small) return { name: jpegName(file.name), type: 'image/jpeg', size: small.size, hash, dataUrl: await asDataUrl(small) };
  return { name: file.name, type: file.type, size: file.size, hash, dataUrl: await asDataUrl(file) };
}

/**
 * Beleg aufrecht drehen (Grad im Uhrzeigersinn, 90/180/270), z. B. nachdem die Texterkennung ihn quer gelesen hat.
 * Ergebnis als JPEG; null, wenn das Bild nicht gelesen werden kann (dann bleibt es wie es ist).
 */
export async function rotateReceiptImage(dataUrl: string, degrees: number): Promise<{ dataUrl: string; size: number } | null> {
  const turn = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
  if (!turn || typeof document === 'undefined') return null;
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const bytes = match[2] ? Uint8Array.from(atob(match[3]), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(match[3]));
  const blob = new Blob([bytes], { type: match[1] || 'image/jpeg' });
  const image = await decode(blob);
  if (!image) return null;
  try {
    const sideways = turn % 180 !== 0;
    const canvas = document.createElement('canvas');
    canvas.width = sideways ? image.height : image.width; canvas.height = sideways ? image.width : image.height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2); context.rotate((turn * Math.PI) / 180);
    context.drawImage(image.source, -image.width / 2, -image.height / 2);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return out ? { dataUrl: await asDataUrl(out), size: out.size } : null;
  } catch { return null; }
  finally { image.close(); }
}
