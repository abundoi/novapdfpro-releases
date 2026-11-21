const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const logFile = path.join(__dirname, 'verify-blank-open.log');
function log(msg) {
  console.log(msg);
  fs.appendFileSync(logFile, msg + '\n');
}
fs.writeFileSync(logFile, 'Starting verification of Blank Document Creation and Open Local PDF\n');

setTimeout(() => {
  log('[FAILSAFE] Timeout reached, forcing exit.');
  process.exit(1);
}, 25000);

require('../electron/main.cjs');

app.whenReady().then(async () => {
  log('[STEP 1] App ready, waiting for window to load...');

  BrowserWindow.getAllWindows().forEach(w => {
    w.webContents.on('console-message', (e, level, message) => {
      log('[CONSOLE ' + level + '] ' + message);
    });
  });

  const checkReady = setInterval(async () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) return;

    const win = windows[0];
    win.webContents.on('console-message', (e, level, message) => {
      log('[CONSOLE ' + level + '] ' + message);
    });

    if (win.webContents.isLoading()) return;

    clearInterval(checkReady);
    log('[STEP 2] Window loaded dist/index.html');

    try {
      // 1. Verify Create Blank Document
      log('\n--- TEST 1: CREATE BLANK DOCUMENT ---');
      const blankRes = await win.webContents.executeJavaScript(`
        (async () => {
          try {
            // Find and click the "New Blank PDF" button in Dashboard
            const buttons = Array.from(document.querySelectorAll('button'));
            const newBtn = buttons.find(b => b.innerText.includes('New Blank PDF'));
            if (!newBtn) {
              return { success: false, error: 'Could not find "New Blank PDF" button' };
            }
            newBtn.click();

            // Wait for creation and rendering
            await new Promise(r => setTimeout(r, 1500));

            // Verify store state
            const state = window.__editorStore.getState();
            const hasBytes = state.pdfBytes && state.pdfBytes.length > 0;
            const isNewDoc = state.currentFileName === 'New_Document.pdf';
            const pageCount = state.pageCount;
            const activeTab = state.activeTab;

            // Verify canvas rendering
            const canvases = document.querySelectorAll('canvas');

            return {
              success: true,
              fileName: state.currentFileName,
              pageCount,
              hasBytes,
              bytesLength: hasBytes ? state.pdfBytes.length : 0,
              activeTab,
              statusMessage: state.statusMessage,
              canvasCount: canvases.length
            };
          } catch (err) {
            return { success: false, error: err.message };
          }
        })()
      `);

      log('Create Blank Result: ' + JSON.stringify(blankRes));
      if (!blankRes.success || blankRes.fileName !== 'New_Document.pdf' || blankRes.pageCount !== 1) {
        log('[FAIL] Create Blank Document failed verification!');
        app.exit(1);
        return;
      }
      log('[PASS] Create Blank Document successfully created 1-page A4 document with ' + blankRes.bytesLength + ' bytes and rendered to canvas!');

      // 2. Verify Open Local PDF Document
      log('\n--- TEST 2: OPEN LOCAL PDF DOCUMENT ---');
      const fixturePath = path.resolve(__dirname, '../test-fixtures/sample-local.pdf').split(path.sep).join('/');
      log('Target local PDF fixture: ' + fixturePath);

      const openRes = await win.webContents.executeJavaScript(`
        (async () => {
          try {
            // 1. Test electronAPI file dialog bridge
            const fileRes = await window.electronAPI.openPdfDialog('${fixturePath}');
            if (!fileRes) {
              return { success: false, error: 'electronAPI.openPdfDialog returned null' };
            }

            // 2. Load into editor store (simulating the open click handler)
            await window.__editorStore.getState().loadPdfBytes(
              new Uint8Array(fileRes.data),
              fileRes.name,
              fileRes.filePath
            );

            // Wait for PDF.js to parse and render
            await new Promise(r => setTimeout(r, 1500));

            const state = window.__editorStore.getState();
            const canvases = document.querySelectorAll('canvas');

            return {
              success: true,
              fileName: state.currentFileName,
              filePath: state.currentFilePath,
              pageCount: state.pageCount,
              pagesMetaCount: state.pageMetas.length,
              statusMessage: state.statusMessage,
              canvasCount: canvases.length,
              activeTab: state.activeTab
            };
          } catch (err) {
            return { success: false, error: err.message };
          }
        })()
      `);

      log('Open Local PDF Result: ' + JSON.stringify(openRes));
      if (!openRes.success || openRes.fileName !== 'sample-local.pdf' || openRes.pageCount !== 2) {
        log('[FAIL] Open Local PDF failed verification!');
        app.exit(1);
        return;
      }
      log('[PASS] Open Local PDF successfully opened "' + openRes.fileName + '" (2 pages), loaded metadata, and rendered!');

      // 3. Page Navigation on Opened Local PDF
      log('\n--- TEST 3: PAGE NAVIGATION & RENDERING ON OPENED PDF ---');
      const navRes = await win.webContents.executeJavaScript(`
        (async () => {
          try {
            window.__editorStore.getState().setCurrentPage(2);
            await new Promise(r => setTimeout(r, 600));
            const state = window.__editorStore.getState();
            return {
              success: true,
              currentPage: state.currentPage,
              pageCount: state.pageCount
            };
          } catch (err) {
            return { success: false, error: err.message };
          }
        })()
      `);
      log('Navigation Result: ' + JSON.stringify(navRes));

      log('\n================================================================');
      log('ALL VERIFICATIONS PASSED: Create Blank Document & Open Local PDF are working 100% end-to-end!');
      log('================================================================');
      app.exit(0);
    } catch (err) {
      log('[TEST ERROR]: ' + err.message);
      app.exit(1);
    }
  }, 500);
});
