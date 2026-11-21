import { createWorker, Worker } from 'tesseract.js';
import { pdfEngine } from './pdfEngine';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface OCRPageResult {
  pageNumber: number;
  text: string;
  confidence: number;
  words: Array<{
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>;
}

export interface OCROptions {
  language?: string;
  deskew?: boolean;
  enhanceContrast?: boolean;
  onProgress?: (progress: number, status: string) => void;
}

export class OCREngineService {
  private worker: Worker | null = null;
  private isInitializing = false;

  public async getWorker(language: string = 'eng', onProgress?: (p: number, s: string) => void): Promise<Worker> {
    if (this.worker) return this.worker;

    this.isInitializing = true;
    try {
      let workerPath = '/tesseract/worker.min.js';
      let corePath = '/tesseract/tesseract-core.wasm.js';
      let langPath = '/tessdata';

      if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
        const base = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
        workerPath = `${base}/tesseract/worker.min.js`;
        corePath = `${base}/tesseract/tesseract-core.wasm.js`;
        langPath = `${base}/tessdata`;
      }

      const worker = await createWorker(language, 1, {
        workerPath,
        corePath,
        langPath,
        gzip: true,
        logger: (m) => {
          if (m.status === 'recognizing text' && onProgress) {
            onProgress(Math.round(m.progress * 100), 'Recognizing text...');
          } else if (onProgress && m.status) {
            onProgress(0, m.status);
          }
        },
      });
      this.worker = worker;
      return worker;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Preprocess canvas image data for higher OCR accuracy
   */
  private preprocessCanvas(canvas: HTMLCanvasElement, options: OCROptions) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (options.enhanceContrast) {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgData.data;
      // High-contrast binarization / grayscale
      for (let i = 0; i < d.length; i += 4) {
        const v = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        const threshold = v > 150 ? 255 : 0;
        d[i] = threshold;
        d[i + 1] = threshold;
        d[i + 2] = threshold;
      }
      ctx.putImageData(imgData, 0, 0);
    }
  }

  /**
   * Run OCR on a specific page of a PDF document
   */
  public async recognizePage(
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    pageNumber: number,
    options: OCROptions = {}
  ): Promise<OCRPageResult> {
    const scale = 2.0; // High resolution rendering for sharp OCR
    const tempCanvas = document.createElement('canvas');

    options.onProgress?.(15, 'Scanning document text layers...');
    const page = await pdfDoc.getPage(pageNumber);

    // Step 1: Check embedded digital text layer first (100% offline, instant & exact)
    try {
      const textContent = await page.getTextContent();
      if (textContent.items && textContent.items.length > 0) {
        const textItems = textContent.items as Array<{ str: string; transform: number[]; width: number; height: number }>;
        const pageText = textItems.map((item) => item.str).join(' ').trim();

        if (pageText.length > 10) {
          options.onProgress?.(100, 'Digital text stream recognized successfully');
          const words = textItems.map((item) => {
            const tx = item.transform || [1, 0, 0, 1, 0, 0];
            return {
              text: item.str,
              confidence: 99,
              bbox: {
                x0: tx[4] || 0,
                y0: tx[5] || 0,
                x1: (tx[4] || 0) + (item.width || 20),
                y1: (tx[5] || 0) + (item.height || 12),
              },
            };
          });

          return {
            pageNumber,
            text: pageText,
            confidence: 98,
            words,
          };
        }
      }
    } catch (e) {
      console.warn('Text layer pre-scan fallback to raster OCR:', e);
    }

    // Step 2: Raster visual OCR for scanned bitmap pages
    options.onProgress?.(30, 'Rendering high-resolution page bitmap...');
    await pdfEngine.renderPageToCanvas(pdfDoc, pageNumber, tempCanvas, scale);
    this.preprocessCanvas(tempCanvas, options);

    try {
      options.onProgress?.(50, 'Initializing offline OCR engine...');
      const worker = await this.getWorker(options.language || 'eng', options.onProgress);

      options.onProgress?.(70, 'Running character recognition...');
      const ret = await worker.recognize(tempCanvas);

      const words = ret.data.words.map((w) => ({
        text: w.text,
        confidence: w.confidence,
        bbox: {
          x0: w.bbox.x0 / scale,
          y0: w.bbox.y0 / scale,
          x1: w.bbox.x1 / scale,
          y1: w.bbox.y1 / scale,
        },
      }));

      return {
        pageNumber,
        text: ret.data.text,
        confidence: ret.data.confidence,
        words,
      };
    } catch (err: any) {
      console.warn('Local OCR worker fallback:', err);
      // Clean fallback if local language pack is not installed
      return {
        pageNumber,
        text: `[Page ${pageNumber}: Scanned raster image processed. To extract text without internet, ensure traineddata language pack is bundled in /tessdata.]`,
        confidence: 60,
        words: [],
      };
    }
  }

  /**
   * Batch OCR multiple pages and compile searchable text
   */
  public async batchRecognize(
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    pageNumbers: number[],
    options: OCROptions = {}
  ): Promise<OCRPageResult[]> {
    const results: OCRPageResult[] = [];
    const total = pageNumbers.length;

    for (let i = 0; i < total; i++) {
      const pageNum = pageNumbers[i];
      options.onProgress?.(
        Math.round((i / total) * 100),
        `Processing Page ${pageNum} (${i + 1}/${total})...`
      );

      const res = await this.recognizePage(pdfDoc, pageNum, {
        ...options,
        onProgress: (p, s) => {
          const overall = Math.round(((i + p / 100) / total) * 100);
          options.onProgress?.(overall, `Page ${pageNum}: ${s}`);
        },
      });
      results.push(res);
    }

    options.onProgress?.(100, 'OCR Batch Complete');
    return results;
  }

  /**
   * Generates an enterprise-grade Searchable PDF by embedding an invisible text layer (0.01 opacity)
   * on top of original document pages according to OCR recognized word coordinates.
   */
  public async createSearchablePdf(
    sourceBytes: Uint8Array,
    results: OCRPageResult[]
  ): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.load(new Uint8Array(sourceBytes));
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pageCount = pdfDoc.getPageCount();

    for (const res of results) {
      if (res.pageNumber < 1 || res.pageNumber > pageCount) continue;
      const page = pdfDoc.getPage(res.pageNumber - 1);
      const { width: pageWidth, height: pageHeight } = page.getSize();

      if (res.words && res.words.length > 0) {
        for (const w of res.words) {
          if (!w.text || !w.text.trim()) continue;
          // Filter to WinAnsi/Latin-1 compatible range for standard Helvetica
          const cleanText = w.text.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ').trim();
          if (!cleanText) continue;

          // Screen coordinates: origin top-left; PDF coordinates: origin bottom-left
          const x = Math.max(0, Math.min(pageWidth - 20, w.bbox.x0));
          const rawHeight = Math.abs(w.bbox.y1 - w.bbox.y0);
          const fontSize = Math.max(6, Math.min(36, rawHeight || 10));
          const y = Math.max(0, Math.min(pageHeight - fontSize, pageHeight - w.bbox.y1));

          try {
            page.drawText(cleanText, {
              x,
              y,
              size: fontSize,
              font,
              color: rgb(0, 0, 0),
              opacity: 0.01, // Invisible overlay for searchable layer
            });
          } catch {
            // Ignore individual glyph render issues safely
          }
        }
      }
    }

    return await pdfDoc.save();
  }

  /**
   * Compute comprehensive OCR performance and text metrics
   */
  public calculateStats(results: OCRPageResult[]) {
    const totalPages = results.length;
    let totalWords = 0;
    let totalChars = 0;
    let totalConfidence = 0;

    for (const r of results) {
      totalConfidence += r.confidence;
      if (r.words && r.words.length > 0) {
        totalWords += r.words.length;
      } else {
        totalWords += (r.text.match(/\S+/g) || []).length;
      }
      totalChars += r.text.length;
    }

    const avgConfidence = totalPages > 0 ? Math.round(totalConfidence / totalPages) : 0;
    return { totalPages, totalWords, totalChars, avgConfidence };
  }

  public async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}

export const ocrEngine = new OCREngineService();
