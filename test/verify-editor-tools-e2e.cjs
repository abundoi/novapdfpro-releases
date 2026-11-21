const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const logFile = path.join(__dirname, 'verify-editor-tools.log');
function log(msg) {
  console.log(msg);
  fs.appendFileSync(logFile, msg + '\n');
}
fs.writeFileSync(logFile, 'Starting NovaPDFPro PDF Editor Tools End-to-End Verification\n');

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
      if (level >= 2) log('[CONSOLE_ERR] ' + message);
    });
    log('[STEP 2] BrowserWindow loaded dist/index.html');

    try {
      // -------------------------------------------------------------
      // SETUP: Create Blank Document in PDF Editor
      // -------------------------------------------------------------
      log('\n--- SETUP: CREATE BLANK DOCUMENT ---');
      const setupRes = await win.webContents.executeJavaScript(`
        (async () => {
          const store = window.__editorStore.getState();
          await store.createNewDocument('A4');
          store.setActiveTab('editor');
          await new Promise(r => setTimeout(r, 600));
          return {
            pageCount: window.__editorStore.getState().pageCount,
            activeTab: window.__editorStore.getState().activeTab,
            currentFileName: window.__editorStore.getState().currentFileName
          };
        })()
      `);
      log('Setup Result: ' + JSON.stringify(setupRes));

      // -------------------------------------------------------------
      // TEST 1: ADD TEXT & PREVENT DOUBLE ENTRY WHEN CLOSING BOX
      // -------------------------------------------------------------
      log('\n--- TEST 1: ADD TEXT & PREVENT DOUBLE ENTRY ON CLOSE / X ---');
      const textRes = await win.webContents.executeJavaScript(`
        (async () => {
          const store = window.__editorStore.getState();
          store.setActiveTool('text-add');
          await new Promise(r => setTimeout(r, 150));

          const overlay = document.querySelector('.z-20.pointer-events-auto');
          if (!overlay) return { success: false, reason: 'Overlay not found' };
          const rect = overlay.getBoundingClientRect();

          // 1. Click overlay at (150, 180) to add first text box
          overlay.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + 150,
            clientY: rect.top + 180,
            button: 0
          }));
          overlay.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + 150,
            clientY: rect.top + 180,
            button: 0
          }));
          await new Promise(r => setTimeout(r, 150));

          const countAfterFirstClick = window.__editorStore.getState().textItems.length;
          const firstItemId = window.__editorStore.getState().textItems[0]?.id;
          window.__editorStore.getState().updateTextItem(firstItemId, { text: 'Committed First Entry' });
          await new Promise(r => setTimeout(r, 100));

          // 2. Click outside on overlay at (320, 320) while text box is open in text-add mode
          // This MUST close the active box and switch to 'select' WITHOUT creating a 2nd text box!
          overlay.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + 320,
            clientY: rect.top + 320,
            button: 0
          }));
          overlay.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + 320,
            clientY: rect.top + 320,
            button: 0
          }));
          await new Promise(r => setTimeout(r, 150));

          const countAfterOutsideClose = window.__editorStore.getState().textItems.length;
          const toolAfterOutsideClose = window.__editorStore.getState().activeTool;

          // 3. Switch to text-add again, click to create a 2nd text box, then click its 'X' button
          // Clicking 'X' MUST delete the 2nd box and MUST NOT spawn a new box underneath!
          window.__editorStore.getState().setActiveTool('text-add');
          await new Promise(r => setTimeout(r, 100));
          overlay.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + 200,
            clientY: rect.top + 260,
            button: 0
          }));
          await new Promise(r => setTimeout(r, 150));

          const countBeforeX = window.__editorStore.getState().textItems.length;
          const deleteButtons = Array.from(overlay.querySelectorAll('button[title="Delete text (X)"]'));
          const xBtn = deleteButtons[deleteButtons.length - 1];
          if (xBtn) {
            xBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
            xBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
          }
          await new Promise(r => setTimeout(r, 150));

          const countAfterX = window.__editorStore.getState().textItems.length;

          return {
            countAfterFirstClick,
            countAfterOutsideClose,
            toolAfterOutsideClose,
            countBeforeX,
            countAfterX,
            noDoubleEntryOnOutsideClick: countAfterFirstClick === 1 && countAfterOutsideClose === 1 && toolAfterOutsideClose === 'select',
            noDoubleEntryOnXButton: countBeforeX === 2 && countAfterX === 1,
            success: countAfterFirstClick === 1 && countAfterOutsideClose === 1 && toolAfterOutsideClose === 'select' && countBeforeX === 2 && countAfterX === 1
          };
        })()
      `);
      log('Test 1 Result: ' + JSON.stringify(textRes));
      if (!textRes.success) {
        log('[FAIL] Test 1 failed');
        app.exit(1);
        return;
      }
      log('[PASS] Test 1: Prevent double entry on text box close & X delete verified!');

      // -------------------------------------------------------------
      // TEST 2: SELECT TOOL & SELECTION-BASED OPERATIONS
      // -------------------------------------------------------------
      log('\n--- TEST 2: SELECT TOOL & SELECTION-BASED OPERATIONS ---');
      const selectOpsRes = await win.webContents.executeJavaScript(`
        (async () => {
          const store = window.__editorStore.getState();
          const item = store.textItems[0];
          store.setActiveTool('select');
          store.selectItem(item.id, 'text');
          await new Promise(r => setTimeout(r, 150));

          // Verify changing active properties updates the selected text item directly
          store.setActiveFontSize(22);
          store.setActiveColor('#2563eb');
          store.setActiveFontFamily('Courier');
          await new Promise(r => setTimeout(r, 150));

          const updated = window.__editorStore.getState().textItems.find(t => t.id === item.id);
          return {
            selectedItemId: window.__editorStore.getState().selectedItemId,
            fontSize: updated?.fontSize,
            color: updated?.color,
            fontFamily: updated?.fontFamily,
            success: updated?.fontSize === 22 && updated?.color === '#2563eb' && updated?.fontFamily === 'Courier'
          };
        })()
      `);
      log('Test 2 Result: ' + JSON.stringify(selectOpsRes));
      if (!selectOpsRes.success) {
        log('[FAIL] Test 2 failed');
        app.exit(1);
        return;
      }
      log('[PASS] Test 2: Selection-based property operations verified!');

      // -------------------------------------------------------------
      // TEST 3: EDIT EXISTING TEXT ('text-edit') ON BAKED PDF TEXT
      // -------------------------------------------------------------
      log('\n--- TEST 3: EDIT EXISTING NATIVE PDF TEXT (text-edit) ---');
      const editExistingRes = await win.webContents.executeJavaScript(`
        (async () => {
          const store = window.__editorStore.getState();
          // Save the current PDF so text becomes native embedded PDF text (saveCurrentPdf automatically reloads pdfDocProxy)
          await store.saveCurrentPdf();
          await new Promise(r => setTimeout(r, 800));

          // Switch to 'text-edit' tool
          window.__editorStore.getState().setActiveTool('text-edit');
          await new Promise(r => setTimeout(r, 250));

          const overlay = document.querySelector('.z-20.pointer-events-auto');
          const nativeTextBoxes = overlay ? Array.from(overlay.querySelectorAll('div.border-dashed')) : [];
          if (nativeTextBoxes.length === 0) {
            return { success: false, reason: 'No native PDF text boxes rendered in overlay for text-edit' };
          }

          // Click the native PDF text box to edit existing text inline
          nativeTextBoxes[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
          nativeTextBoxes[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
          await new Promise(r => setTimeout(r, 200));

          const stateAfterClick = window.__editorStore.getState();
          const replacementItem = stateAfterClick.textItems.find(t => t.isRedactionReplacement);

          // Update the replacement text cleanly and commit
          if (replacementItem) {
            stateAfterClick.updateTextItem(replacementItem.id, { text: 'Edited Existing Native Text' });
          }
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await new Promise(r => setTimeout(r, 150));
          const updatedReplacement = window.__editorStore.getState().textItems.find(t => t.isRedactionReplacement);

          return {
            nativeTextCountFound: nativeTextBoxes.length,
            replacementCreated: !!replacementItem,
            originalDetectedText: replacementItem?.originalText,
            updatedText: updatedReplacement?.text,
            success: nativeTextBoxes.length > 0 && !!replacementItem && updatedReplacement?.text === 'Edited Existing Native Text'
          };
        })()
      `);
      log('Test 3 Result: ' + JSON.stringify(editExistingRes));
      if (!editExistingRes.success) {
        log('[FAIL] Test 3 failed');
        app.exit(1);
        return;
      }
      log('[PASS] Test 3: Edit Existing Native PDF Text verified!');

      // -------------------------------------------------------------
      // TEST 4: INSERT IMAGE, AUTO-SELECT, RESIZE/ROTATE & DELETE
      // -------------------------------------------------------------
      log('\n--- TEST 4: INSERT IMAGE & SELECTION OPERATIONS ---');
      const imageRes = await win.webContents.executeJavaScript(`
        (async () => {
          const store = window.__editorStore.getState();
          // Valid 1x1 blue PNG data URL
          const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
          store.addImageItem({
            pageIndex: 0,
            x: 100,
            y: 250,
            width: 180,
            height: 120,
            dataUrl: pngDataUrl,
            mimeType: 'image/png',
            opacity: 1,
            rotation: 0,
          });
          await new Promise(r => setTimeout(r, 200));

          const st1 = window.__editorStore.getState();
          const img = st1.imageItems[0];
          const autoSelected = st1.activeTool === 'select' && st1.selectedItemId === img?.id && st1.selectedItemType === 'image';

          // Resize & Rotate selected image
          st1.updateImageItem(img.id, { width: 220, height: 150, rotation: 90 });
          await new Promise(r => setTimeout(r, 150));
          const updatedImg = window.__editorStore.getState().imageItems[0];

          // Export PDF with image to verify PDF engine compatibility
          const savedWithImg = await window.__editorStore.getState().saveCurrentPdf();

          // Delete image via X
          window.__editorStore.getState().deleteImageItem(img.id);
          await new Promise(r => setTimeout(r, 150));
          const remainingImages = window.__editorStore.getState().imageItems.length;

          return {
            imageAdded: !!img,
            autoSelected,
            updatedWidth: updatedImg?.width,
            updatedRotation: updatedImg?.rotation,
            pdfSavedBytes: savedWithImg?.length || 0,
            remainingImages,
            success: !!img && autoSelected && updatedImg?.width === 220 && updatedImg?.rotation === 90 && savedWithImg?.length > 500 && remainingImages === 0
          };
        })()
      `);
      log('Test 4 Result: ' + JSON.stringify(imageRes));
      if (!imageRes.success) {
        log('[FAIL] Test 4 failed');
        app.exit(1);
        return;
      }
      log('[PASS] Test 4: Insert Image, auto-select, resize/rotate, PDF save & delete verified!');

      // -------------------------------------------------------------
      // TEST 5: HAND / PAN TOOL AT 100% ZOOM & 250% ZOOM
      // -------------------------------------------------------------
      log('\n--- TEST 5: HAND / PAN TOOL (100% & 250% ZOOM) ---');
      const panRes = await win.webContents.executeJavaScript(`
        (async () => {
          const store = window.__editorStore;
          store.getState().setActiveTool('hand');
          store.getState().setZoom(1.0);
          await new Promise(r => setTimeout(r, 200));

          const overlay = document.querySelector('.z-20.pointer-events-auto');
          const pageWrapper = document.querySelector('.relative.shadow-2xl.bg-white');
          if (!overlay || !pageWrapper) {
            return {
              success: false,
              reason: 'Overlay or page wrapper not found',
              hasOverlay: !!overlay,
              hasPageWrapper: !!pageWrapper,
              activeTab: store.getState().activeTab,
              hasPdfBytes: !!store.getState().pdfBytes
            };
          }

          // Simulate drag pan at 100% zoom
          overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 400, clientY: 400, button: 0 }));
          await new Promise(r => setTimeout(r, 60));
          window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: 460, clientY: 445 }));
          await new Promise(r => setTimeout(r, 60));
          window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 460, clientY: 445 }));
          await new Promise(r => setTimeout(r, 150));

          const transformAt100 = pageWrapper.style.transform;

          // Also verify scroll pan at 250% zoom
          store.getState().setZoom(2.5);
          await new Promise(r => setTimeout(r, 300));
          const container = document.querySelector('.overflow-auto.bg-slate-950');
          container.scrollLeft = 90;
          container.scrollTop = 110;
          await new Promise(r => setTimeout(r, 100));

          const newScrollLeft = container.scrollLeft;
          const newScrollTop = container.scrollTop;

          store.getState().setZoom(1.0);
          store.getState().setActiveTool('select');

          return {
            transformAt100,
            pannedAt100: transformAt100.includes('translate(') && !transformAt100.includes('translate(0px, 0px)'),
            newScrollLeft,
            newScrollTop,
            pannedAt250: newScrollLeft > 0 && newScrollTop > 0,
            success: transformAt100.includes('translate(') && !transformAt100.includes('translate(0px, 0px)') && newScrollLeft > 0 && newScrollTop > 0
          };
        })()
      `);
      log('Test 5 Result: ' + JSON.stringify(panRes));
      if (!panRes.success) {
        log('[FAIL] Test 5 failed');
        app.exit(1);
        return;
      }
      log('[PASS] Test 5: Hand / Pan Tool verified at both 100% and 250% zoom!');

      // -------------------------------------------------------------
      // TEST 6: ENTERPRISE STAMP TOOL (FLOATING PICKER, CUSTOM, CONTEXTUAL BAR, EXPORT, DELETE X)
      // -------------------------------------------------------------
      log('\n--- TEST 6: ENTERPRISE STAMP TOOL (FLOATING PICKER, CONTEXTUAL CONTROLS, PDF SAVE, DELETE X) ---');
      const stampRes = await win.webContents.executeJavaScript(`
        (async () => {
          const store = window.__editorStore;
          store.getState().setActiveTool('stamp');
          await new Promise(r => setTimeout(r, 150));

          const overlay = document.querySelector('.z-20.pointer-events-auto');
          if (!overlay) return { success: false, reason: 'Overlay not found' };
          const rect = overlay.getBoundingClientRect();

          // 1. Click on overlay to open Floating Stamp Selection Popover
          overlay.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + 160,
            clientY: rect.top + 200,
            button: 0
          }));
          await new Promise(r => setTimeout(r, 150));

          const popoverVisible = document.body.innerText.includes('Insert Enterprise Stamp');
          const confidentialBtn = Array.from(overlay.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.trim() === 'CONFIDENTIAL'
          );
          if (!popoverVisible || !confidentialBtn) {
            return { success: false, reason: 'Floating Stamp Popover or CONFIDENTIAL button not rendered', popoverVisible };
          }

          // 2. Dispatch real mousedown + click on CONFIDENTIAL (must NOT disappear on mousedown before click!)
          confidentialBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
          confidentialBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
          await new Promise(r => setTimeout(r, 200));

          const stAfterPreset = store.getState();
          const createdStamp = stAfterPreset.annotations.find(a => a.type === 'stamp');
          const toolSwitchedToSelect = stAfterPreset.activeTool === 'select';
          const stampSelected = stAfterPreset.selectedItemId === createdStamp?.id;
          const contextualToolbarVisible = !!document.querySelector('select[title="Switch Stamp Preset"]') &&
            !!document.querySelector('select[title="Stamp Visual Style"]');

          if (!createdStamp) {
            return { success: false, reason: 'Clicking CONFIDENTIAL preset inside floating popover failed to create stamp' };
          }

          // 3. Test custom style, rotation, timestamp toggle, and label edit
          store.getState().updateAnnotation(createdStamp.id, {
            stampLabel: 'FINAL COMPLIANCE VERIFIED',
            stampStyle: 'solid',
            rotation: -10,
            showTimestamp: true
          });
          await new Promise(r => setTimeout(r, 150));

          const updatedStamp = store.getState().annotations.find(a => a.id === createdStamp.id);
          const renderedHasRotation = Array.from(overlay.querySelectorAll('div')).some(
            d => d.style && d.style.transform && d.style.transform.includes('rotate(-10deg)')
          );

          // 4. Delete via 'X' button on the stamp
          const deleteStampBtn = overlay.querySelector('button[title="Delete stamp (X)"]');
          if (!deleteStampBtn) {
            return { success: false, reason: 'Delete stamp (X) button missing on selected stamp' };
          }
          deleteStampBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
          deleteStampBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
          await new Promise(r => setTimeout(r, 150));

          const remainingStampsAfterDelete = store.getState().annotations.filter(a => a.type === 'stamp').length;

          // 5. Re-add rotated solid stamp and verify saveCurrentPdf() exports cleanly
          store.getState().addAnnotation({
            pageIndex: 0,
            type: 'stamp',
            rect: { x: 140, y: 220, width: 190, height: 50 },
            color: '#10b981',
            stampType: 'APPROVED',
            stampLabel: 'APPROVED FOR PRODUCTION',
            stampStyle: 'classic',
            rotation: -8,
            showTimestamp: true,
            opacity: 0.95
          });
          await new Promise(r => setTimeout(r, 150));
          const savedPdfWithStamp = await store.getState().saveCurrentPdf();

          return {
            popoverVisible,
            createdLabel: createdStamp.stampLabel,
            toolSwitchedToSelect,
            stampSelected,
            contextualToolbarVisible,
            updatedLabel: updatedStamp?.stampLabel,
            renderedHasRotation,
            remainingStampsAfterDelete,
            savedPdfBytes: savedPdfWithStamp?.length || 0,
            success: popoverVisible &&
              createdStamp.stampLabel === 'CONFIDENTIAL' &&
              toolSwitchedToSelect &&
              stampSelected &&
              contextualToolbarVisible &&
              updatedStamp?.stampLabel === 'FINAL COMPLIANCE VERIFIED' &&
              renderedHasRotation &&
              remainingStampsAfterDelete === 0 &&
              (savedPdfWithStamp?.length || 0) > 500
          };
        })()
      `);
      log('Test 6 Result: ' + JSON.stringify(stampRes));
      if (!stampRes.success) {
        log('[FAIL] Test 6 failed');
        app.exit(1);
        return;
      }
      log('[PASS] Test 6: Enterprise Stamp Tool verified end-to-end!');

      // -------------------------------------------------------------
      // TEST 7: ELECTRONIC & DIGITAL SIGNATURES (FORM FIELD -> STUDIO -> DRAW/TYPE -> REAL SHA-256 SEAL -> SAVE)
      // -------------------------------------------------------------
      log('\n--- TEST 7: ELECTRONIC & DIGITAL SIGNATURE ENVIRONMENTS ---');
      const sigRes = await win.webContents.executeJavaScript(`
        (async () => {
          const store = window.__editorStore;

          // 1. Place interactive Signature Form Field on page 1 and click 'Sign'
          store.getState().setActiveTool('form-signature');
          await new Promise(r => setTimeout(r, 120));
          const overlay = document.querySelector('.z-20.pointer-events-auto');
          if (!overlay) return { success: false, reason: 'Overlay not found' };
          const rect = overlay.getBoundingClientRect();

          overlay.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + 140,
            clientY: rect.top + 380,
            button: 0
          }));
          await new Promise(r => setTimeout(r, 150));

          const signFieldPlaced = store.getState().formFields.some(f => f.type === 'signature');
          const signBtn = Array.from(overlay.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.trim() === 'Sign'
          );
          if (!signFieldPlaced || !signBtn) {
            return { success: false, reason: 'Signature form field or Sign button missing', signFieldPlaced };
          }

          signBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
          signBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
          await new Promise(r => setTimeout(r, 250));

          const openedSignaturesTab = store.getState().activeTab === 'signatures';
          const hasPendingTarget = !!store.getState().pendingSignatureTarget;
          const docHashShown = document.body.innerText.includes('Doc SHA-256');

          // 2. Draw signature accurately on canvas with pointer events
          const sigCanvas = document.querySelector('canvas.cursor-crosshair');
          if (!sigCanvas) return { success: false, reason: 'Signature draw canvas not found' };
          const cRect = sigCanvas.getBoundingClientRect();

          sigCanvas.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, cancelable: true, clientX: cRect.left + 40, clientY: cRect.top + 50, pointerId: 1
          }));
          sigCanvas.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, cancelable: true, clientX: cRect.left + 120, clientY: cRect.top + 85, pointerId: 1
          }));
          sigCanvas.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, cancelable: true, clientX: cRect.left + 210, clientY: cRect.top + 45, pointerId: 1
          }));
          sigCanvas.dispatchEvent(new PointerEvent('pointerup', {
            bubbles: true, cancelable: true, clientX: cRect.left + 210, clientY: cRect.top + 45, pointerId: 1
          }));
          await new Promise(r => setTimeout(r, 150));

          // Save drawn signature to Library
          const saveLibBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.includes('Save to Signature Library')
          );
          if (!saveLibBtn || saveLibBtn.disabled) {
            return { success: false, reason: 'Drawn stroke did not enable Save to Signature Library' };
          }
          saveLibBtn.click();
          await new Promise(r => setTimeout(r, 150));

          // 3. Switch to Type Signature tab, type signature, and insert with SHA-256 seal
          const typeTabBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.includes('Type Signature')
          );
          typeTabBtn?.click();
          await new Promise(r => setTimeout(r, 150));

          const insertSigBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.includes('Sign Field on Page 1')
          );
          if (!insertSigBtn || insertSigBtn.disabled) {
            return { success: false, reason: 'Insert signature button missing or disabled in Type mode' };
          }
          insertSigBtn.click();
          await new Promise(r => setTimeout(r, 400));

          const stAfterSign = store.getState();
          const backToEditor = stAfterSign.activeTab === 'editor';
          const signatureImg = stAfterSign.imageItems.find(i => i.name.includes('Signature_'));
          const placeholderRemoved = stAfterSign.formFields.filter(f => f.type === 'signature').length === 0;
          const shaSealStamp = stAfterSign.annotations.find(
            a => a.type === 'stamp' && /^SHA256:[0-9A-F]{10}$/.test(a.stampLabel || '')
          );

          // Rotate signature 15deg and export PDF cleanly
          if (signatureImg) {
            stAfterSign.updateImageItem(signatureImg.id, { rotation: 15 });
          }
          await new Promise(r => setTimeout(r, 100));
          const signedPdfBytes = await store.getState().saveCurrentPdf();

          return {
            openedSignaturesTab,
            hasPendingTarget,
            docHashShown,
            savedLibraryCount: JSON.parse(localStorage.getItem('novapdfpro_saved_signatures_v2') || '[]').length,
            backToEditor,
            signaturePlaced: !!signatureImg,
            signatureDims: signatureImg ? { w: signatureImg.width, h: signatureImg.height } : null,
            placeholderRemoved,
            shaSealLabel: shaSealStamp?.stampLabel || null,
            signedPdfBytes: signedPdfBytes?.length || 0,
            success: openedSignaturesTab &&
              hasPendingTarget &&
              docHashShown &&
              backToEditor &&
              !!signatureImg &&
              placeholderRemoved &&
              !!shaSealStamp &&
              (signedPdfBytes?.length || 0) > 1000
          };
        })()
      `);
      log('Test 7 Result: ' + JSON.stringify(sigRes));
      if (!sigRes.success) {
        log('[FAIL] Test 7 failed');
        app.exit(1);
        return;
      }
      log('[PASS] Test 7: Electronic & Digital Signatures (Form Field -> Draw/Type -> Real SHA-256 Seal -> PDF Export) verified end-to-end!');

      log('\n======================================================');
      log('ALL PDF EDITOR TOOLS & UX VERIFIED END-TO-END SUCCESSFULLY!');
      log('======================================================');
      app.exit(0);

    } catch (err) {
      log('[ERROR] Unhandled error during verification: ' + err.stack);
      app.exit(1);
    }
  }, 500);
});
