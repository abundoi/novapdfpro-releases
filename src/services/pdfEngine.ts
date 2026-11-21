import {
  PDFDocument,
  rgb,
  StandardFonts,
  degrees,
  PDFPage,
  PDFForm,
  LineCapStyle,
  PDFString,
} from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import type {
  AnnotationItem,
  TextItem,
  ImageItem,
  FormFieldItem,
  PDFPageMeta,
  Rect,
} from '../types/index.ts';
import { encryptPdfDocument, isPdfEncrypted, type SecurityOptions } from './pdfCrypto.ts';

export type { SecurityOptions };
export { isPdfEncrypted, encryptPdfDocument };

// Set up local worker URL for PDF.js to ensure 100% offline functionality
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.js';
}

export interface RenderPageResult {
  viewportWidth: number;
  viewportHeight: number;
  scale: number;
  textItems: Array<{
    str: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontName: string;
    fontSize: number;
  }>;
}

export interface HeaderFooterOptions {
  headerLeft?: string;
  headerCenter?: string;
  headerRight?: string;
  footerLeft?: string;
  footerCenter?: string; // e.g. "Page {page} of {total}"
  footerRight?: string;
  fontSize?: number;
  colorHex?: string;
  excludeFirstPage?: boolean;
}

export interface WatermarkOptions {
  text: string;
  fontSize?: number;
  opacity?: number;
  rotationDegrees?: number;
  colorHex?: string;
  excludeFirstPage?: boolean;
}

export class PDFEngineService {
  private activeRenderTask: any = null;
  private activeRenderSeq = 0;

  /**
   * Parse hex color into pdf-lib RGB (0..1)
   */
  private hexToRgb(hex: string) {
    let clean = hex.replace('#', '');
    if (clean.length === 3) {
      clean = clean.split('').map((c) => c + c).join('');
    }
    const num = parseInt(clean, 16);
    return rgb(
      ((num >> 16) & 255) / 255,
      ((num >> 8) & 255) / 255,
      (num & 255) / 255
    );
  }

  /**
   * Load PDF into pdfjs-dist for high-res viewport rendering & text extraction
   */
  public async loadPdfJsDocument(
    pdfBytes: Uint8Array,
    password?: string
  ): Promise<pdfjsLib.PDFDocumentProxy> {
    // Clone bytes into independent memory to prevent Web Worker postMessage from detaching original buffer
    const clonedData = new Uint8Array(pdfBytes.byteLength);
    clonedData.set(pdfBytes);

    const loadingTask = pdfjsLib.getDocument({
      data: clonedData,
      password: password || undefined,
      cMapUrl: './cmaps/',
      cMapPacked: true,
      standardFontDataUrl: './standard_fonts/',
      isEvalSupported: false,
    });

    return new Promise<pdfjsLib.PDFDocumentProxy>((resolve, reject) => {
      loadingTask.onPassword = (callback: any, reason: any) => {
        // PDF.js PasswordResponses: 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD
        const err = new Error(
          reason === 2
            ? 'Incorrect password. Access denied.'
            : 'Password required to access secured document.'
        );
        (err as any).name = 'PasswordException';
        (err as any).code = reason;
        // Abort the internal loop so it doesn't hang indefinitely
        callback(new Error('Password challenged'));
        reject(err);
      };

      loadingTask.promise.then(resolve).catch(reject);
    });
  }

  /**
   * Check if a PDF file buffer has encryption metadata
   */
  public isPdfEncrypted(pdfBytes: Uint8Array): boolean {
    return isPdfEncrypted(pdfBytes);
  }

  /**
   * Render a page to an HTML5 Canvas with exact scaling & extract text items
   */
  public async renderPageToCanvas(
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale: number = 1.5
  ): Promise<RenderPageResult> {
    const seq = ++this.activeRenderSeq;

    if (this.activeRenderTask) {
      const prevTask = this.activeRenderTask;
      try {
        prevTask.cancel();
        await prevTask.promise.catch(() => {});
      } catch {
        // Ignore cancellation errors
      }
      if (this.activeRenderTask === prevTask) {
        this.activeRenderTask = null;
      }
    }

    if (seq !== this.activeRenderSeq) {
      return { viewportWidth: canvas.width, viewportHeight: canvas.height, scale, textItems: [] };
    }

    const page = await pdfDoc.getPage(pageNumber);
    if (seq !== this.activeRenderSeq) {
      return { viewportWidth: canvas.width, viewportHeight: canvas.height, scale, textItems: [] };
    }

    const viewport = page.getViewport({ scale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not get canvas 2D context');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const renderContext = {
      canvasContext: ctx,
      viewport: viewport,
    };

    const renderTask = page.render(renderContext);
    this.activeRenderTask = renderTask;
    await renderTask.promise;
    if (this.activeRenderTask === renderTask) {
      this.activeRenderTask = null;
    }

    // Extract text layer items for genuine text editing selection
    const textContent = await page.getTextContent();
    const textItems: RenderPageResult['textItems'] = [];

    for (const item of textContent.items) {
      if ('str' in item && item.str.trim()) {
        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const fontHeight = Math.hypot(tx[2], tx[3]);
        textItems.push({
          str: item.str,
          x: tx[4],
          y: tx[5] - fontHeight,
          width: item.width * scale,
          height: fontHeight,
          fontName: item.fontName,
          fontSize: fontHeight,
        });
      }
    }

    return {
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      scale,
      textItems,
    };
  }

  /**
   * Get metadata and page dimensions of a PDF
   */
  public async getDocumentInfo(pdfBytes: Uint8Array): Promise<{
    pageCount: number;
    pages: PDFPageMeta[];
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
  }> {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const pageCount = doc.getPageCount();
    const pages: PDFPageMeta[] = [];

    for (let i = 0; i < pageCount; i++) {
      const page = doc.getPage(i);
      const { width, height } = page.getSize();
      pages.push({
        pageNumber: i + 1,
        width,
        height,
        rotation: page.getRotation().angle,
      });
    }

    return {
      pageCount,
      pages,
      title: doc.getTitle(),
      author: doc.getAuthor(),
      subject: doc.getSubject(),
      creator: doc.getCreator(),
    };
  }

  /**
   * Create a clean new blank PDF document
   */
  public async createBlankDocument(
    pageSize: 'A4' | 'Letter' = 'A4',
    pageCount: number = 1
  ): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const size = pageSize === 'A4' ? [595.28, 841.89] : [612.0, 792.0];

    for (let i = 0; i < pageCount; i++) {
      doc.addPage(size as [number, number]);
    }

    return await doc.save();
  }

  /**
   * Layout paragraph text into wrapped lines according to maximum width and font metrics
   */
  public layoutParagraphLines(
    text: string,
    font: any,
    fontSize: number,
    maxWidth?: number
  ): string[] {
    const rawParagraphs = (text || '').split(/\r?\n/);
    if (!maxWidth || maxWidth <= 0) {
      return rawParagraphs;
    }

    const resultLines: string[] = [];

    for (const paragraph of rawParagraphs) {
      if (paragraph.trim() === '') {
        resultLines.push('');
        continue;
      }

      const words = paragraph.split(' ');
      let currentLine = '';

      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        if (!word) {
          currentLine = currentLine ? `${currentLine} ` : '';
          continue;
        }

        const candidate = currentLine ? `${currentLine} ${word}` : word;
        const candidateWidth = font.widthOfTextAtSize(candidate, fontSize);

        if (candidateWidth <= maxWidth || !currentLine) {
          currentLine = candidate;
        } else {
          resultLines.push(currentLine);
          currentLine = word;
        }
      }

      if (currentLine) {
        resultLines.push(currentLine);
      }
    }

    return resultLines.length > 0 ? resultLines : [''];
  }

  /**
   * Apply all edits, annotations, text modifications, images, and form elements onto the PDF bytes
   */
  public async applyModifications(
    sourcePdfBytes: Uint8Array,
    options: {
      textItems?: TextItem[];
      imageItems?: ImageItem[];
      annotations?: AnnotationItem[];
      formFields?: FormFieldItem[];
      watermark?: WatermarkOptions;
      headerFooter?: HeaderFooterOptions;
      metadata?: {
        title?: string;
        author?: string;
        subject?: string;
        keywords?: string[];
      };
      security?: SecurityOptions;
    }
  ): Promise<Uint8Array> {
    const doc = await PDFDocument.load(sourcePdfBytes, { ignoreEncryption: true });

    // Embed standard fonts (on-demand cache for all bold/italic combinations)
    const fontCache = new Map<StandardFonts, Awaited<ReturnType<typeof doc.embedFont>>>();
    const getEmbeddedFont = async (fontName: StandardFonts) => {
      let cached = fontCache.get(fontName);
      if (!cached) {
        cached = await doc.embedFont(fontName);
        fontCache.set(fontName, cached);
      }
      return cached;
    };

    const fontHelvetica = await getEmbeddedFont(StandardFonts.Helvetica);
    const fontHelveticaBold = await getEmbeddedFont(StandardFonts.HelveticaBold);
    const fontCourier = await getEmbeddedFont(StandardFonts.Courier);

    const getFont = async (family: string, isBold?: boolean, isItalic?: boolean) => {
      if (family === 'TimesRoman') {
        if (isBold && isItalic) return getEmbeddedFont(StandardFonts.TimesRomanBoldItalic);
        if (isBold) return getEmbeddedFont(StandardFonts.TimesRomanBold);
        if (isItalic) return getEmbeddedFont(StandardFonts.TimesRomanItalic);
        return getEmbeddedFont(StandardFonts.TimesRoman);
      }
      if (family === 'Courier') {
        if (isBold && isItalic) return getEmbeddedFont(StandardFonts.CourierBoldOblique);
        if (isBold) return getEmbeddedFont(StandardFonts.CourierBold);
        if (isItalic) return getEmbeddedFont(StandardFonts.CourierOblique);
        return fontCourier;
      }
      if (isBold && isItalic) return getEmbeddedFont(StandardFonts.HelveticaBoldOblique);
      if (isBold) return fontHelveticaBold;
      if (isItalic) return getEmbeddedFont(StandardFonts.HelveticaOblique);
      return fontHelvetica;
    };

    /**
     * Map top-left viewport coordinates (matching PDF.js unscaled viewport & overlay DOM)
     * directly into PDF user-space coordinates, accounting for CropBox offsets and page /Rotate.
     */
    const getPageCoordHelper = (page: PDFPage) => {
      const box = page.getCropBox();
      const normAngle = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;
      const vpWidth = normAngle === 90 || normAngle === 270 ? box.height : box.width;
      const vpHeight = normAngle === 90 || normAngle === 270 ? box.width : box.height;

      const toPdfPoint = (vx: number, vy: number): { x: number; y: number } => {
        switch (normAngle) {
          case 90:
            return { x: box.x + vy, y: box.y + vx };
          case 180:
            return { x: box.x + box.width - vx, y: box.y + vy };
          case 270:
            return { x: box.x + box.width - vy, y: box.y + box.height - vx };
          case 0:
          default:
            return { x: box.x + vx, y: box.y + box.height - vy };
        }
      };

      const toPdfBoxOrigin = (
        vx: number,
        vy: number,
        vw: number,
        vh: number,
        cwRotationDeg = 0
      ) => {
        const center = toPdfPoint(vx + vw / 2, vy + vh / 2);
        const pdfAngle = normAngle - cwRotationDeg;
        const rad = (pdfAngle * Math.PI) / 180;
        const cosA = Math.cos(rad);
        const sinA = Math.sin(rad);
        return {
          x: center.x - (vw / 2) * cosA + (vh / 2) * sinA,
          y: center.y - (vw / 2) * sinA - (vh / 2) * cosA,
          center,
          pdfAngle,
        };
      };

      const toPdfWidgetRect = (vx: number, vy: number, vw: number, vh: number) => {
        switch (normAngle) {
          case 90:
            return { x: box.x + vy, y: box.y + vx, width: vh, height: vw };
          case 180:
            return { x: box.x + box.width - vx - vw, y: box.y + vy, width: vw, height: vh };
          case 270:
            return {
              x: box.x + box.width - vy - vh,
              y: box.y + box.height - vx - vw,
              width: vh,
              height: vw,
            };
          case 0:
          default:
            return { x: box.x + vx, y: box.y + box.height - vy - vh, width: vw, height: vh };
        }
      };

      return { box, normAngle, vpWidth, vpHeight, toPdfPoint, toPdfBoxOrigin, toPdfWidgetRect };
    };

    const totalPages = doc.getPageCount();

    // 1. Process Text Modifications & Additions (with full multi-line paragraph & wrapping support)
    if (options.textItems && options.textItems.length > 0) {
      for (const textItem of options.textItems) {
        if (textItem.pageIndex >= totalPages) continue;
        const page = doc.getPage(textItem.pageIndex);
        const helper = getPageCoordHelper(page);
        const font = await getFont(textItem.fontFamily, textItem.isBold, textItem.isItalic);
        const textColor = this.hexToRgb(textItem.color || '#000000');
        const lineMultiplier = textItem.lineHeight || 1.25;
        const lineStep = textItem.fontSize * lineMultiplier;

        // Wrap lines according to paragraph width (or unconstrained if not set)
        const wrappedLines = this.layoutParagraphLines(
          textItem.text,
          font,
          textItem.fontSize,
          textItem.width
        );

        // Calculate max line width and overall paragraph dimensions
        let maxLineWidth = 0;
        const lineWidths: number[] = [];
        for (const line of wrappedLines) {
          const w = line.length > 0 ? font.widthOfTextAtSize(line, textItem.fontSize) : 0;
          lineWidths.push(w);
          if (w > maxLineWidth) maxLineWidth = w;
        }

        const effectiveWidth = Math.max(textItem.width || 0, maxLineWidth);
        const effectiveHeight = Math.max(
          textItem.height || 0,
          textItem.fontSize + (wrappedLines.length - 1) * lineStep
        );

        // If replacing existing text, perform authentic content redaction/whiteout underlay
        // covering BOTH the original bounding box AND the full rendered replacement paragraph
        if (textItem.isRedactionReplacement && textItem.boundingBox) {
          const bb = textItem.boundingBox;
          const coverX = Math.min(textItem.x, bb.x);
          const coverY = Math.min(textItem.y, bb.y);
          const coverW = Math.max(bb.x + bb.width, textItem.x + effectiveWidth) - coverX + 2;
          const coverH = Math.max(bb.y + bb.height, textItem.y + effectiveHeight) - coverY + 2;

          const whiteBox = helper.toPdfBoxOrigin(coverX, coverY - 1, coverW, coverH);
          page.drawRectangle({
            x: whiteBox.x,
            y: whiteBox.y,
            width: coverW,
            height: coverH,
            color: rgb(1, 1, 1),
            rotate: degrees(whiteBox.pdfAngle),
          });
        }

        // Draw each line with proper line height & alignment
        for (let lineIdx = 0; lineIdx < wrappedLines.length; lineIdx++) {
          const lineStr = wrappedLines[lineIdx];
          if (!lineStr) continue;

          const lineWidth = lineWidths[lineIdx] || 0;
          let alignOffset = 0;
          if (textItem.align === 'center' && effectiveWidth > lineWidth) {
            alignOffset = (effectiveWidth - lineWidth) / 2;
          } else if (textItem.align === 'right' && effectiveWidth > lineWidth) {
            alignOffset = effectiveWidth - lineWidth;
          }

          const lineVy = textItem.y + textItem.fontSize * 0.85 + lineIdx * lineStep;
          const basePdf = helper.toPdfPoint(textItem.x + alignOffset, lineVy);

          page.drawText(lineStr, {
            x: basePdf.x,
            y: basePdf.y,
            size: textItem.fontSize,
            lineHeight: textItem.fontSize,
            font,
            color: textColor,
            rotate: degrees(helper.normAngle),
          });

          if (textItem.isUnderline && lineWidth > 0) {
            const underlineVy = lineVy + Math.max(1.2, textItem.fontSize * 0.12);
            page.drawLine({
              start: helper.toPdfPoint(textItem.x + alignOffset, underlineVy),
              end: helper.toPdfPoint(textItem.x + alignOffset + lineWidth, underlineVy),
              thickness: Math.max(0.75, textItem.fontSize * 0.07),
              color: textColor,
            });
          }
        }
      }
    }

    // 2. Process Image Insertions
    if (options.imageItems && options.imageItems.length > 0) {
      for (const imgItem of options.imageItems) {
        if (imgItem.pageIndex >= totalPages) continue;
        const page = doc.getPage(imgItem.pageIndex);
        const helper = getPageCoordHelper(page);

        // Convert base64 dataUrl to bytes
        const base64Data = imgItem.dataUrl.split(',')[1];
        if (!base64Data) continue;
        const imageBytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));

        let embeddedImg;
        if (imgItem.format === 'png' || imgItem.dataUrl.includes('image/png')) {
          embeddedImg = await doc.embedPng(imageBytes);
        } else {
          embeddedImg = await doc.embedJpg(imageBytes);
        }

        // Match CSS `object-contain` centering inside (imgItem.width x imgItem.height)
        const fitScale = Math.min(
          imgItem.width / Math.max(1, embeddedImg.width),
          imgItem.height / Math.max(1, embeddedImg.height)
        );
        const drawW = embeddedImg.width * fitScale;
        const drawH = embeddedImg.height * fitScale;
        const drawVx = imgItem.x + (imgItem.width - drawW) / 2;
        const drawVy = imgItem.y + (imgItem.height - drawH) / 2;
        const imgOrigin = helper.toPdfBoxOrigin(drawVx, drawVy, drawW, drawH, imgItem.rotation || 0);

        page.drawImage(embeddedImg, {
          x: imgOrigin.x,
          y: imgOrigin.y,
          width: drawW,
          height: drawH,
          opacity: imgItem.opacity ?? 1,
          rotate: degrees(imgOrigin.pdfAngle),
        });
      }
    }

    // 3. Process Annotations, Shapes, Freehand Ink, Redactions, Stamps
    if (options.annotations && options.annotations.length > 0) {
      for (const ann of options.annotations) {
        if (ann.pageIndex >= totalPages) continue;
        const page = doc.getPage(ann.pageIndex);
        const helper = getPageCoordHelper(page);
        const color = this.hexToRgb(ann.color);
        const strokeWidth = ann.strokeWidth || 2;
        const opacity = ann.opacity ?? 1;

        switch (ann.type) {
          case 'highlight': {
            const box = helper.toPdfBoxOrigin(ann.rect.x, ann.rect.y, ann.rect.width, ann.rect.height);
            page.drawRectangle({
              x: box.x,
              y: box.y,
              width: ann.rect.width,
              height: ann.rect.height,
              color,
              opacity: ann.opacity ?? 0.35,
              rotate: degrees(box.pdfAngle),
            });
            break;
          }

          case 'underline': {
            const lineVy = ann.rect.y + ann.rect.height - strokeWidth / 2;
            page.drawLine({
              start: helper.toPdfPoint(ann.rect.x, lineVy),
              end: helper.toPdfPoint(ann.rect.x + ann.rect.width, lineVy),
              thickness: strokeWidth,
              color,
              opacity,
            });
            break;
          }

          case 'strikethrough': {
            const midVy = ann.rect.y + ann.rect.height / 2;
            page.drawLine({
              start: helper.toPdfPoint(ann.rect.x, midVy),
              end: helper.toPdfPoint(ann.rect.x + ann.rect.width, midVy),
              thickness: strokeWidth,
              color,
              opacity,
            });
            break;
          }

          case 'rectangle': {
            // Match CSS border-box stroke containment inside (width x height)
            const inset = Math.min(strokeWidth / 2, ann.rect.width / 2, ann.rect.height / 2);
            const innerW = Math.max(0.5, ann.rect.width - inset * 2);
            const innerH = Math.max(0.5, ann.rect.height - inset * 2);
            const box = helper.toPdfBoxOrigin(ann.rect.x + inset, ann.rect.y + inset, innerW, innerH);
            page.drawRectangle({
              x: box.x,
              y: box.y,
              width: innerW,
              height: innerH,
              borderColor: color,
              borderWidth: strokeWidth,
              borderOpacity: opacity,
              rotate: degrees(box.pdfAngle),
            });
            break;
          }

          case 'circle': {
            const inset = Math.min(strokeWidth / 2, ann.rect.width / 2, ann.rect.height / 2);
            const center = helper.toPdfPoint(
              ann.rect.x + ann.rect.width / 2,
              ann.rect.y + ann.rect.height / 2
            );
            const rxVp = Math.max(0.5, ann.rect.width / 2 - inset);
            const ryVp = Math.max(0.5, ann.rect.height / 2 - inset);
            const swapped = helper.normAngle === 90 || helper.normAngle === 270;
            page.drawEllipse({
              x: center.x,
              y: center.y,
              xScale: swapped ? ryVp : rxVp,
              yScale: swapped ? rxVp : ryVp,
              borderColor: color,
              borderWidth: strokeWidth,
              borderOpacity: opacity,
            });
            break;
          }

          case 'line':
          case 'arrow': {
            const p0 =
              ann.points && ann.points.length >= 2
                ? { x: ann.rect.x + ann.points[0].x, y: ann.rect.y + ann.points[0].y }
                : { x: ann.rect.x, y: ann.rect.y };
            const p1 =
              ann.points && ann.points.length >= 2
                ? { x: ann.rect.x + ann.points[1].x, y: ann.rect.y + ann.points[1].y }
                : { x: ann.rect.x + ann.rect.width, y: ann.rect.y + ann.rect.height };
            const pdfStart = helper.toPdfPoint(p0.x, p0.y);
            const pdfEnd = helper.toPdfPoint(p1.x, p1.y);

            if (ann.type === 'line') {
              page.drawLine({
                start: pdfStart,
                end: pdfEnd,
                thickness: strokeWidth,
                color,
                opacity,
                lineCap: LineCapStyle.Round,
              });
              break;
            }

            const dx = pdfEnd.x - pdfStart.x;
            const dy = pdfEnd.y - pdfStart.y;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            const headLen = Math.min(Math.max(8, strokeWidth * 3.5), Math.max(6, len * 0.6));
            const headHalfW = headLen * 0.45;
            const shaftEnd = {
              x: pdfEnd.x - ux * (headLen * 0.65),
              y: pdfEnd.y - uy * (headLen * 0.65),
            };
            page.drawLine({
              start: pdfStart,
              end: shaftEnd,
              thickness: strokeWidth,
              color,
              opacity,
              lineCap: LineCapStyle.Round,
            });
            const baseX = pdfEnd.x - ux * headLen;
            const baseY = pdfEnd.y - uy * headLen;
            const leftX = baseX - uy * headHalfW - pdfEnd.x;
            const leftY = -(baseY + ux * headHalfW - pdfEnd.y);
            const rightX = baseX + uy * headHalfW - pdfEnd.x;
            const rightY = -(baseY - ux * headHalfW - pdfEnd.y);
            page.drawSvgPath(`M 0 0 L ${leftX} ${leftY} L ${rightX} ${rightY} Z`, {
              x: pdfEnd.x,
              y: pdfEnd.y,
              color,
              opacity,
            });
            break;
          }

          case 'freehand':
            if (ann.points && ann.points.length > 1) {
              for (let i = 0; i < ann.points.length - 1; i++) {
                const p1 = ann.points[i];
                const p2 = ann.points[i + 1];
                page.drawLine({
                  start: helper.toPdfPoint(p1.x, p1.y),
                  end: helper.toPdfPoint(p2.x, p2.y),
                  thickness: strokeWidth,
                  color,
                  opacity,
                  lineCap: LineCapStyle.Round,
                });
              }
            }
            break;

          case 'redaction': {
            const box = helper.toPdfBoxOrigin(ann.rect.x, ann.rect.y, ann.rect.width, ann.rect.height);
            page.drawRectangle({
              x: box.x,
              y: box.y,
              width: ann.rect.width,
              height: ann.rect.height,
              color: rgb(0, 0, 0),
              rotate: degrees(box.pdfAngle),
            });
            const labelSize = Math.min(9, ann.rect.height * 0.7);
            const labelBaselineVy = ann.rect.y + Math.max(labelSize, ann.rect.height / 2 + labelSize * 0.35);
            const labelPt = helper.toPdfPoint(ann.rect.x + 4, labelBaselineVy);
            page.drawText('[REDACTED]', {
              x: labelPt.x,
              y: labelPt.y,
              size: labelSize,
              font: fontHelveticaBold,
              color: rgb(1, 1, 1),
              rotate: degrees(helper.normAngle),
            });
            break;
          }

          case 'stamp': {
            const stampText = (ann.stampLabel || ann.stampType || 'APPROVED').toUpperCase();
            const stampColor = ann.color ? this.hexToRgb(ann.color) : rgb(0.06, 0.72, 0.5);
            const stampOpacity = ann.opacity ?? 0.95;
            const stampStyle = ann.stampStyle || 'classic';
            const showMeta = ann.showTimestamp !== false;
            const rotDeg = ann.rotation || 0;
            const w = ann.rect.width;
            const h = ann.rect.height;
            const stampOrigin = helper.toPdfBoxOrigin(ann.rect.x, ann.rect.y, w, h, rotDeg);
            const pdfAngle = stampOrigin.pdfAngle;
            const theta = (pdfAngle * Math.PI) / 180;
            const cosA = Math.cos(theta);
            const sinA = Math.sin(theta);
            const cx = stampOrigin.center.x;
            const cy = stampOrigin.center.y;

            const toRotatedPt = (ox: number, oy: number) => ({
              x: cx + ox * cosA - oy * sinA,
              y: cy + ox * sinA + oy * cosA,
            });

            const outerOrigin = toRotatedPt(-w / 2, -h / 2);

            if (ann.certificateMeta) {
              // Transparent compact Digital Certificate seal with full Signer, Role, Reason, Timestamp & SHA-256
              page.drawRectangle({
                x: outerOrigin.x,
                y: outerOrigin.y,
                width: w,
                height: h,
                borderColor: stampColor,
                borderWidth: 1.25,
                borderOpacity: stampOpacity,
                rotate: degrees(pdfAngle),
              });

              const padX = 6;
              const availW = Math.max(40, w - padX * 2);
              const fitSize = (text: string, fontRef: typeof fontHelvetica, startSize: number) => {
                let s = startSize;
                while (s > 4.2 && fontRef.widthOfTextAtSize(text, s) > availW) {
                  s -= 0.25;
                }
                return s;
              };

              const cert = ann.certificateMeta;
              const tsDate = new Date(cert.timestampIso);
              const tsFormatted = Number.isNaN(tsDate.getTime())
                ? cert.timestampIso
                : tsDate.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
              const inkDark = rgb(0.06, 0.09, 0.16);
              const fullHash = String(cert.sha256 || '').toUpperCase();

              const lines: Array<{ text: string; fontRef: typeof fontHelvetica; colorRef: typeof inkDark; maxSz: number }> = [
                { text: 'DIGITALLY SIGNED • SHA-256', fontRef: fontHelveticaBold, colorRef: stampColor, maxSz: 6.8 },
                { text: `${cert.signerName} (${cert.signerRole})`, fontRef: fontHelveticaBold, colorRef: inkDark, maxSz: 6.6 },
                { text: `Reason: ${cert.reason}`, fontRef: fontHelvetica, colorRef: inkDark, maxSz: 6.0 },
                { text: `Time: ${tsFormatted}`, fontRef: fontCourier, colorRef: inkDark, maxSz: 5.8 },
                { text: `SHA-256: ${fullHash.slice(0, 32)}`, fontRef: fontCourier, colorRef: inkDark, maxSz: 5.4 },
                ...(fullHash.length > 32
                  ? [{ text: `         ${fullHash.slice(32)}`, fontRef: fontCourier, colorRef: inkDark, maxSz: 5.4 }]
                  : []),
              ];

              const stepY = Math.max(8, (h - 10) / lines.length);
              lines.forEach((ln, idx) => {
                const sz = fitSize(ln.text, ln.fontRef, ln.maxSz);
                const localY = h / 2 - 9 - idx * stepY;
                const pt = toRotatedPt(-w / 2 + padX, localY);
                page.drawText(ln.text, {
                  x: pt.x,
                  y: pt.y,
                  size: sz,
                  font: ln.fontRef,
                  color: ln.colorRef,
                  opacity: stampOpacity,
                  rotate: degrees(pdfAngle),
                });
              });
              break;
            }

            if (stampStyle === 'solid') {
              page.drawRectangle({
                x: outerOrigin.x,
                y: outerOrigin.y,
                width: w,
                height: h,
                color: stampColor,
                borderColor: stampColor,
                borderWidth: 1.5,
                opacity: stampOpacity,
                rotate: degrees(pdfAngle),
              });
            } else if (stampStyle === 'outline') {
              page.drawRectangle({
                x: outerOrigin.x,
                y: outerOrigin.y,
                width: w,
                height: h,
                borderColor: stampColor,
                borderWidth: 2.2,
                borderOpacity: stampOpacity,
                rotate: degrees(pdfAngle),
              });
            } else {
              // Classic double-bordered enterprise stamp with translucent white backing
              page.drawRectangle({
                x: outerOrigin.x,
                y: outerOrigin.y,
                width: w,
                height: h,
                borderColor: stampColor,
                borderWidth: 2.2,
                borderOpacity: stampOpacity,
                color: rgb(1, 1, 1),
                opacity: Math.min(0.92, stampOpacity),
                rotate: degrees(pdfAngle),
              });
              const inset = 3.5;
              if (w > inset * 4 && h > inset * 4) {
                const innerOrigin = toRotatedPt(-w / 2 + inset, -h / 2 + inset);
                page.drawRectangle({
                  x: innerOrigin.x,
                  y: innerOrigin.y,
                  width: w - inset * 2,
                  height: h - inset * 2,
                  borderColor: stampColor,
                  borderWidth: 0.75,
                  borderOpacity: stampOpacity * 0.75,
                  rotate: degrees(pdfAngle),
                });
              }
            }

            // Fit label text inside available horizontal & vertical bounds
            const maxTextW = Math.max(20, w - 16);
            let labelSize = Math.min(15, Math.max(8, h * (showMeta ? 0.3 : 0.4)));
            while (
              labelSize > 7 &&
              fontHelveticaBold.widthOfTextAtSize(stampText, labelSize) > maxTextW
            ) {
              labelSize -= 0.5;
            }
            const labelW = fontHelveticaBold.widthOfTextAtSize(stampText, labelSize);
            const labelLocalX = -labelW / 2;
            const labelLocalY = showMeta ? 2 : -labelSize * 0.35;
            const labelPt = toRotatedPt(labelLocalX, labelLocalY);
            const textColor = stampStyle === 'solid' ? rgb(1, 1, 1) : stampColor;

            page.drawText(stampText, {
              x: labelPt.x,
              y: labelPt.y,
              size: labelSize,
              font: fontHelveticaBold,
              color: textColor,
              opacity: stampOpacity,
              rotate: degrees(pdfAngle),
            });

            if (showMeta) {
              const dateStr = new Date(ann.createdAt).toLocaleDateString();
              const metaText = `${dateStr} | ${ann.author || 'VERIFIED'}`;
              let metaSize = Math.min(7.5, Math.max(5.5, h * 0.14));
              while (
                metaSize > 5 &&
                fontHelvetica.widthOfTextAtSize(metaText, metaSize) > maxTextW
              ) {
                metaSize -= 0.5;
              }
              const metaW = fontHelvetica.widthOfTextAtSize(metaText, metaSize);
              const metaPt = toRotatedPt(-metaW / 2, -h / 2 + 7);
              page.drawText(metaText, {
                x: metaPt.x,
                y: metaPt.y,
                size: metaSize,
                font: fontHelvetica,
                color: textColor,
                opacity: stampOpacity * 0.85,
                rotate: degrees(pdfAngle),
              });
            }
            break;
          }

          case 'note': {
            const noteW = ann.rect.width || 26;
            const noteH = ann.rect.height || 26;
            const noteColor = ann.color ? this.hexToRgb(ann.color) : rgb(0.98, 0.75, 0.14);
            const box = helper.toPdfBoxOrigin(ann.rect.x, ann.rect.y, noteW, noteH);
            page.drawRectangle({
              x: box.x,
              y: box.y,
              width: noteW,
              height: noteH,
              color: noteColor,
              borderColor: rgb(0.55, 0.35, 0.05),
              borderWidth: 1,
              opacity,
              borderOpacity: opacity,
              rotate: degrees(box.pdfAngle),
            });
            const markPt = helper.toPdfPoint(ann.rect.x + noteW * 0.38, ann.rect.y + noteH * 0.72);
            page.drawText('!', {
              x: markPt.x,
              y: markPt.y,
              size: Math.max(10, noteH * 0.55),
              font: fontHelveticaBold,
              color: rgb(0.12, 0.14, 0.18),
              rotate: degrees(helper.normAngle),
            });

            // Embed native PDF /Text sticky note popup annotation preserving full comment contents
            const noteRect = helper.toPdfWidgetRect(ann.rect.x, ann.rect.y, noteW, noteH);
            const popupAnnot = doc.context.obj({
              Type: 'Annot',
              Subtype: 'Text',
              Rect: [
                noteRect.x,
                noteRect.y,
                noteRect.x + noteRect.width,
                noteRect.y + noteRect.height,
              ],
              Contents: PDFString.of((ann.text || 'Sticky Note').trim()),
              T: PDFString.of(ann.author || 'NovaPDFPro User'),
              Name: 'Comment',
              C: [noteColor.red, noteColor.green, noteColor.blue],
              Open: false,
            });
            page.node.addAnnot(doc.context.register(popupAnnot));
            break;
          }
        }
      }
    }

    // 4. Process Interactive Form Fields
    if (options.formFields && options.formFields.length > 0) {
      const form = doc.getForm();
      for (const field of options.formFields) {
        if (field.pageIndex >= totalPages) continue;
        const page = doc.getPage(field.pageIndex);
        const helper = getPageCoordHelper(page);
        const widgetRect = helper.toPdfWidgetRect(field.x, field.y, field.width, field.height);

        try {
          if (field.type === 'text' || field.type === 'date') {
            const tf = form.createTextField(field.name);
            tf.setText(String(field.value || field.defaultValue || ''));
            tf.addToPage(page, {
              ...widgetRect,
              borderWidth: 1,
            });
          } else if (field.type === 'checkbox') {
            const cb = form.createCheckBox(field.name);
            if (field.value === true) cb.check();
            cb.addToPage(page, {
              ...widgetRect,
              borderWidth: 1,
            });
          } else if (field.type === 'dropdown') {
            const dd = form.createDropdown(field.name);
            if (field.options && field.options.length > 0) {
              dd.setOptions(field.options);
            }
            dd.addToPage(page, {
              ...widgetRect,
              borderWidth: 1,
            });
          }
        } catch (e) {
          console.warn('Form field creation fallback:', field.name, e);
        }
      }
    }

    // 5. Watermark Application
    if (options.watermark && options.watermark.text.trim()) {
      const wm = options.watermark;
      const wmColor = wm.colorHex ? this.hexToRgb(wm.colorHex) : rgb(0.7, 0.7, 0.7);
      const wmFontSize = wm.fontSize || 48;
      const wmOpacity = wm.opacity ?? 0.25;
      const angleDeg = wm.rotationDegrees ?? 45;

      for (let i = 0; i < totalPages; i++) {
        if (wm.excludeFirstPage && i === 0 && totalPages > 1) {
          continue;
        }
        const page = doc.getPage(i);
        const box = page.getCropBox();
        const normAngle = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;
        const totalAngle = normAngle + angleDeg;
        const rad = (totalAngle * Math.PI) / 180;
        const textWidth = fontHelveticaBold.widthOfTextAtSize(wm.text, wmFontSize);

        // Center point of page in PDF coordinates
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;

        // Shift origin so text center (textWidth/2, wmFontSize/3) is placed at (cx, cy)
        const x0 = cx - (textWidth / 2) * Math.cos(rad) + (wmFontSize / 3) * Math.sin(rad);
        const y0 = cy - (textWidth / 2) * Math.sin(rad) - (wmFontSize / 3) * Math.cos(rad);

        page.drawText(wm.text, {
          x: x0,
          y: y0,
          size: wmFontSize,
          font: fontHelveticaBold,
          color: wmColor,
          rotate: degrees(totalAngle),
          opacity: wmOpacity,
        });
      }
    }

    // 6. Header & Footer Pagination
    if (options.headerFooter) {
      const hf = options.headerFooter;
      const hfFontSize = hf.fontSize || 9;
      const hfColor = hf.colorHex ? this.hexToRgb(hf.colorHex) : rgb(0.3, 0.3, 0.3);

      for (let i = 0; i < totalPages; i++) {
        if (hf.excludeFirstPage && i === 0 && totalPages > 1) {
          continue;
        }
        const page = doc.getPage(i);
        const helper = getPageCoordHelper(page);
        const pageNum = i + 1;

        const formatHf = (template?: string) => {
          if (!template) return '';
          return template
            .replace(/{page}/gi, String(pageNum))
            .replace(/{total}/gi, String(totalPages));
        };

        // Header Left
        if (hf.headerLeft) {
          const text = formatHf(hf.headerLeft);
          const pt = helper.toPdfPoint(36, 28);
          page.drawText(text, {
            x: pt.x,
            y: pt.y,
            size: hfFontSize,
            font: fontHelvetica,
            color: hfColor,
            rotate: degrees(helper.normAngle),
          });
        }

        // Header Center
        if (hf.headerCenter) {
          const text = formatHf(hf.headerCenter);
          const textWidth = fontHelvetica.widthOfTextAtSize(text, hfFontSize);
          const headerPt = helper.toPdfPoint((helper.vpWidth - textWidth) / 2, 28);
          page.drawText(text, {
            x: headerPt.x,
            y: headerPt.y,
            size: hfFontSize,
            font: fontHelvetica,
            color: hfColor,
            rotate: degrees(helper.normAngle),
          });
        }

        // Header Right
        if (hf.headerRight) {
          const text = formatHf(hf.headerRight);
          const textWidth = fontHelvetica.widthOfTextAtSize(text, hfFontSize);
          const pt = helper.toPdfPoint(helper.vpWidth - textWidth - 36, 28);
          page.drawText(text, {
            x: pt.x,
            y: pt.y,
            size: hfFontSize,
            font: fontHelvetica,
            color: hfColor,
            rotate: degrees(helper.normAngle),
          });
        }

        // Footer Left
        if (hf.footerLeft) {
          const text = formatHf(hf.footerLeft);
          const pt = helper.toPdfPoint(36, helper.vpHeight - 24);
          page.drawText(text, {
            x: pt.x,
            y: pt.y,
            size: hfFontSize,
            font: fontHelvetica,
            color: hfColor,
            rotate: degrees(helper.normAngle),
          });
        }

        // Footer Center (Page numbers)
        if (hf.footerCenter) {
          const text = formatHf(hf.footerCenter);
          const textWidth = fontHelvetica.widthOfTextAtSize(text, hfFontSize);
          const footerPt = helper.toPdfPoint((helper.vpWidth - textWidth) / 2, helper.vpHeight - 24);
          page.drawText(text, {
            x: footerPt.x,
            y: footerPt.y,
            size: hfFontSize,
            font: fontHelvetica,
            color: hfColor,
            rotate: degrees(helper.normAngle),
          });
        }

        // Footer Right
        if (hf.footerRight) {
          const text = formatHf(hf.footerRight);
          const textWidth = fontHelvetica.widthOfTextAtSize(text, hfFontSize);
          const pt = helper.toPdfPoint(helper.vpWidth - textWidth - 36, helper.vpHeight - 24);
          page.drawText(text, {
            x: pt.x,
            y: pt.y,
            size: hfFontSize,
            font: fontHelvetica,
            color: hfColor,
            rotate: degrees(helper.normAngle),
          });
        }
      }
    }

    // 7. Metadata update
    if (options.metadata) {
      if (options.metadata.title) doc.setTitle(options.metadata.title);
      if (options.metadata.author) doc.setAuthor(options.metadata.author);
      if (options.metadata.subject) doc.setSubject(options.metadata.subject);
      if (options.metadata.keywords) doc.setKeywords(options.metadata.keywords);
    }

    // 8. Document Encryption (ISO 32000-1 Standard Security Handler)
    if (options.security?.userPassword || options.security?.ownerPassword) {
      encryptPdfDocument(doc, options.security);
      return await doc.save({ useObjectStreams: false });
    }

    return await doc.save();
  }

  // --- Page Management Operations ---

  public async rotatePages(
    pdfBytes: Uint8Array,
    pageIndices: number[],
    angle: 90 | 180 | 270
  ): Promise<Uint8Array> {
    const doc = await PDFDocument.load(pdfBytes);
    for (const idx of pageIndices) {
      if (idx < doc.getPageCount()) {
        const page = doc.getPage(idx);
        const current = page.getRotation().angle;
        page.setRotation(degrees((current + angle) % 360));
      }
    }
    return await doc.save();
  }

  public async deletePages(pdfBytes: Uint8Array, pageIndices: number[]): Promise<Uint8Array> {
    const doc = await PDFDocument.load(pdfBytes);
    // Sort descending so deletion doesn't offset subsequent indices
    const sorted = [...pageIndices].sort((a, b) => b - a);
    for (const idx of sorted) {
      if (idx < doc.getPageCount() && doc.getPageCount() > 1) {
        doc.removePage(idx);
      }
    }
    return await doc.save();
  }

  public async duplicatePage(pdfBytes: Uint8Array, pageIndex: number): Promise<Uint8Array> {
    const doc = await PDFDocument.load(pdfBytes);
    const [copied] = await doc.copyPages(doc, [pageIndex]);
    doc.insertPage(pageIndex + 1, copied);
    return await doc.save();
  }

  public async reorderPages(pdfBytes: Uint8Array, newOrder: number[]): Promise<Uint8Array> {
    const source = await PDFDocument.load(pdfBytes);
    const newDoc = await PDFDocument.create();
    const copiedPages = await newDoc.copyPages(source, newOrder);
    for (const p of copiedPages) {
      newDoc.addPage(p);
    }
    return await newDoc.save();
  }

  public async insertBlankPage(
    pdfBytes: Uint8Array,
    atIndex: number,
    size: [number, number] = [595.28, 841.89]
  ): Promise<Uint8Array> {
    const doc = await PDFDocument.load(pdfBytes);
    doc.insertPage(Math.min(atIndex, doc.getPageCount()), size);
    return await doc.save();
  }

  public async extractPages(pdfBytes: Uint8Array, pageIndices: number[]): Promise<Uint8Array> {
    const source = await PDFDocument.load(pdfBytes);
    const newDoc = await PDFDocument.create();
    const copied = await newDoc.copyPages(source, pageIndices);
    for (const p of copied) {
      newDoc.addPage(p);
    }
    return await newDoc.save();
  }

  public async mergePdfs(pdfByteArrayList: Uint8Array[]): Promise<Uint8Array> {
    const mergedDoc = await PDFDocument.create();
    for (const bytes of pdfByteArrayList) {
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const copiedPages = await mergedDoc.copyPages(doc, doc.getPageIndices());
      for (const page of copiedPages) {
        mergedDoc.addPage(page);
      }
    }
    return await mergedDoc.save();
  }

  public async splitPdf(pdfBytes: Uint8Array): Promise<Uint8Array[]> {
    const source = await PDFDocument.load(pdfBytes);
    const results: Uint8Array[] = [];
    const count = source.getPageCount();

    for (let i = 0; i < count; i++) {
      const singleDoc = await PDFDocument.create();
      const [copied] = await singleDoc.copyPages(source, [i]);
      singleDoc.addPage(copied);
      results.push(await singleDoc.save());
    }

    return results;
  }
}

export const pdfEngine = new PDFEngineService();
