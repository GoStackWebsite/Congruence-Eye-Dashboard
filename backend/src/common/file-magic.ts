/**
 * Content sniffing by magic number. Uploads are classified by their bytes, never by the client's
 * Content-Type or file extension (an .exe renamed to .jpg is rejected).
 */
export type Sniffed =
  | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
  | 'video/mp4' | 'video/quicktime' | 'video/webm'
  | 'application/pdf' | 'application/zip' | 'application/x-ole' // zip = docx/xlsx/pptx, ole = legacy doc/xls/ppt
  | 'executable' | 'script' | 'text' | null;

const startsWith = (b: Buffer, sig: number[], offset = 0) => b.length >= offset + sig.length && sig.every((x, i) => b[offset + i] === x);
const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString('latin1');

export function sniff(buf: Buffer | undefined | null): Sniffed {
  if (!buf || !buf.length) return null;
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(buf, 0, 6) === 'GIF87a' || ascii(buf, 0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(buf, 4, 8) === 'ftyp') return ascii(buf, 8, 10) === 'qt' ? 'video/quicktime' : 'video/mp4';
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  if (ascii(buf, 0, 5) === '%PDF-') return 'application/pdf';
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return 'application/zip';
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'application/x-ole';
  // Windows PE (MZ), ELF, Mach-O (32/64, both endians, fat), Java class
  if (startsWith(buf, [0x4d, 0x5a]) || startsWith(buf, [0x7f, 0x45, 0x4c, 0x46])) return 'executable';
  if ([[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe]].some((s) => startsWith(buf, s))) return 'executable';
  const head = ascii(buf, 0, Math.min(buf.length, 512));
  if (head.startsWith('#!') || /^\s*<(script|html|!doctype html|svg)/i.test(head)) return 'script';
  // plain text: no NUL bytes in the first 512 bytes
  if (!buf.subarray(0, 512).includes(0)) return 'text';
  return null;
}

export const IMAGE_TYPES: Sniffed[] = ['image/jpeg', 'image/png', 'image/webp'];
export const VIDEO_TYPES: Sniffed[] = ['video/mp4', 'video/quicktime', 'video/webm'];
/** Documents library: PDFs, Office files, images, videos and plain text/CSV. Executables and scripts are refused. */
export const DOCUMENT_TYPES: Sniffed[] = ['application/pdf', 'application/zip', 'application/x-ole', 'text', ...IMAGE_TYPES, 'image/gif', ...VIDEO_TYPES];

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
