const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const logFile = path.join(__dirname, 'verify-organize-merge.log');
function log(msg) {
  console.log(msg);
  fs.appendFileSync(logFile, msg + '\n');
}
fs.writeFileSync(logFile, 'Starting verification of Organize & Merge Module\n');

setTimeout(() => {
  log('[FAILSAFE] Organize & Merge verification timed out');
  process.exit(1);
}, 25000);

require('../electron/main.cjs');

app.whenReady().then(async () => {
  log('[STEP 1] Electron main ready. Waiting for window to load...');

  const checkReady = setInterval(async () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length === 0) return;

    const win = windows[0];
    if (win.webContents.isLoading()) return;

    clearInterval(checkReady);
    log('[STEP 2] BrowserWindow loaded dist/index.html');

    try {
      // 1. Load test document and switch to Organize view
      log('\n--- TEST 1: LOAD DOCUMENT & OPEN ORGANIZE VIEW ---');
      const fixturePath = path.resolve(__dirname, '../test-fixtures/sample-local.pdf').split(path.sep).join('/');
      
      const initRes = await win.webContents.executeJavaScript(`
        (async () => {
          try {
            const fileRes = await window.electronAPI.openPdfDialog('${fixturePath}');
            await window.__editorStore.getState().loadPdfBytes(
              new Uint8Array(fileRes.data),
              fileRes.name,
              fileRes.filePath
            );
            window.__editorStore.getState().setActiveTab('organize');
            await new Promise(r => setTimeout(r, 1200));

            const state = window.__editorStore.getState();
            const text = document.body.innerText;
            const hasStudio = text.includes('Page Organization Studio');
            const hasPages = text.includes('Total 2 pages');

            return {
              success: true,
              activeTab: state.activeTab,
              pageCount: state.pageCount,
              hasStudio,
              hasPages
            };
          } catch (err) {
            return { success: false, error: err.message };
          }
        })()
      `);

      log('Init Organize View: ' + JSON.stringify(initRes));
      if (!initRes.success || !initRes.hasStudio || initRes.pageCount !== 2) {
        log('[FAIL] Could not initialize Organize view');
        app.exit(1);
        return;
      }
      log('[PASS] Organize Studio successfully loaded with 2 pages displayed');

      // 2. Test Page Rotation
      log('\n--- TEST 2: ROTATE PAGE ---');
      const rotateRes = await win.webContents.executeJavaScript(`
        (async () => {
          try {
            const state = window.__editorStore.getState();
            const initialRotation = state.pageMetas[0]?.rotation || 0;
            
            const rotateButtons = Array.from(document.querySelectorAll('button[title*="Rotate"]'));
            const titles = rotateButtons.map(b => b.title);

            // Find single rotate button for page 1
            const singleRotate = rotateButtons.find(b => b.title.includes('Clockwise') || b.title.includes('Rotate 90'));
            if (singleRotate) {
              singleRotate.click();
              await new Promise(r => setTimeout(r, 2000));
            }

            const newState = window.__editorStore.getState();
            const newRotation = newState.pageMetas[0]?.rotation || 0;

            return {
              success: true,
              titles,
              initialRotation,
              newRotation,
              pageCount: newState.pageCount
            };
          } catch (err) {
            return { success: false, error: err.message };
          }
        })()
      `);

      log('Rotate Page Result: ' + JSON.stringify(rotateRes));
      if (!rotateRes.success || rotateRes.newRotation === rotateRes.initialRotation) {
        log('[FAIL] Page rotation failed');
        app.exit(1);
        return;
      }
      log('[PASS] Page rotated successfully! Rotation changed from ' + rotateRes.initialRotation + '° to ' + rotateRes.newRotation + '°');

      // 3. Test Duplicate Page
      log('\n--- TEST 3: DUPLICATE PAGE ---');
      const dupRes = await win.webContents.executeJavaScript(`
        (async () => {
          try {
            const dupButtons = Array.from(document.querySelectorAll('button[title*="Duplicate"]'));
            if (dupButtons.length === 0) return { success: false, error: 'No duplicate button found' };
            dupButtons[0].click();
            await new Promise(r => setTimeout(r, 1200));

            const state = window.__editorStore.getState();
            return {
              success: true,
              pageCount: state.pageCount,
              statusMessage: state.statusMessage
            };
          } catch (err) {
            return { success: false, error: err.message };
          }
        })()
      `);

      log('Duplicate Page Result: ' + JSON.stringify(dupRes));
      if (!dupRes.success || dupRes.pageCount !== 3) {
        log('[FAIL] Page duplication failed');
        app.exit(1);
        return;
      }
      log('[PASS] Page duplicated successfully! Total pages increased from 2 to ' + dupRes.pageCount);

      // 4. Test Merge PDF Documents
      log('\n--- TEST 4: MERGE PDF DOCUMENTS ---');
      const mergeRes = await win.webContents.executeJavaScript(`
        (async () => {
          try {
            const state = window.__editorStore.getState();
            const currentBytes = state.pdfBytes;
            const currentCount = state.pageCount; // 3

            // Second document bytes from the fixture
            const fileRes = await window.electronAPI.openPdfDialog('${fixturePath}');
            const incomingBytes = new Uint8Array(fileRes.data); // 2 pages

            // Merge current document (3 pages) with incoming document (2 pages) using pdfEngine
            const mergedBytes = await window.__pdfEngine.mergePdfs([currentBytes, incomingBytes]);

            // Load into editor store
            await window.__editorStore.getState().loadPdfBytes(mergedBytes, 'Merged_Test.pdf');
            await new Promise(r => setTimeout(r, 1500));

            const finalState = window.__editorStore.getState();

            return {
              success: true,
              previousCount: currentCount,
              mergedPageCount: finalState.pageCount,
              fileName: finalState.currentFileName
            };
          } catch (err) {
            return { success: false, error: err.message };
          }
        })()
      `);

      log('Merge PDFs Result: ' + JSON.stringify(mergeRes));
      if (!mergeRes.success || mergeRes.mergedPageCount !== 5) {
        log('[FAIL] PDF merge failed');
        app.exit(1);
        return;
      }
      log('[PASS] PDF documents successfully merged! Total pages combined from ' + mergeRes.previousCount + ' to ' + mergeRes.mergedPageCount);

      // 5. Test Page Deletion
      log('\n--- TEST 5: DELETE PAGE ---');
      const deleteRes = await win.webContents.executeJavaScript(`
        (async () => {
          try {
            const deleteButtons = Array.from(document.querySelectorAll('button[title*="Delete Page"]'));
            if (deleteButtons.length === 0) return { success: false, error: 'Delete button not found' };
            deleteButtons[0].click();
            await new Promise(r => setTimeout(r, 1500));

            const state = window.__editorStore.getState();
            return {
              success: true,
              pageCount: state.pageCount,
              statusMessage: state.statusMessage
            };
          } catch (err) {
            return { success: false, error: err.message };
          }
        })()
      `);

      log('Delete Page Result: ' + JSON.stringify(deleteRes));
      if (!deleteRes.success || deleteRes.pageCount !== 4) {
        log('[FAIL] Page deletion failed');
        app.exit(1);
        return;
      }
      log('[PASS] Page deleted successfully! Total pages reduced from 5 to ' + deleteRes.pageCount);

      // 6. Test Split PDF
      log('\n--- TEST 6: SPLIT PDF INTO SINGLE PAGES ---');
      const splitRes = await win.webContents.executeJavaScript(`
        (async () => {
          try {
            const state = window.__editorStore.getState();
            const singlePages = await window.__pdfEngine.splitPdf(state.pdfBytes);

            return {
              success: true,
              splitCount: singlePages.length,
              eachPageValid: singlePages.every(p => p[0] === 0x25 && p[1] === 0x50) // %PDF header
            };
          } catch (err) {
            return { success: false, error: err.message };
          }
        })()
      `);

      log('Split PDF Result: ' + JSON.stringify(splitRes));
      if (!splitRes.success || splitRes.splitCount !== 4 || !splitRes.eachPageValid) {
        log('[FAIL] Split PDF failed');
        app.exit(1);
        return;
      }
      log('[PASS] PDF split successfully into ' + splitRes.splitCount + ' independent valid PDF documents!');

      log('\n================================================================');
      log('ALL VERIFICATIONS PASSED: Organize & Merge module is 100% operational end-to-end!');
      log('================================================================');
      app.exit(0);
    } catch (err) {
      log('[TEST ERROR]: ' + err.message);
      app.exit(1);
    }
  }, 500);
});
