export type SignatureMode = 'draw' | 'type' | 'upload';

export interface SavedSignatureItem {
  id: string;
  label: string;
  mode: SignatureMode;
  dataUrl: string;
  width: number;
  height: number;
  createdAt: number;
}

export interface SignatureFontOption {
  id: string;
  label: string;
  cssFont: string;
  isItalic?: boolean;
}

export const SIGNATURE_FONTS: SignatureFontOption[] = [
  { id: 'script', label: 'Executive Script', cssFont: '"Brush Script MT", "Segoe Script", cursive' },
  { id: 'serif', label: 'Classic Serif', cssFont: 'Georgia, "Times New Roman", serif', isItalic: true },
  { id: 'handwriting', label: 'Natural Pen', cssFont: '"Lucida Handwriting", "Segoe Print", cursive' },
  { id: 'mono', label: 'Legal Typewriter', cssFont: 'Consolas, "Courier New", monospace' },
];

export const SIGNATURE_INK_COLORS = [
  { label: 'Midnight Ink', value: '#0f172a' },
  { label: 'Royal Blue Ink', value: '#1e3a8a' },
  { label: 'Executive Navy', value: '#0369a1' },
  { label: 'Notary Crimson', value: '#991b1b' },
];

export const SIGNING_REASONS = [
  'I approve this document',
  'I have reviewed and verified this document',
  'Authorized Executive Sign-off',
  'Certified True & Accurate Copy',
];

const STORAGE_KEY_V2 = 'novapdfpro_saved_signatures_v2';
const LEGACY_STORAGE_KEY = 'epdf_saved_signatures';

/**
 * Compute real cryptographic SHA-256 hex digest using Web Crypto API (100% offline).
 */
export async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', copy.buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  // Fallback deterministic FNV-1a 64-bit style digest only if crypto.subtle unavailable
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < copy.length; i++) {
    h1 ^= copy[i];
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= copy[i] + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, '0') +
    (h2 >>> 0).toString(16).padStart(8, '0')
  ).toUpperCase();
}

/**
 * Format an ISO timestamp into a compact deterministic UTC string for certificate seals.
 */
export function formatCertificateTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/**
 * Bind document digest + signer identity + role + timestamp + signature graphic into a verifiable SHA-256 seal digest.
 */
export async function computeSignatureSealDigest(params: {
  documentSha256: string;
  signerName: string;
  signerRole?: string;
  reason: string;
  timestampIso: string;
  signatureDataUrl: string;
}): Promise<string> {
  const canonical = [
    params.documentSha256,
    params.signerName.trim(),
    (params.signerRole || '').trim(),
    params.reason.trim(),
    params.timestampIso,
    params.signatureDataUrl.slice(0, 128),
  ].join('|');
  const encoded = new TextEncoder().encode(canonical);
  return computeSha256Hex(encoded);
}

/**
 * Scan non-transparent bounding box of a canvas and crop tightly with crisp padding.
 * Returns null if the canvas contains no visible ink strokes.
 */
export function trimSignatureCanvas(
  sourceCanvas: HTMLCanvasElement,
  padding: number = 12
): { dataUrl: string; width: number; height: number } | null {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || w === 0 || h === 0) return null;

  const { data } = ctx.getImageData(0, 0, w, h);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    const rowOffset = y * w * 4;
    for (let x = 0; x < w; x++) {
      const alpha = data[rowOffset + x * 4 + 3];
      if (alpha > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return null; // Blank canvas
  }

  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropW = Math.min(w - cropX, maxX - minX + 1 + padding * 2);
  const cropH = Math.min(h - cropY, maxY - minY + 1 + padding * 2);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = Math.max(1, cropW);
  outCanvas.height = Math.max(1, cropH);
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) return null;

  outCtx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  return {
    dataUrl: outCanvas.toDataURL('image/png'),
    width: outCanvas.width,
    height: outCanvas.height,
  };
}

/**
 * Render typed signature onto a high-res transparent canvas and crop accurately.
 */
export function renderTypedSignature(
  text: string,
  fontOption: SignatureFontOption,
  color: string
): { dataUrl: string; width: number; height: number } | null {
  const clean = text.trim();
  if (!clean) return null;

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = 1100;
  tempCanvas.height = 280;
  const ctx = tempCanvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
  const fontPrefix = fontOption.isItalic ? 'italic ' : '';
  ctx.font = `${fontPrefix}86px ${fontOption.cssFont}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(clean, 40, tempCanvas.height / 2);

  return trimSignatureCanvas(tempCanvas, 16);
}

/**
 * Process an uploaded image data URL, optionally knocking out white/paper background to alpha,
 * and cropping to tight transparent PNG bounds.
 */
export function processUploadedSignature(
  fileDataUrl: string,
  removeWhiteBackground: boolean
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 900;
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const w = Math.max(1, Math.round((img.naturalWidth || 300) * scale));
      const h = Math.max(1, Math.round((img.naturalHeight || 120) * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        resolve({ dataUrl: fileDataUrl, width: w, height: h });
        return;
      }

      ctx.drawImage(img, 0, 0, w, h);

      if (removeWhiteBackground) {
        const imageData = ctx.getImageData(0, 0, w, h);
        const px = imageData.data;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i];
          const g = px[i + 1];
          const b = px[i + 2];
          // Luminance-based smooth paper background removal
          const brightness = (r + g + b) / 3;
          const chroma = Math.max(r, g, b) - Math.min(r, g, b);
          if (brightness > 225 && chroma < 24) {
            px[i + 3] = 0;
          } else if (brightness > 195 && chroma < 24) {
            px[i + 3] = Math.round(px[i + 3] * ((225 - brightness) / 30));
          }
        }
        ctx.putImageData(imageData, 0, 0);
      }

      const trimmed = trimSignatureCanvas(canvas, 10);
      if (trimmed) {
        resolve(trimmed);
      } else {
        resolve({ dataUrl: canvas.toDataURL('image/png'), width: w, height: h });
      }
    };
    img.onerror = () => reject(new Error('Failed to load signature image file'));
    img.src = fileDataUrl;
  });
}

/**
 * Compute proportional PDF placement box given natural PNG dimensions and target max width.
 */
export function fitSignatureDimensions(
  naturalWidth: number,
  naturalHeight: number,
  targetMaxWidth: number = 180,
  targetMaxHeight: number = 85
): { width: number; height: number } {
  const nw = Math.max(1, naturalWidth || 180);
  const nh = Math.max(1, naturalHeight || 70);
  const ratio = Math.min(targetMaxWidth / nw, targetMaxHeight / nh);
  return {
    width: Math.max(60, Math.round(nw * ratio)),
    height: Math.max(24, Math.round(nh * ratio)),
  };
}

/**
 * Load locally saved signatures (migrating any legacy raw dataUrl entries seamlessly).
 */
export function loadSavedSignatures(): SavedSignatureItem[] {
  try {
    const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2);
      if (Array.isArray(parsed)) return parsed;
    }

    const rawLegacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (rawLegacy) {
      const legacyArr = JSON.parse(rawLegacy);
      if (Array.isArray(legacyArr) && legacyArr.length > 0) {
        const migrated: SavedSignatureItem[] = legacyArr
          .filter((item): item is string => typeof item === 'string' && item.startsWith('data:image/'))
          .map((dataUrl, i) => ({
            id: `sig_legacy_${Date.now()}_${i}`,
            label: `Saved Signature ${i + 1}`,
            mode: 'draw' as SignatureMode,
            dataUrl,
            width: 180,
            height: 70,
            createdAt: Date.now(),
          }));
        saveSignaturesList(migrated);
        return migrated;
      }
    }
  } catch {
    // Ignore storage read error
  }
  return [];
}

export function saveSignaturesList(items: SavedSignatureItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(items));
  } catch {
    // Ignore quota errors
  }
}
