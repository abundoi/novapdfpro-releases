import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { pdfEngine } from './pdfEngine';

export type ImagePageFit = 'a4' | 'letter' | 'original';

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitize UTF-8 text into WinAnsi-safe characters so StandardFonts.Helvetica never throws.
 */
function sanitizeWinAnsiText(input: string): string {
  const replaced = input
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, '    ')
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014]/g, '--')
    .replace(/\u2026/g, '...')
    .replace(/[\u2022\u25CF\u25AA]/g, '*')
    .replace(/[\u2713\u2714]/g, '[OK]')
    .replace(/\u00A0/g, ' ');

  let out = '';
  for (let i = 0; i < replaced.length; i++) {
    const code = replaced.charCodeAt(i);
    if (code === 10 || (code >= 32 && code <= 126) || (code >= 160 && code <= 255)) {
      out += replaced[i];
    } else {
      out += '?';
    }
  }
  return out;
}

/**
 * Group pdf.js textContent items by baseline Y coordinate to reconstruct clean lines.
 */
function extractLinesFromTextContent(items: Array<any>): string[] {
  const positioned: Array<{ str: string; x: number; y: number }> = [];
  for (const item of items) {
    if ('str' in item && item.str.length > 0) {
      const tx = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
      positioned.push({
        str: item.str,
        x: Number(tx[4]) || 0,
        y: Number(tx[5]) || 0,
      });
    }
  }

  if (positioned.length === 0) return [];

  // Sort top-to-bottom (higher PDF Y first), then left-to-right
  positioned.sort((a, b) => {
    if (Math.abs(b.y - a.y) > 3) return b.y - a.y;
    return a.x - b.x;
  });

  const lines: string[] = [];
  let currentLineY = positioned[0].y;
  let currentTokens: string[] = [];

  for (const token of positioned) {
    if (Math.abs(token.y - currentLineY) > 3) {
      const joined = currentTokens.join(' ').replace(/\s+/g, ' ').trim();
      if (joined) lines.push(joined);
      currentLineY = token.y;
      currentTokens = [token.str];
    } else {
      currentTokens.push(token.str);
    }
  }

  const lastLine = currentTokens.join(' ').replace(/\s+/g, ' ').trim();
  if (lastLine) lines.push(lastLine);

  return lines;
}

/**
 * Convert any browser-supported image dataUrl into clean PNG bytes via canvas when needed.
 */
async function normalizeImageToPngBytes(dataUrl: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, img.naturalWidth || 1);
      canvas.height = Math.max(1, img.naturalHeight || 1);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to create image normalization canvas'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to encode image as PNG'));
          return;
        }
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('Unable to decode uploaded image file'));
    img.src = dataUrl;
  });
}

export class DocumentConverterService {
  /**
   * Convert PDF pages into high-resolution image data URLs and blobs (PNG or JPEG)
   */
  public async pdfToImages(
    pdfBytes: Uint8Array,
    format: 'png' | 'jpeg' = 'png',
    dpiScale: number = 2.0,
    pageNumbers?: number[]
  ): Promise<Array<{ pageNumber: number; dataUrl: string; blob: Blob }>> {
    const pdfDoc = await pdfEngine.loadPdfJsDocument(pdfBytes);
    const results: Array<{ pageNumber: number; dataUrl: string; blob: Blob }> = [];
    const targetPages =
      pageNumbers && pageNumbers.length > 0
        ? pageNumbers.filter((p) => p >= 1 && p <= pdfDoc.numPages)
        : Array.from({ length: pdfDoc.numPages }, (_, idx) => idx + 1);

    for (const pageNum of targetPages) {
      const canvas = document.createElement('canvas');
      await pdfEngine.renderPageToCanvas(pdfDoc, pageNum, canvas, dpiScale);

      const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const dataUrl = canvas.toDataURL(mime, 0.95);

      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b || new Blob()), mime, 0.95);
      });

      results.push({ pageNumber: pageNum, dataUrl, blob });
    }

    return results;
  }

  /**
   * Extract structured line-preserved plain text from PDF pages
   */
  public async pdfToText(pdfBytes: Uint8Array, pageNumbers?: number[]): Promise<string> {
    const pdfDoc = await pdfEngine.loadPdfJsDocument(pdfBytes);
    const targetPages =
      pageNumbers && pageNumbers.length > 0
        ? pageNumbers.filter((p) => p >= 1 && p <= pdfDoc.numPages)
        : Array.from({ length: pdfDoc.numPages }, (_, idx) => idx + 1);

    const chunks: string[] = [];

    for (const pageNum of targetPages) {
      const page = await pdfDoc.getPage(pageNum);
      const content = await page.getTextContent();
      const lines = extractLinesFromTextContent(content.items);
      const body = lines.length > 0 ? lines.join('\n') : '[No extractable text on this page]';
      chunks.push(`--- Page ${pageNum} of ${pdfDoc.numPages} ---\n${body}`);
    }

    return chunks.join('\n\n') + '\n';
  }

  /**
   * Convert PDF to clean, XSS-safe structured HTML
   */
  public async pdfToHtml(
    pdfBytes: Uint8Array,
    title: string = 'Converted PDF Document',
    pageNumbers?: number[]
  ): Promise<string> {
    const pdfDoc = await pdfEngine.loadPdfJsDocument(pdfBytes);
    const targetPages =
      pageNumbers && pageNumbers.length > 0
        ? pageNumbers.filter((p) => p >= 1 && p <= pdfDoc.numPages)
        : Array.from({ length: pdfDoc.numPages }, (_, idx) => idx + 1);

    const safeTitle = escapeHtml(title);
    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${safeTitle}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 40px; background: #f1f5f9; color: #0f172a; }
    .page-container { background: #ffffff; padding: 40px 48px; margin: 0 auto 28px; box-shadow: 0 4px 12px rgba(15,23,42,0.08); border-radius: 8px; max-width: 820px; }
    .page-header { font-size: 12px; color: #64748b; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 18px; font-weight: 600; display: flex; justify-content: space-between; }
    p { line-height: 1.6; margin: 0 0 8px; white-space: pre-wrap; }
    .empty { color: #94a3b8; font-style: italic; }
  </style>
</head>
<body>\n`;

    for (const pageNum of targetPages) {
      const page = await pdfDoc.getPage(pageNum);
      const content = await page.getTextContent();
      const lines = extractLinesFromTextContent(content.items);

      html += `  <section class="page-container">\n`;
      html += `    <div class="page-header"><span>${safeTitle}</span><span>Page ${pageNum} of ${pdfDoc.numPages}</span></div>\n`;
      if (lines.length === 0) {
        html += `    <p class="empty">[No extractable text on this page]</p>\n`;
      } else {
        for (const line of lines) {
          html += `    <p>${escapeHtml(line)}</p>\n`;
        }
      }
      html += `  </section>\n`;
    }

    html += `</body>\n</html>`;
    return html;
  }

  /**
   * Convert multiple image files to a single PDF with configurable page sizing
   */
  public async imagesToPdf(
    images: Array<{ dataUrl: string; format: 'png' | 'jpeg' | 'auto'; name: string }>,
    pageFit: ImagePageFit = 'a4'
  ): Promise<Uint8Array> {
    if (!images || images.length === 0) {
      throw new Error('Select at least one image file to convert.');
    }

    const doc = await PDFDocument.create();

    for (const img of images) {
      const base64Data = img.dataUrl.split(',')[1];
      if (!base64Data) {
        throw new Error(`Invalid image payload for "${img.name}"`);
      }

      let embedded;
      try {
        const bytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
        if (img.format === 'png' || img.dataUrl.startsWith('data:image/png')) {
          embedded = await doc.embedPng(bytes);
        } else if (
          img.format === 'jpeg' ||
          img.dataUrl.startsWith('data:image/jpeg') ||
          img.dataUrl.startsWith('data:image/jpg')
        ) {
          embedded = await doc.embedJpg(bytes);
        } else {
          const normalizedPng = await normalizeImageToPngBytes(img.dataUrl);
          embedded = await doc.embedPng(normalizedPng);
        }
      } catch {
        // Fallback: normalize mismatched extension/MIME (e.g. WEBP/BMP/renamed file) into PNG
        const normalizedPng = await normalizeImageToPngBytes(img.dataUrl);
        embedded = await doc.embedPng(normalizedPng);
      }

      const { width: imgW, height: imgH } = embedded.scale(1);

      if (pageFit === 'original') {
        const page = doc.addPage([Math.max(1, imgW), Math.max(1, imgH)]);
        page.drawImage(embedded, { x: 0, y: 0, width: imgW, height: imgH });
      } else {
        const targetSize: [number, number] =
          pageFit === 'letter' ? [612.0, 792.0] : [595.28, 841.89];
        const margin = 24;
        const maxW = targetSize[0] - margin * 2;
        const maxH = targetSize[1] - margin * 2;
        const scale = Math.min(maxW / imgW, maxH / imgH, 1);
        const drawW = imgW * scale;
        const drawH = imgH * scale;
        const page = doc.addPage(targetSize);
        page.drawImage(embedded, {
          x: (targetSize[0] - drawW) / 2,
          y: (targetSize[1] - drawH) / 2,
          width: drawW,
          height: drawH,
        });
      }
    }

    return await doc.save();
  }

  /**
   * Convert plain text content into a clean, WinAnsi-safe, paginated PDF
   */
  public async textToPdf(text: string, title?: string): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

    const pageSize: [number, number] = [595.28, 841.89]; // A4
    const margin = 50;
    const fontSize = 11;
    const lineHeight = 16;
    const usableWidth = pageSize[0] - margin * 2;

    const cleanBody = sanitizeWinAnsiText(text || '');
    const lines = cleanBody.split('\n');
    let page = doc.addPage(pageSize);
    let currentY = pageSize[1] - margin;

    const advancePage = () => {
      page = doc.addPage(pageSize);
      currentY = pageSize[1] - margin;
    };

    const drawWrappedToken = (token: string) => {
      let segment = '';
      for (let i = 0; i < token.length; i++) {
        const next = segment + token[i];
        if (font.widthOfTextAtSize(next, fontSize) > usableWidth && segment) {
          if (currentY - lineHeight < margin) advancePage();
          page.drawText(segment, {
            x: margin,
            y: currentY,
            size: fontSize,
            font,
            color: rgb(0.1, 0.1, 0.1),
          });
          currentY -= lineHeight;
          segment = token[i];
        } else {
          segment = next;
        }
      }
      return segment;
    };

    if (title && title.trim()) {
      const safeTitle = sanitizeWinAnsiText(title.trim());
      page.drawText(safeTitle, {
        x: margin,
        y: currentY,
        size: 16,
        font: fontBold,
        color: rgb(0.05, 0.45, 0.8),
      });
      currentY -= 28;
    }

    for (const rawLine of lines) {
      if (rawLine.trim() === '') {
        currentY -= lineHeight * 0.75;
        if (currentY < margin) advancePage();
        continue;
      }

      const words = rawLine.split(' ');
      let currentLine = '';

      for (const word of words) {
        // Handle single oversized token (e.g. long URL) cleanly without overflowing right margin
        if (font.widthOfTextAtSize(word, fontSize) > usableWidth) {
          if (currentLine) {
            if (currentY - lineHeight < margin) advancePage();
            page.drawText(currentLine, {
              x: margin,
              y: currentY,
              size: fontSize,
              font,
              color: rgb(0.1, 0.1, 0.1),
            });
            currentY -= lineHeight;
            currentLine = '';
          }
          currentLine = drawWrappedToken(word);
          continue;
        }

        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (font.widthOfTextAtSize(testLine, fontSize) > usableWidth && currentLine) {
          if (currentY - lineHeight < margin) advancePage();
          page.drawText(currentLine, {
            x: margin,
            y: currentY,
            size: fontSize,
            font,
            color: rgb(0.1, 0.1, 0.1),
          });
          currentY -= lineHeight;
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }

      if (currentLine) {
        if (currentY - lineHeight < margin) advancePage();
        page.drawText(currentLine, {
          x: margin,
          y: currentY,
          size: fontSize,
          font,
          color: rgb(0.1, 0.1, 0.1),
        });
        currentY -= lineHeight;
      }
    }

    return await doc.save();
  }
}

export const converterService = new DocumentConverterService();
