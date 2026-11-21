const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const logFile = path.join(__dirname, 'verify-placement-precision.log');
function log(msg) {
  console.log(msg);
  fs.appendFileSync(logFile, msg + '\n');
}
fs.writeFileSync(logFile, 'Starting NovaPDFPro WYSIWYG Placement Precision E2E Verification\n');

setTimeout(() => {
  log('[FAILSAFE] Verification timed out after 45 seconds');
  process.exit(1);
}, 45000);

process.env.NOVAPDFPRO_E2E_TEST = '1';
require('../electron/main.cjs');

app.whenReady().then(async () => {
  const checkReady = setInterval(async () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) return;

    const win = windows[0];
    if (win.webContents.isLoading()) return;

    clearInterval(checkReady);
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) log('[CONSOLE_ERR] ' + message);
    });

    try {
      // -------------------------------------------------------------
      // PART 1: Unrotated A4 Precision (Zoomed 1.5x UI -> Save -> PDF.js Roundtrip)
      // -------------------------------------------------------------
      const part1 = await win.webContents.executeJavaScript(`
        (async () => {
          const store = window.__editorStore.getState();
          await store.createNewDocument('A4');
          store.setActiveTab('editor');
          store.setZoom(1.5);
          await new Promise(r => setTimeout(r, 500));

          const overlay = document.querySelector('.z-20.pointer-events-auto');
          const overlayRect = overlay.getBoundingClientRect();

          // 1. Add styled text item at (120, 140) fontSize 16 (italic + underline)
          store.addTextItem({
            pageIndex: 0,
            x: 120,
            y: 140,
            text: 'PRECISE-TEXT-CHECK',
            fontSize: 16,
            fontFamily: 'Helvetica',
            color: '#111827',
            isItalic: true,
            isUnderline: true,
          });

          // 2. Add a 40x10 wide red-blue PNG inside a square 100x100 box (testing object-contain!)
          const pngCanvas = document.createElement('canvas');
          pngCanvas.width = 80;
          pngCanvas.height = 20;
          const pctx = pngCanvas.getContext('2d');
          pctx.fillStyle = '#0ea5e9';
          pctx.fillRect(0, 0, 80, 20);
          const pngDataUrl = pngCanvas.toDataURL('image/png');
          store.addImageItem({
            pageIndex: 0,
            x: 100,
            y: 260,
            width: 100,
            height: 100,
            rotation: 0,
            opacity: 1,
            dataUrl: pngDataUrl,
            name: 'WideBanner.png',
            format: 'png',
          });

          // 3. Add reverse-direction Arrow from (300, 320) -> (180, 240)
          store.addAnnotation({
            pageIndex: 0,
            type: 'arrow',
            rect: { x: 180, y: 240, width: 120, height: 80 },
            points: [
              { x: 120, y: 80 },
              { x: 0, y: 0 },
            ],
            color: '#dc2626',
            strokeWidth: 4,
            opacity: 1,
          });

          // 4. Add border-box Rectangle at (50, 420) 120x60 strokeWidth=4
          store.addAnnotation({
            pageIndex: 0,
            type: 'rectangle',
            rect: { x: 50, y: 420, width: 120, height: 60 },
            color: '#16a34a',
            strokeWidth: 4,
            opacity: 1,
          });

          // 5. Add SHA-256 Digital Certificate Stamp
          store.addAnnotation({
            pageIndex: 0,
            type: 'stamp',
            rect: { x: 240, y: 420, width: 220, height: 86 },
            color: '#059669',
            stampType: 'APPROVED',
            stampLabel: 'DIGITALLY SIGNED',
            certificateMeta: {
              signerName: 'Alvin Tan',
              signerRole: 'Lead Architect',
              reason: 'Final Release Sign-Off',
              timestampIso: '2026-11-10T10:00:00Z',
              sha256: 'A1B2C3D4E5F60718293A4B5C6D7E8F9011223344556677889900AABBCCDDEEFF',
            },
            opacity: 1,
            rotation: 0,
          });

          await new Promise(r => setTimeout(r, 250));

          // Verify DOM overlay placement matches exact x * scale, y * scale (zero padding drift)
          const domScale = 1.5 * 1.5; // PDFViewer uses scale = zoom * 1.5
          const textSpan = Array.from(overlay.querySelectorAll('span')).find(s => s.textContent === 'PRECISE-TEXT-CHECK');
          const textWrapper = textSpan?.parentElement;
          const textDomRect = textWrapper?.getBoundingClientRect();
          const spanDomRect = textSpan?.getBoundingClientRect();
          const domDeltaX = textDomRect ? (textDomRect.left - overlayRect.left) / domScale - 120 : 999;
          const domDeltaY = textDomRect ? (textDomRect.top - overlayRect.top) / domScale - 140 : 999;
          const spanDeltaX = spanDomRect ? (spanDomRect.left - overlayRect.left) / domScale - 120 : 999;

          const arrowSvg = overlay.querySelector('svg polygon');
          const imgWrapper = overlay.querySelector('img[alt="WideBanner.png"]')?.parentElement;
          const imgElement = overlay.querySelector('img[alt="WideBanner.png"]');
          const imgPadX = imgWrapper && imgElement ? imgElement.getBoundingClientRect().left - imgWrapper.getBoundingClientRect().left : 999;

          // Save PDF & reload at zoom = 1/1.5 (scale = 1.0, 1px == 1pt)
          const savedBytes = await window.__editorStore.getState().saveCurrentPdf();
          window.__editorStore.getState().setZoom(1 / 1.5);
          await new Promise(r => setTimeout(r, 350));
          await window.__editorStore.getState().loadPdfBytes(savedBytes, 'precision-roundtrip.pdf');
          await new Promise(r => setTimeout(r, 800));

          const reloadedCanvas = document.querySelector('canvas');
          const rctx = reloadedCanvas.getContext('2d');
          const pxAt = (x, y) => {
            const d = rctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
            return { r: d[0], g: d[1], b: d[2], a: d[3] };
          };
          const isColored = (p) => p.r < 235 || p.g < 235 || p.b < 235;

          // Check image object-contain: center y=310 MUST be blue (#0ea5e9), while top/bottom letterbox y=268 / y=352 MUST be white!
          const imgCenterPx = pxAt(150, 310);
          const imgTopLetterboxPx = pxAt(150, 268);
          const imgBotLetterboxPx = pxAt(150, 352);

          // Check arrow rendered at midpoint (240, 280) & near tip (185, 243)
          const arrowMidPx = pxAt(240, 280);
          const arrowTipPx = pxAt(185, 243);

          // Check rectangle border-box containment: stroke at y=422 (middle of top 4px border [420..424]),
          // and NO stroke outside at y=417!
          const rectTopEdgePx = pxAt(110, 422);
          const rectOutsidePx = pxAt(110, 417);

          // Check extracted PDF text baseline & certificate text directly from saved pdfDocProxy!
          const proxy = window.__editorStore.getState().pdfDocProxy;
          const p1 = await proxy.getPage(1);
          const vp1 = p1.getViewport({ scale: 1.0 });
          const tc1 = await p1.getTextContent();
          const items1 = tc1.items.map((it) => {
            // Map PDF baseline point (it.transform[4], it.transform[5]) -> viewport (vx, vy)
            const [vx, vy] = vp1.convertToViewportPoint(it.transform[4], it.transform[5]);
            return { str: it.str, vx, baselineVy: vy };
          });
          const fullStr1 = items1.map((i) => i.str).join(' ');
          const foundText = items1.find((t) => t.str.includes('PRECISE-TEXT-CHECK'));
          const hasSignerInSavedPdf = fullStr1.includes('Alvin Tan');
          const hasHashInSavedPdf = fullStr1.includes('A1B2C3D4E5F6');

          return {
            domDeltaX,
            domDeltaY,
            spanDeltaX,
            imgPadX,
            hasDomArrowHead: !!arrowSvg,
            imgCenterColored: isColored(imgCenterPx),
            imgTopLetterboxWhite: !isColored(imgTopLetterboxPx),
            imgBotLetterboxWhite: !isColored(imgBotLetterboxPx),
            arrowMidColored: isColored(arrowMidPx),
            arrowTipColored: isColored(arrowTipPx),
            rectTopEdgeColored: isColored(rectTopEdgePx),
            rectOutsideWhite: !isColored(rectOutsidePx),
            extractedTextPos: foundText ? { x: foundText.vx, baselineY: foundText.baselineVy } : null,
            hasSignerInSavedPdf,
            hasHashInSavedPdf,
          };
        })()
      `);

      log('Part 1 (A4 Unrotated Precision): ' + JSON.stringify(part1, null, 2));

      const p1Ok =
        Math.abs(part1.domDeltaX) < 0.5 &&
        Math.abs(part1.domDeltaY) < 0.5 &&
        Math.abs(part1.spanDeltaX) < 0.5 &&
        Math.abs(part1.imgPadX) < 0.5 &&
        part1.hasDomArrowHead &&
        part1.imgCenterColored &&
        part1.imgTopLetterboxWhite &&
        part1.imgBotLetterboxWhite &&
        part1.arrowMidColored &&
        part1.arrowTipColored &&
        part1.rectTopEdgeColored &&
        part1.rectOutsideWhite &&
        part1.extractedTextPos &&
        Math.abs(part1.extractedTextPos.x - 120) < 1.0 &&
        Math.abs(part1.extractedTextPos.baselineY - (140 + 16 * 0.85)) < 2.0 &&
        part1.hasSignerInSavedPdf &&
        part1.hasHashInSavedPdf;

      if (!p1Ok) {
        log('[FAIL] Part 1 precision checks failed!');
        app.exit(1);
        return;
      }
      log('[PASS] Part 1: DOM, Text baseline, object-contain Image, reverse Arrow, border-box Rect, & SHA-256 Certificate matched!');

      // -------------------------------------------------------------
      // PART 2: Cropped + 90°-Rotated Page Roundtrip Precision
      // Create a PDF with CropBox (40, 60, 500, 700) and /Rotate 90 using pdf-lib in Node,
      // pass bytes to renderer, add text + rect in viewport space, save, & verify via canvas+text!
      // -------------------------------------------------------------
      const { PDFDocument, degrees } = require('pdf-lib');
      const cropDoc = await PDFDocument.create();
      const cp = cropDoc.addPage([600, 800]);
      cp.setCropBox(40, 60, 500, 700);
      cp.setRotation(degrees(90));
      const cropBytesB64 = Buffer.from(await cropDoc.save()).toString('base64');

      const part2 = await win.webContents.executeJavaScript(`
        (async () => {
          const raw = Uint8Array.from(atob('${cropBytesB64}'), c => c.charCodeAt(0));
          const store = window.__editorStore.getState();
          store.setZoom(1 / 1.5); // scale = 1.0 (1px == 1pt)
          await new Promise(r => setTimeout(r, 300));
          await store.loadPdfBytes(raw, 'cropped-rotated90.pdf');
          await new Promise(r => setTimeout(r, 600));

          // Viewport of 500x700 rotated 90deg -> viewportWidth=700, viewportHeight=500
          const beforePage = await window.__editorStore.getState().pdfDocProxy.getPage(1);
          const beforeVp = beforePage.getViewport({ scale: 1.0 });
          const vpBefore = { w: beforeVp.width, h: beforeVp.height };

          store.addTextItem({
            pageIndex: 0,
            x: 80,
            y: 90,
            text: 'CROPPED-ROT-OK',
            fontSize: 16,
            fontFamily: 'Helvetica',
            color: '#000000',
          });

          store.addAnnotation({
            pageIndex: 0,
            type: 'rectangle',
            rect: { x: 200, y: 150, width: 100, height: 60 },
            color: '#2563eb',
            strokeWidth: 4,
            opacity: 1,
          });

          const savedBytes = await window.__editorStore.getState().saveCurrentPdf();
          await window.__editorStore.getState().loadPdfBytes(savedBytes, 'cropped-rotated90-saved.pdf');
          await new Promise(r => setTimeout(r, 700));

          const canvas = document.querySelector('canvas');
          const ctx = canvas.getContext('2d');
          const pxAt = (x, y) => {
            const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
            return { r: d[0], g: d[1], b: d[2] };
          };
          const isColored = (p) => p.r < 230 || p.g < 230 || p.b < 230;

          const rectTopEdge = pxAt(250, 152);
          const rectLeftEdge = pxAt(202, 180);
          const rectOutside = pxAt(250, 145);

          const savedPage = await window.__editorStore.getState().pdfDocProxy.getPage(1);
          const savedVp = savedPage.getViewport({ scale: 1.0 });
          const savedTc = await savedPage.getTextContent();
          const rotText = savedTc.items
            .map((it) => {
              const [vx, vy] = savedVp.convertToViewportPoint(it.transform[4], it.transform[5]);
              return { str: it.str, vx, baselineVy: vy };
            })
            .find((t) => t.str.includes('CROPPED-ROT-OK'));

          return {
            vpBefore,
            rectTopColored: isColored(rectTopEdge),
            rectLeftColored: isColored(rectLeftEdge),
            rectOutsideWhite: !isColored(rectOutside),
            rotTextPos: rotText ? { x: rotText.vx, baselineY: rotText.baselineVy } : null,
          };
        })()
      `);

      log('Part 2 (CropBox + Rotate 90 Precision): ' + JSON.stringify(part2, null, 2));

      const p2Ok =
        Math.round(part2.vpBefore.w) === 700 &&
        Math.round(part2.vpBefore.h) === 500 &&
        part2.rectTopColored &&
        part2.rectLeftColored &&
        part2.rectOutsideWhite &&
        part2.rotTextPos &&
        Math.abs(part2.rotTextPos.x - 80) < 2.0 &&
        Math.abs(part2.rotTextPos.baselineY - (90 + 16 * 0.85)) < 3.0;

      if (!p2Ok) {
        log('[FAIL] Part 2 CropBox + Rotate 90 precision checks failed!');
        app.exit(1);
        return;
      }

      log('[PASS] Part 2: Non-zero CropBox + 90-deg Rotation viewport placement verified exact!');

      // -------------------------------------------------------------
      // PART 3: All 8 Annotation/Draw Tools + Sticky Note PDF /Annot + Save Modal Flow
      // -------------------------------------------------------------
      const part3 = await win.webContents.executeJavaScript(`
        (async () => {
          const store = window.__editorStore.getState();
          store.setZoom(1 / 1.5); // scale = 1.0
          await new Promise(r => setTimeout(r, 200));
          await store.createNewDocument('A4');
          store.setActiveTab('editor');
          await new Promise(r => setTimeout(r, 500));

          const overlay = document.querySelector('.z-20.pointer-events-auto');
          const oRect = overlay.getBoundingClientRect();
          const tick = (ms = 25) => new Promise(r => setTimeout(r, ms));
          const dragMouse = async (x0, y0, x1, y1, midPts = []) => {
            overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: oRect.left + x0, clientY: oRect.top + y0, button: 0 }));
            await tick(25);
            for (const [mx, my] of midPts) {
              overlay.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: oRect.left + mx, clientY: oRect.top + my, button: 0 }));
              await tick(15);
            }
            overlay.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: oRect.left + x1, clientY: oRect.top + y1, button: 0 }));
            await tick(25);
            overlay.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: oRect.left + x1, clientY: oRect.top + y1, button: 0 }));
            await tick(25);
          };

          // 1. Horizontal Line (height 0 drag -> must still create!)
          store.setActiveTool('shape-line');
          store.setActiveColor('#0f172a');
          store.setActiveStrokeWidth(4);
          await tick(40);
          await dragMouse(60, 120, 200, 120);

          // 2. Reverse Arrow + contextual color & stroke update check
          store.setActiveTool('shape-arrow');
          await tick(40);
          await dragMouse(280, 220, 180, 160);

          // 3. Highlight horizontal swipe (thin drag y=260 -> y=262)
          store.setActiveTool('highlight');
          store.setActiveColor('#ffeb3b');
          await tick(40);
          await dragMouse(60, 260, 200, 262);

          // 4. Underline horizontal swipe (thin drag y=300 -> y=301)
          store.setActiveTool('underline');
          await tick(40);
          await dragMouse(60, 300, 200, 301);

          // 5. Strikethrough horizontal swipe (thin drag y=340 -> y=341)
          store.setActiveTool('strikethrough');
          await tick(40);
          await dragMouse(60, 340, 200, 341);

          // 6. Freehand Draw (multi-point stroke around y=420)
          store.setActiveTool('draw');
          store.setActiveColor('#dc2626');
          store.setActiveStrokeWidth(4);
          await tick(40);
          await dragMouse(60, 420, 180, 420, [[100, 410], [140, 430]]);

          // 7. Sticky Note with actual comment text
          store.setActiveTool('note');
          await tick(40);
          await dragMouse(350, 120, 350, 120);
          await new Promise(r => setTimeout(r, 120));
          const noteAnn = window.__editorStore.getState().annotations.find(a => a.type === 'note');
          if (noteAnn) {
            store.updateAnnotation(noteAnn.id, { text: 'Clause 4 approved with revision', color: '#fbbf24' });
          }

          // 8. Stamp via store at (300, 250)
          store.addAnnotation({
            pageIndex: 0,
            type: 'stamp',
            rect: { x: 300, y: 250, width: 150, height: 54 },
            color: '#059669',
            stampType: 'APPROVED',
            stampLabel: 'APPROVED',
            stampStyle: 'classic',
            rotation: -10,
            opacity: 0.95,
          });

          await new Promise(r => setTimeout(r, 150));
          const annsBeforeSave = window.__editorStore.getState().annotations;
          const createdTypes = annsBeforeSave.map(a => a.type);

          // Test Contextual Toolbar color/stroke update on selected line
          const lineAnn = annsBeforeSave.find(a => a.type === 'line');
          if (lineAnn) {
            store.selectItem(lineAnn.id, 'annotation');
            await new Promise(r => setTimeout(r, 120));
            const incStrokeBtn = Array.from(document.querySelectorAll('button[title="Increase Stroke"]'))[0];
            incStrokeBtn?.click();
          }
          await new Promise(r => setTimeout(r, 100));
          const updatedLineStroke = window.__editorStore.getState().annotations.find(a => a.type === 'line')?.strokeWidth;

          // Test Save Modal ("Recommend Save as New File") via Save button
          const saveBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.trim() === 'Save'
          );
          saveBtn?.click();
          await new Promise(r => setTimeout(r, 150));

          const modalVisible = document.body.innerText.includes('Save Updated PDF') &&
            document.body.innerText.includes('Save as New File (Recommended)');
          const modalHasSummary = document.body.innerText.includes('Annotation / Stamp / Draw');

          // Click "Apply Changes in Current Session Only" to verify all 8 tools bake cleanly into PDF bytes
          const applySessionBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.includes('Apply Changes in Current Session Only')
          );
          applySessionBtn?.click();
          await new Promise(r => setTimeout(r, 800));

          const stAfterSave = window.__editorStore.getState();
          const canvas = document.querySelector('canvas');
          const ctx = canvas.getContext('2d');
          const pxAt = (x, y) => {
            const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
            return { r: d[0], g: d[1], b: d[2] };
          };
          const isColored = (p) => p.r < 245 || p.g < 245 || p.b < 245;

          const linePx = pxAt(130, 120);
          const arrowMidPx = pxAt(230, 190);
          const highlightPx = pxAt(130, 260);
          const underlinePx = pxAt(130, 305);
          const strikePx = pxAt(130, 340);
          const drawPx = pxAt(100, 410);
          const notePx = pxAt(363, 133);

          // Verify PDF native /Text popup annotation preserved the comment text!
          const savedPage = await stAfterSave.pdfDocProxy.getPage(1);
          const pdfAnnots = await savedPage.getAnnotations();
          const savedPopupContents = pdfAnnots.map(a => a.contents || a.contentsObj?.str || '').join(' | ');

          return {
            count: createdTypes.length,
            hasAll8: ['line', 'arrow', 'highlight', 'underline', 'strikethrough', 'freehand', 'note', 'stamp'].every(t => createdTypes.includes(t)),
            updatedLineStroke,
            modalVisible,
            modalHasSummary,
            clearedAfterSave: stAfterSave.annotations.length === 0 && !stAfterSave.isDirty,
            lineColored: isColored(linePx),
            arrowColored: isColored(arrowMidPx),
            highlightColored: isColored(highlightPx),
            underlineColored: isColored(underlinePx),
            strikeColored: isColored(strikePx),
            drawColored: isColored(drawPx),
            noteColored: isColored(notePx),
            noteTextSavedInPdfAnnot: savedPopupContents.includes('Clause 4 approved with revision'),
          };
        })()
      `);

      log('Part 3 (All 8 Tools + Sticky Note Popup + Save Modal): ' + JSON.stringify(part3, null, 2));

      const p3Ok =
        part3.hasAll8 &&
        part3.updatedLineStroke === 5 &&
        part3.modalVisible &&
        part3.modalHasSummary &&
        part3.clearedAfterSave &&
        part3.lineColored &&
        part3.arrowColored &&
        part3.highlightColored &&
        part3.underlineColored &&
        part3.strikeColored &&
        part3.drawColored &&
        part3.noteColored &&
        part3.noteTextSavedInPdfAnnot;

      if (!p3Ok) {
        log('[FAIL] Part 3 all-tools & Save-modal checks failed!');
        app.exit(1);
        return;
      }

      log('[PASS] Part 3: All 8 tools (Line, Arrow, Highlight, Underline, Strike, Draw, Note, Stamp) + Save-as-New modal verified!');
      log('\nALL PLACEMENT PRECISION E2E CHECKS PASSED!');
      app.exit(0);
    } catch (err) {
      log('[ERROR] ' + (err && err.stack ? err.stack : String(err)));
      app.exit(1);
    }
  }, 400);
});
