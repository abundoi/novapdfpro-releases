import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function renderBrandPixels(size) {
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const nx = x / size;
      const ny = y / size;

      // Rounded-square badge mask
      const margin = 0.06;
      const radius = 0.22;
      const dx = Math.max(0, Math.max(margin + radius - nx, nx - (1 - margin - radius)));
      const dy = Math.max(0, Math.max(margin + radius - ny, ny - (1 - margin - radius)));
      const dist = Math.hypot(dx, dy);
      if (
        nx < margin ||
        nx >= 1 - margin ||
        ny < margin ||
        ny >= 1 - margin ||
        dist > radius
      ) {
        buf[idx] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
        continue;
      }

      // Rich sky-to-indigo gradient background
      const r = Math.round(14 + (1 - ny) * 20 + nx * 18);
      const g = Math.round(116 + (1 - ny) * 48);
      const b = Math.round(215 + nx * 35);
      let outR = r;
      let outG = g;
      let outB = b;

      // White folded document card in center
      const inDoc = nx >= 0.25 && nx <= 0.75 && ny >= 0.18 && ny <= 0.82;
      const inFoldCut = nx >= 0.57 && ny <= 0.36 && (nx - 0.57) + (0.36 - ny) >= 0.18;
      const inFoldCrease = nx >= 0.57 && nx <= 0.75 && ny >= 0.18 && ny <= 0.36 && !inFoldCut;

      if (inDoc && !inFoldCut) {
        if (inFoldCrease) {
          outR = 203;
          outG = 213;
          outB = 225;
        } else {
          // Accent lines inside document
          const l1 = ny >= 0.42 && ny <= 0.47 && nx >= 0.34 && nx <= 0.66;
          const l2 = ny >= 0.53 && ny <= 0.58 && nx >= 0.34 && nx <= 0.66;
          const l3 = ny >= 0.64 && ny <= 0.69 && nx >= 0.34 && nx <= 0.55;
          if (l1 || l2 || l3) {
            outR = 14;
            outG = 165;
            outB = 233;
          } else {
            outR = 248;
            outG = 250;
            outB = 252;
          }
        }
      }

      buf[idx] = outR;
      buf[idx + 1] = outG;
      buf[idx + 2] = outB;
      buf[idx + 3] = 255;
    }
  }
  return buf;
}

function encodePngRgba(width, height, rgba) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  const crc32 = (b) => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) {
      c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // RGBA
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  const rawRows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    rawRows[rowStart] = 0; // None filter
    rgba.copy(rawRows, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(rawRows, { level: 9 });

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeBmpEntry(size, rgba) {
  const bmpHeaderSize = 40;
  const pixelDataSize = size * size * 4;
  const maskRowBytes = Math.ceil(size / 32) * 4;
  const maskSize = maskRowBytes * size;
  const out = Buffer.alloc(bmpHeaderSize + pixelDataSize + maskSize);

  out.writeUInt32LE(bmpHeaderSize, 0);
  out.writeInt32LE(size, 4);
  out.writeInt32LE(size * 2, 8);
  out.writeUInt16LE(1, 12);
  out.writeUInt16LE(32, 14);
  out.writeUInt32LE(0, 16);
  out.writeUInt32LE(pixelDataSize + maskSize, 20);

  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const srcIdx = (srcY * size + x) * 4;
      const dstIdx = bmpHeaderSize + (y * size + x) * 4;
      out[dstIdx] = rgba[srcIdx + 2]; // B
      out[dstIdx + 1] = rgba[srcIdx + 1]; // G
      out[dstIdx + 2] = rgba[srcIdx]; // R
      out[dstIdx + 3] = rgba[srcIdx + 3]; // A
    }
  }
  return out;
}

function createMultiResIcoFile(outputPath) {
  const sizes = [16, 32, 48, 256];
  const entries = sizes.map((sz) => {
    const rgba = renderBrandPixels(sz);
    const data = sz >= 256 ? encodePngRgba(sz, sz, rgba) : encodeBmpEntry(sz, rgba);
    return { size: sz, data };
  });

  const headerSize = 6 + 16 * entries.length;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  let offset = headerSize;
  entries.forEach((entry, idx) => {
    const base = 6 + idx * 16;
    header.writeUInt8(entry.size >= 256 ? 0 : entry.size, base);
    header.writeUInt8(entry.size >= 256 ? 0 : entry.size, base + 1);
    header.writeUInt8(0, base + 2);
    header.writeUInt8(0, base + 3);
    header.writeUInt16LE(1, base + 4);
    header.writeUInt16LE(32, base + 6);
    header.writeUInt32LE(entry.data.length, base + 8);
    header.writeUInt32LE(offset, base + 12);
    offset += entry.data.length;
  });

  const full = Buffer.concat([header, ...entries.map((e) => e.data)]);
  fs.writeFileSync(outputPath, full);
  console.log(`Generated icon at: ${outputPath}`);
}

const target = path.resolve(import.meta.dirname, 'NovaPDFPro.ico');
createMultiResIcoFile(target);
