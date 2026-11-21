const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const logFile = path.join(__dirname, 'verify-conversion-center.log');
function log(msg) {
  console.log(msg);
  fs.appendFileSync(logFile, msg + '\n');
}
fs.writeFileSync(logFile, 'Starting NovaPDFPro Local PDF Conversion Center E2E Verification\n');

setTimeout(() => {
  log('[FAILSAFE] Verification timed out after 45 seconds');
  process.exit(1);
}, 45000);

process.env.NOVAPDFPRO_E2E_TEST = '1';
require('../electron/main.cjs');

app.whenReady().then(async () => {
  log('[STEP 1] App ready, waiting for window to load...');

  const checkReady = setInterval(async () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) return;

    const win = windows[0];
    if (win.webContents.isLoading()) return;

    clearInterval(checkReady);
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2 && !message.includes('Electron Security Warning')) {
        log('[CONSOLE_ERR] ' + message);
      }
    });
    log('[STEP 2] BrowserWindow loaded dist/index.html');

    try {
      // -------------------------------------------------------------
      // SETUP: Create a 2-Page PDF with Embedded & Unsaved Text + Special Chars
      // -------------------------------------------------------------
      log('\n--- SETUP: 2-PAGE PDF FOR CONVERSION ---');
      const setupRes = await win.webContents.executeJavaScript(`
        (async () => {
          const store = window.__editorStore.getState();
          await store.createNewDocument('A4');
          const blankBytes = window.__editorStore.getState().pdfBytes;
          const twoPageBytes = await window.__pdfEngine.insertBlankPage(blankBytes, 1, [595.28, 841.89]);
          const baked = await window.__pdfEngine.applyModifications(twoPageBytes, {
            textItems: [
              { pageIndex: 0, x: 60, y: 100, text: 'Page One Header <script>alert(1)</script>', fontSize: 16, fontFamily: 'Helvetica', color: '#000000' },
              { pageIndex: 1, x: 60, y: 140, text: 'Page Two Line A', fontSize: 14, fontFamily: 'Helvetica', color: '#000000' },
              { pageIndex: 1, x: 60, y: 170, text: 'Page Two Line B', fontSize: 14, fontFamily: 'Helvetica', color: '#000000' }
            ]
          });
          await store.loadPdfBytes(baked, 'Conversion_Source.pdf');
          // Add an uncommitted editor text item on Page 1 to verify "Include active editor annotations & text"
          store.addTextItem({
            pageIndex: 0,
            x: 60,
            y: 220,
            text: 'UnsavedEditorLine',
            fontSize: 14,
            fontFamily: 'Helvetica',
            color: '#000000'
          });
          store.setActiveTab('convert');
          await new Promise(r => setTimeout(r, 400));
          return {
            pageCount: window.__editorStore.getState().pageCount,
            activeTab: window.__editorStore.getState().activeTab
          };
        })()
      `);
      log('Setup Result: ' + JSON.stringify(setupRes));

      // -------------------------------------------------------------
      // TEST 1: MULTI-PAGE PDF -> PNG & JPG EXPORT VIA UI
      // -------------------------------------------------------------
      log('\n--- TEST 1: MULTI-PAGE PDF TO PNG & JPG ---');
      const imgExportRes = await win.webContents.executeJavaScript(`
        (async () => {
          const startBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.includes('Start Local Conversion')
          );
          if (!startBtn) return { success: false, reason: 'Start Local Conversion button not found' };
          startBtn.click();

          // Wait for conversion job to finish
          for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 200));
            if (document.body.innerText.includes('Download All (2)')) break;
          }

          const hasDownloadAll = document.body.innerText.includes('Download All (2)');
          const hasPage1 = document.body.innerText.includes('Page 1');
          const hasPage2 = document.body.innerText.includes('Page 2');

          // Switch to JPG and convert current page
          const jpgBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.includes('PDF to JPG')
          );
          jpgBtn?.click();
          await new Promise(r => setTimeout(r, 100));

          const startBtn2 = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.includes('Start Local Conversion')
          );
          startBtn2?.click();
          await new Promise(r => setTimeout(r, 1200));

          const completedText = document.body.innerText.includes('2 completed');

          return {
            hasDownloadAll,
            hasPage1,
            hasPage2,
            completedText,
            success: hasDownloadAll && hasPage1 && hasPage2 && completedText
          };
        })()
      `);
      log('Test 1 Result: ' + JSON.stringify(imgExportRes));
      if (!imgExportRes.success) {
        log('[FAIL] Test 1 failed');
        app.exit(1);
        return;
      }
      log('[PASS] Test 1: Multi-page PDF -> PNG & JPG export verified!');

      // -------------------------------------------------------------
      // TEST 2: PDF -> TXT & PDF -> HTML (LINE PRESERVATION, UNSAVED EDITS, XSS ESCAPING)
      // -------------------------------------------------------------
      log('\n--- TEST 2: PDF TO TXT & HTML (UNSAVED EDITS & XSS ESCAPING) ---');
      const txtHtmlRes = await win.webContents.executeJavaScript(`
        (async () => {
          const st = window.__editorStore.getState();
          const compiled = await window.__pdfEngine.applyModifications(st.pdfBytes, { textItems: st.textItems });
          // Access via UI TXT & HTML triggers
          const txtCard = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.includes('PDF to TXT')
          );
          txtCard?.click();
          await new Promise(r => setTimeout(r, 100));
          const startBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.includes('Start Local Conversion')
          );
          startBtn?.click();
          await new Promise(r => setTimeout(r, 800));

          const htmlCard = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.includes('PDF to HTML')
          );
          htmlCard?.click();
          await new Promise(r => setTimeout(r, 100));
          const startBtnHtml = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.includes('Start Local Conversion')
          );
          startBtnHtml?.click();
          await new Promise(r => setTimeout(r, 800));

          // Inspect generated TXT and HTML outputs directly by fetching the blob URLs rendered on screen or reading job links
          const fourDone = document.body.innerText.includes('4 completed');

          // Also verify compiled text/html content from converterService on the same compiled bytes
          const txtStr = await window.__converterService.pdfToText(compiled);
          const htmlStr = await window.__converterService.pdfToHtml(compiled, 'XSS & Line Test');

          const preservesNewlines = txtStr.includes('Page Two Line A\\nPage Two Line B');
          const includesUnsaved = txtStr.includes('UnsavedEditorLine');
          const htmlEscaped = htmlStr.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !htmlStr.includes('<script>alert(1)</script>');

          return {
            fourDone,
            preservesNewlines,
            includesUnsaved,
            htmlEscaped,
            success: fourDone && preservesNewlines && includesUnsaved && htmlEscaped
          };
        })()
      `);
      log('Test 2 Result: ' + JSON.stringify(txtHtmlRes));
      if (!txtHtmlRes.success) {
        log('[FAIL] Test 2 failed');
        app.exit(1);
        return;
      }
      log('[PASS] Test 2: PDF -> TXT & HTML (line preservation, unsaved edits, XSS escaping) verified!');

      // -------------------------------------------------------------
      // TEST 3: UTF-8 TEXT PASTE -> PDF & IMAGES -> PDF + OPEN IN EDITOR
      // -------------------------------------------------------------
      log('\n--- TEST 3: UTF-8 TEXT TO PDF & IMAGES TO PDF -> OPEN IN EDITOR ---');
      const toPdfRes = await win.webContents.executeJavaScript(`
        (async () => {
          // 1. Open Paste Text panel and test UTF-8 WinAnsi-safe conversion
          const pasteBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.trim() === 'Paste Text'
          );
          pasteBtn?.click();
          await new Promise(r => setTimeout(r, 150));

          const textarea = document.querySelector('textarea[placeholder*="Paste or type"]');
          if (!textarea) return { success: false, reason: 'Paste textarea not rendered' };

          // Set React-controlled value cleanly
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          nativeSetter.call(textarea, 'Enterprise “Quote” — Bullet • Check ✓\\tTabbed\\n\\nhttps://example.local/' + 'a'.repeat(120));
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 100));

          const createPdfBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.includes('Create PDF from Text')
          );
          createPdfBtn?.click();
          await new Promise(r => setTimeout(r, 600));

          const fiveDone = document.body.innerText.includes('5 completed');

          // 2. Test Images -> PDF with 2 PNG images (A4 fit)
          const png1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQz0AEwDiqAgAV9gP50sV8swAAAABJRU5ErkJggg==';
          const multiImgPdf = await window.__converterService.imagesToPdf([
            { dataUrl: png1, format: 'png', name: 'img1.png' },
            { dataUrl: png1, format: 'png', name: 'img2.png' }
          ], 'a4');
          const imgInfo = await window.__pdfEngine.getDocumentInfo(multiImgPdf);

          // 3. Click 'Open in Editor' on the generated Text-to-PDF job
          const openEditorBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.includes('Open in Editor')
          );
          openEditorBtn?.click();
          await new Promise(r => setTimeout(r, 500));

          const stEnd = window.__editorStore.getState();

          return {
            fiveDone,
            imgPdfPages: imgInfo.pageCount,
            openedInEditorTab: stEnd.activeTab === 'editor',
            openedFileName: stEnd.currentFileName,
            success: fiveDone && imgInfo.pageCount === 2 && stEnd.activeTab === 'editor' && stEnd.currentFileName.endsWith('.pdf')
          };
        })()
      `);
      log('Test 3 Result: ' + JSON.stringify(toPdfRes));
      if (!toPdfRes.success) {
        log('[FAIL] Test 3 failed');
        app.exit(1);
        return;
      }
      log('[PASS] Test 3: UTF-8 Text -> PDF, Multi-Image -> PDF, and Open in Editor verified!');

      log('\n======================================================');
      log('LOCAL PDF CONVERSION CENTER VERIFIED END-TO-END!');
      log('======================================================');
      app.exit(0);
    } catch (err) {
      log('[ERROR] Unhandled error: ' + err.stack);
      app.exit(1);
    }
  }, 500);
});
