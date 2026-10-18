import type { Receipt } from './types';

export async function readReceiptFile(file: File): Promise<Omit<Receipt, 'id'>> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Beleg konnte nicht gelesen werden.'));
    reader.onabort = () => reject(new Error('Lesen des Belegs abgebrochen.'));
    reader.readAsDataURL(file);
  });
  const hash = crypto.subtle ? await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    .then(bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2,'0')).join('')) : `${file.name}-${file.size}`;
  return {name:file.name, type:file.type, size:file.size, hash, dataUrl};
}
