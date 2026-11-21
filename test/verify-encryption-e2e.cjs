const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const logFile = path.join(__dirname, 'verify-encryption-e2e.log');
function log(msg) {
  console.log(msg);
  fs.appendFileSync(logFile, msg + '\n');
}
fs.writeFileSync(logFile, 'Starting NovaPDFPro Document Encryption E2E Verification\n');

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
      log('[STEP 1] Testing Document Encryption and Password Protection in NovaPDFPro');

      const testResult = await win.webContents.executeJavaScript(`
        (async () => {
          const store = window.__editorStore.getState();
          const engine = window.__pdfEngine;

          // 1. Create a document with confidential text
          await store.createNewDocument('A4');
          store.addTextItem({
            pageIndex: 0,
            x: 80,
            y: 120,
            width: 350,
            height: 30,
            text: 'RESTRICTED EXECUTIVE REPORT - OFFSHORE ACCOUNTS',
            fontSize: 14,
            fontFamily: 'Helvetica',
            color: '#dc2626'
          });

          // 2. Configure encryption with password
          const userPassword = 'TestSecuredPass2026!';
          const ownerPassword = 'AdminMasterKey2026!';

          store.setSecurity({
            userPassword,
            ownerPassword,
            permissions: {
              printing: 'lowResolution',
              copying: false,
              modifying: false
            }
          });

          // 3. Save the encrypted document
          const encryptedBytes = await store.saveCurrentPdf();
          if (!encryptedBytes) throw new Error('Failed to save encrypted PDF');

          const isEnc = engine.isPdfEncrypted(encryptedBytes);
          if (!isEnc) throw new Error('Saved bytes not identified as encrypted');

          // 4. Test loading encrypted PDF without password -> Must prompt!
          await store.loadPdfBytes(encryptedBytes, 'Classified.pdf');
          const stateAfterLoad = window.__editorStore.getState();

          const hasPrompt = Boolean(stateAfterLoad.pendingPasswordPrompt);
          if (!hasPrompt) throw new Error('Expected pendingPasswordPrompt to be active');

          // Check modal in DOM
          await new Promise(r => setTimeout(r, 100));
          const modalTitle = document.querySelector('h3')?.textContent || '';
          const hasModal = modalTitle.includes('Secured PDF Document');

          // 5. Test unlocking with WRONG password -> Must reject and show error!
          const wrongUnlock = await window.__editorStore.getState().unlockPendingDocument('WrongPasswordXYZ');
          if (wrongUnlock) throw new Error('Wrong password should have returned false');

          await new Promise(r => setTimeout(r, 100));
          const stateAfterWrong = window.__editorStore.getState();
          const isMarkedIncorrect = stateAfterWrong.pendingPasswordPrompt?.isIncorrect === true;

          // 6. Test unlocking with CORRECT password -> Must succeed!
          const correctUnlock = await window.__editorStore.getState().unlockPendingDocument(userPassword);
          if (!correctUnlock) throw new Error('Correct password should have unlocked document');

          await new Promise(r => setTimeout(r, 300));
          const stateAfterCorrect = window.__editorStore.getState();
          const modalCleared = stateAfterCorrect.pendingPasswordPrompt === null;
          const docLoaded = Boolean(stateAfterCorrect.pdfDocProxy && stateAfterCorrect.pageCount === 1);
          const passwordStored = stateAfterCorrect.documentPassword === userPassword;

          return {
            isEncrypted: isEnc,
            hasPrompt,
            hasModal,
            wrongRejected: !wrongUnlock,
            isMarkedIncorrect,
            correctUnlocked: correctUnlock,
            modalCleared,
            docLoaded,
            passwordStored,
            pageCount: stateAfterCorrect.pageCount
          };
        })()
      `);

      log('[RESULT] E2E Encryption Test Result: ' + JSON.stringify(testResult, null, 2));

      if (
        testResult.isEncrypted &&
        testResult.hasPrompt &&
        testResult.hasModal &&
        testResult.wrongRejected &&
        testResult.isMarkedIncorrect &&
        testResult.correctUnlocked &&
        testResult.modalCleared &&
        testResult.docLoaded &&
        testResult.passwordStored
      ) {
        log('[SUCCESS] All E2E Document Encryption Checks Passed 100%!');
        setTimeout(() => {
          app.quit();
          process.exit(0);
        }, 500);
      } else {
        log('[FAILURE] Some E2E encryption checks failed!');
        process.exit(1);
      }
    } catch (err) {
      log('[ERROR] ' + err.stack);
      process.exit(1);
    }
  }, 200);
});
