import { PDFDocument, PDFHexString, PDFRawStream } from 'pdf-lib';

export interface SecurityOptions {
  userPassword?: string;
  ownerPassword?: string;
  permissions?: {
    printing?: 'highResolution' | 'lowResolution' | 'none';
    modifying?: boolean;
    copying?: boolean;
    annotating?: boolean;
    fillingForms?: boolean;
    contentAccessibility?: boolean;
    documentAssembly?: boolean;
  };
}

// ISO 32000-1 Standard 32-byte password padding string
const PADDING = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41,
  0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a
]);

/**
 * High-performance pure-JavaScript MD5 (RFC 1321)
 * Works in Browser, Web Workers, Electron, and Node.js without native dependencies
 */
export function calculateMD5(data: Uint8Array): Uint8Array {
  const r = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  const k = [
    -680876936, -389564586, 606105819, -1044525330, -176418897, 1200080426, -1473231341, -45705983,
    1770035416, -1958414417, -42063, -1990404162, 1804603682, -40341101, -1502002290, 1236535329,
    -165796510, -1069501632, 643717713, -373897302, -701558691, 38016083, -660478335, -405537848,
    568446438, -1019803690, -187363961, 1163531501, -1444681467, -51403784, 1735328473, -1926607734,
    -378558, -2022574463, 1839030562, -35309556, -1530992060, 1272893353, -155497632, -1094730640,
    681279174, -358537222, -722521979, 76029189, -640364487, -421815835, 530742520, -995338651,
    -198630844, 1126891415, -1416354905, -57434055, 1700485571, -1894986606, -1051523, -2054922799,
    1873313359, -30611744, -1560198380, 1309151649, -145523070, -1120210379, 718787259, -343485551
  ];

  const length = data.length;
  const paddedLength = (length + 72) & ~63;
  const padded = new Uint8Array(paddedLength);
  for (let i = 0; i < length; i++) padded[i] = data[i];
  padded[length] = 0x80;
  padded[paddedLength - 8] = (length << 3) & 0xff;
  padded[paddedLength - 7] = (length >> 5) & 0xff;
  padded[paddedLength - 6] = (length >> 13) & 0xff;
  padded[paddedLength - 5] = (length >> 21) & 0xff;
  padded[paddedLength - 4] = (length >>> 29) & 0xff;

  let h0 = 1732584193, h1 = -271733879, h2 = -1732584194, h3 = 271733878;
  const w = new Int32Array(16);

  for (let i = 0; i < paddedLength;) {
    for (let j = 0; j < 16; j++, i += 4) {
      w[j] = padded[i] | (padded[i + 1] << 8) | (padded[i + 2] << 16) | (padded[i + 3] << 24);
    }
    let a = h0, b = h1, c = h2, d = h3;
    for (let j = 0; j < 64; j++) {
      let f = 0, g = 0;
      if (j < 16) { f = (b & c) | (~b & d); g = j; }
      else if (j < 32) { f = (d & b) | (~d & c); g = (5 * j + 1) & 15; }
      else if (j < 48) { f = b ^ c ^ d; g = (3 * j + 5) & 15; }
      else { f = c ^ (b | ~d); g = (7 * j) & 15; }
      const tmp = d;
      const rotateArg = (a + f + k[j] + w[g]) | 0;
      const rotate = r[j];
      d = c;
      c = b;
      b = (b + ((rotateArg << rotate) | (rotateArg >>> (32 - rotate)))) | 0;
      a = tmp;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
  }
  return new Uint8Array([
    h0 & 0xff, (h0 >> 8) & 0xff, (h0 >> 16) & 0xff, (h0 >>> 24) & 0xff,
    h1 & 0xff, (h1 >> 8) & 0xff, (h1 >> 16) & 0xff, (h1 >>> 24) & 0xff,
    h2 & 0xff, (h2 >> 8) & 0xff, (h2 >> 16) & 0xff, (h2 >>> 24) & 0xff,
    h3 & 0xff, (h3 >> 8) & 0xff, (h3 >> 16) & 0xff, (h3 >>> 24) & 0xff
  ]);
}

/**
 * Pure-JavaScript ARCFour (RC4) stream cipher
 */
export function arcfourCipher(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    const tmp = s[i]; s[i] = s[j]; s[j] = tmp;
  }
  let a = 0, b = 0;
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    a = (a + 1) & 0xff;
    b = (b + s[a]) & 0xff;
    const tmp = s[a]; s[a] = s[b]; s[b] = tmp;
    out[i] = data[i] ^ s[(tmp + s[a]) & 0xff];
  }
  return out;
}

export function padOrTruncatePassword(pwd?: string): Uint8Array {
  const buf = new Uint8Array(32);
  const latin = pwd || '';
  const copyLen = Math.min(latin.length, 32);
  for (let i = 0; i < copyLen; i++) {
    buf[i] = latin.charCodeAt(i) & 0xff;
  }
  if (copyLen < 32) {
    for (let i = 0; i < 32 - copyLen; i++) {
      buf[copyLen + i] = PADDING[i];
    }
  }
  return buf;
}

export function computeP(permissions: SecurityOptions['permissions'] = {}): number {
  // ISO 32000-1 Section 7.6.3.2 Table 22
  // Bits 1-2 must be 0, bits 7-8 and 13-32 must be 1.
  let p = -4; // 1111...11111100 (all allowed)

  if (permissions.printing === 'none') {
    p &= ~4; // clear bit 3
    p &= ~2048; // clear bit 12 (high-res print)
  } else if (permissions.printing === 'lowResolution') {
    p &= ~2048; // clear bit 12
  }

  if (permissions.modifying === false) {
    p &= ~8; // clear bit 4 (modify contents)
    p &= ~32; // clear bit 6 (modify annotations)
    p &= ~1024; // clear bit 11 (assemble)
  }

  if (permissions.copying === false) {
    p &= ~16; // clear bit 5 (copy content)
    p &= ~512; // clear bit 10 (accessibility extraction)
  }

  if (permissions.annotating === false) {
    p &= ~32; // clear bit 6 (annotations)
  }

  if (permissions.fillingForms === false) {
    p &= ~256; // clear bit 9 (fill form fields)
  }

  return p;
}

export function computeO(userPassword?: string, ownerPassword?: string, keyLength: number = 16): Uint8Array {
  const effectiveOwner = ownerPassword || userPassword || '';
  const ownerPad = padOrTruncatePassword(effectiveOwner);
  let hash = calculateMD5(ownerPad);
  for (let i = 0; i < 50; i++) {
    hash = calculateMD5(hash.subarray(0, keyLength));
  }
  const key = hash.subarray(0, keyLength);
  let userPad = padOrTruncatePassword(userPassword);
  userPad = arcfourCipher(key, userPad);
  for (let i = 1; i <= 19; i++) {
    const derivedKey = new Uint8Array(keyLength);
    for (let k = 0; k < keyLength; k++) {
      derivedKey[k] = key[k] ^ i;
    }
    userPad = arcfourCipher(derivedKey, userPad);
  }
  return userPad; // 32 bytes
}

export function computeFileEncryptionKey(
  userPassword: string | undefined,
  O: Uint8Array,
  P: number,
  fileId: Uint8Array,
  keyLength: number = 16
): Uint8Array {
  const userPad = padOrTruncatePassword(userPassword);
  const pBuf = new Uint8Array(4);
  pBuf[0] = P & 0xff;
  pBuf[1] = (P >> 8) & 0xff;
  pBuf[2] = (P >> 16) & 0xff;
  pBuf[3] = (P >>> 24) & 0xff;

  const combined = new Uint8Array(userPad.length + O.length + 4 + fileId.length);
  combined.set(userPad, 0);
  combined.set(O, userPad.length);
  combined.set(pBuf, userPad.length + O.length);
  combined.set(fileId, userPad.length + O.length + 4);

  let hash = calculateMD5(combined);
  for (let i = 0; i < 50; i++) {
    hash = calculateMD5(hash.subarray(0, keyLength));
  }
  return hash.subarray(0, keyLength);
}

export function computeU(fileKey: Uint8Array, fileId: Uint8Array, keyLength: number = 16): Uint8Array {
  const hashData = new Uint8Array(PADDING.length + fileId.length);
  hashData.set(PADDING, 0);
  hashData.set(fileId, PADDING.length);

  const hash = calculateMD5(hashData);
  let u = arcfourCipher(fileKey, hash);
  for (let i = 1; i <= 19; i++) {
    const derivedKey = new Uint8Array(keyLength);
    for (let k = 0; k < keyLength; k++) {
      derivedKey[k] = fileKey[k] ^ i;
    }
    u = arcfourCipher(derivedKey, u);
  }
  // Revision 3 /U is 32 bytes: 16 bytes computed hash + 16 arbitrary bytes padding
  const out = new Uint8Array(32);
  out.set(u, 0);
  return out;
}

export function computeObjectKey(fileKey: Uint8Array, objNum: number, genNum: number): Uint8Array {
  const buf = new Uint8Array(fileKey.length + 5);
  buf.set(fileKey, 0);
  let i = fileKey.length;
  buf[i++] = objNum & 0xff;
  buf[i++] = (objNum >> 8) & 0xff;
  buf[i++] = (objNum >> 16) & 0xff;
  buf[i++] = genNum & 0xff;
  buf[i++] = (genNum >> 8) & 0xff;

  const hash = calculateMD5(buf);
  return hash.subarray(0, Math.min(fileKey.length + 5, 16));
}

/**
 * Check if a PDF file buffer has an /Encrypt dictionary in trailer or catalog
 */
export function isPdfEncrypted(pdfBytes: Uint8Array): boolean {
  const len = pdfBytes.length;
  const scanLen = Math.min(len, 8192);
  const tailBytes = pdfBytes.subarray(len - scanLen);
  const tailStr = new TextDecoder('latin1').decode(tailBytes);
  if (/\/Encrypt\s+\d+\s+\d+\s+R|\/Encrypt\s*<</i.test(tailStr)) {
    return true;
  }
  const headBytes = pdfBytes.subarray(0, Math.min(len, 4096));
  const headStr = new TextDecoder('latin1').decode(headBytes);
  return /\/Encrypt\s+\d+\s+\d+\s+R|\/Encrypt\s*<</i.test(headStr);
}

/**
 * Convert a Uint8Array into a lowercase hex string
 */
function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i].toString(16);
    hex += b.length === 1 ? '0' + b : b;
  }
  return hex;
}

/**
 * Generate 16 random bytes using crypto API
 */
function generateRandomBytes(length: number = 16): Uint8Array {
  const buf = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < length; i++) {
      buf[i] = Math.floor(Math.random() * 256);
    }
  }
  return buf;
}

/**
 * Encrypt a PDFDocument in-place according to ISO 32000-1 Standard Security Handler (Revision 3 / 128-bit)
 */
export function encryptPdfDocument(doc: PDFDocument, options: SecurityOptions): void {
  const userPassword = options.userPassword || '';
  const ownerPassword = options.ownerPassword || userPassword;
  if (!userPassword && !ownerPassword) return;

  const keyLength = 16; // 128-bit
  const fileId = generateRandomBytes(16);
  const P = computeP(options.permissions);

  const O = computeO(userPassword, ownerPassword, keyLength);
  const fileKey = computeFileEncryptionKey(userPassword, O, P, fileId, keyLength);
  const U = computeU(fileKey, fileId, keyLength);

  const encryptRef = doc.context.nextRef();
  const encryptDict = doc.context.obj({
    Filter: 'Standard',
    V: 2,
    R: 3,
    Length: 128,
    P: P,
    O: PDFHexString.of(toHex(O)),
    U: PDFHexString.of(toHex(U)),
  });
  doc.context.assign(encryptRef, encryptDict);

  // Encrypt streams in indirect objects (except encryptDict itself)
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (ref.objectNumber === encryptRef.objectNumber) continue;
    const objKey = computeObjectKey(fileKey, ref.objectNumber, ref.generationNumber);
    if (typeof (obj as any).getContents === 'function') {
      const encoded = (obj as any).getContents();
      const encrypted = arcfourCipher(objKey, encoded);
      const rawStream = PDFRawStream.of((obj as any).dict, encrypted);
      doc.context.assign(ref, rawStream);
    }
  }

  const fileIdHex = toHex(fileId);
  (doc.context.trailerInfo as any).Encrypt = encryptRef;
  (doc.context.trailerInfo as any).ID = doc.context.obj([
    PDFHexString.of(fileIdHex),
    PDFHexString.of(fileIdHex),
  ]);
}
