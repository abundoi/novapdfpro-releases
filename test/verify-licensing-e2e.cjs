const { app, BrowserWindow } = require('electron');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const fs = require('node:fs');

const PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEILFLxymdIoxHdF3nWLsvGoTqcdlQdxV5Am05ls3o7tUf
-----END PRIVATE KEY-----`;

process.env.NOVAPDFPRO_LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA82AZq0V9yzz2hZN9izWpUvQPloX/xNVdjrHlb73C2RQ=
-----END PUBLIC KEY-----`;

const logFile = path.join(__dirname, 'verify-licensing.log');
function log(msg) {
  console.log(msg);
  fs.appendFileSync(logFile, msg + '\n');
}
fs.writeFileSync(logFile, 'Starting NovaPDFPro Subscription & Offline Licensing E2E Verification\n');

setTimeout(() => {
  log('[FAILSAFE] Verification timed out after 60 seconds');
  process.exit(1);
}, 60000);

process.env.NOVAPDFPRO_E2E_TEST = '1';
require('../electron/main.cjs');

app.whenReady().then(() => {
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

    try {
      // 1. Check Initial Trial & Machine Fingerprint
      log('\n--- TEST 1: INITIAL TRIAL STATE & TITLEBAR BADGE ---');
      const initRes = await win.webContents.executeJavaScript(`
        (async () => {
          await window.__licenseStore.getState().setModeForTesting('TRIAL');
          await new Promise(r => setTimeout(r, 150));
          const st = window.__licenseStore.getState();
          return {
            tier: st.tier,
            trialDaysRemaining: st.trialDaysRemaining,
            hasEnt: st.hasEntitlement('ocr'),
            machineFingerprint: st.machineFingerprint,
            titleHasTrial: document.body.innerText.includes('PRO TRIAL'),
            titleHasVersion: document.body.innerText.includes('v01.31')
          };
        })()
      `);
      log('Test 1 Result: ' + JSON.stringify(initRes));
      if (initRes.tier !== 'TRIAL' || !initRes.hasEnt || !initRes.titleHasTrial || !initRes.titleHasVersion) {
        log('[FAIL] Test 1 failed');
        app.exit(1);
        return;
      }
      log('[PASS] Test 1: Trial mode & TitleBar badge verified!');

      // 2. Test FREE Reader Mode Feature Gating & License Modal Trigger
      log('\n--- TEST 2: FREE READER MODE GATING & PRO LOCK BANNER ---');
      const freeRes = await win.webContents.executeJavaScript(`
        (async () => {
          const store = window.__editorStore.getState();
          await store.createNewDocument('A4');
          store.setActiveTab('editor');
          await window.__licenseStore.getState().setModeForTesting('FREE');
          await new Promise(r => setTimeout(r, 200));

          const st = window.__licenseStore.getState();
          const hasFreeViewEnt = !st.hasEntitlement('text_edit');
          const titleHasUpgrade = document.body.innerText.includes('FREE (READ-ONLY) • UPGRADE');
          const toolbarHasReadOnly = document.body.innerText.includes('READ-ONLY');
          const noProfileRoleInTitle = !document.body.innerText.includes('sysadmin') && !document.body.innerText.includes('User Profiles');

          // Clicking gated 'Edit Existing Text' button must open LicenseModal without switching tool
          const editBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.includes('Edit Existing Text')
          );
          editBtn?.click();
          await new Promise(r => setTimeout(r, 150));

          const modalOpened = window.__licenseStore.getState().isModalOpen;
          const modalTextShown = document.body.innerText.includes('Edit Existing PDF Text requires NovaPDFPro');
          window.__licenseStore.getState().closeLicenseModal();

          // Annotate Highlight button must also be read-only gated in FREE mode
          const annotateTabBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.includes('Annotate & Mark')
          );
          annotateTabBtn?.click();
          await new Promise(r => setTimeout(r, 100));
          const highlightBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.includes('Highlight')
          );
          highlightBtn?.click();
          await new Promise(r => setTimeout(r, 150));
          const highlightGated = window.__licenseStore.getState().isModalOpen && window.__editorStore.getState().activeTool !== 'highlight';
          window.__licenseStore.getState().closeLicenseModal();

          // Navigating to OCR tab in FREE mode renders lock gate cleanly
          store.setActiveTab('ocr');
          await new Promise(r => setTimeout(r, 150));
          const ocrLockedBanner = document.body.innerText.includes('Offline OCR Recognition — NovaPDFPro Feature');

          return {
            hasFreeViewEnt,
            titleHasUpgrade,
            toolbarHasReadOnly,
            noProfileRoleInTitle,
            modalOpened,
            modalTextShown,
            highlightGated,
            ocrLockedBanner,
            success: hasFreeViewEnt && titleHasUpgrade && toolbarHasReadOnly && noProfileRoleInTitle && modalOpened && modalTextShown && highlightGated && ocrLockedBanner
          };
        })()
      `);
      log('Test 2 Result: ' + JSON.stringify(freeRes));
      if (!freeRes.success) {
        log('[FAIL] Test 2 failed');
        app.exit(1);
        return;
      }
      log('[PASS] Test 2: Free Reader gating & Upgrade modal verified!');

      // 3. Test Signed Ed25519 Offline License Token Activation & Tamper Rejection
      log('\n--- TEST 3: ED25519 OFFLINE TOKEN VERIFICATION & PRO UNLOCK ---');
      const nowSec = Math.floor(Date.now() / 1000);
      const makeToken = (fp) => {
        const payload = {
          licenseId: 'lic_e2e_pro',
          licenseKeyMasked: 'NOVA-PRO1-****-****-9999',
          email: 'enterprise@novapdfpro.com',
          plan: 'PRO_ANNUAL',
          status: 'ACTIVE',
          machineFingerprint: fp,
          maxSeats: 2,
          issuedAt: nowSec,
          currentPeriodEnd: nowSec + 86400 * 365,
          offlineValidUntil: nowSec + 86400 * 30,
        };
        const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
        const sig = crypto.sign(null, Buffer.from(encoded, 'utf8'), PRIVATE_KEY_PEM);
        return `${encoded}.${sig.toString('base64url')}`;
      };

      const validToken = makeToken(initRes.machineFingerprint);
      const wrongMachineToken = makeToken('different-machine-fingerprint-999');

      const proRes = await win.webContents.executeJavaScript(`
        (async () => {
          const ls = window.__licenseStore.getState();

          // Reject token signed for another machine
          const badRes = await ls.importOfflineToken(${JSON.stringify(wrongMachineToken)});

          // Reject tampered token
          const parts = ${JSON.stringify(validToken)}.split('.');
          const tampered = parts[0].slice(0, -2) + 'AA.' + parts[1];
          const tamperRes = await ls.importOfflineToken(tampered);

          // Accept valid signed token
          const okRes = await ls.importOfflineToken(${JSON.stringify(validToken)});
          await new Promise(r => setTimeout(r, 200));

          const stAfter = window.__licenseStore.getState();
          const ocrUnlocked = document.body.innerText.includes('Offline Optical Character Recognition (OCR)');

          // Verify SecurityView no longer has User Profiles & Roles
          window.__editorStore.getState().setActiveTab('security');
          await new Promise(r => setTimeout(r, 150));
          const secHasEncrypt = document.body.innerText.includes('Document Encryption');
          const secNoProfilesOrRoles = !document.body.innerText.includes('User Profiles & Roles') && !document.body.innerText.includes('Role Permissions Matrix');

          // Deactivate & restore clean Trial
          await stAfter.deactivate();
          await window.__licenseStore.getState().setModeForTesting('TRIAL');

          return {
            wrongMachineRejected: !badRes.success,
            tamperedRejected: !tamperRes.success,
            validAccepted: okRes.success,
            tier: stAfter.tier,
            email: stAfter.email,
            ocrUnlocked,
            secHasEncrypt,
            secNoProfilesOrRoles,
            success: !badRes.success && !tamperRes.success && okRes.success && stAfter.tier === 'PRO' && ocrUnlocked && secHasEncrypt && secNoProfilesOrRoles
          };
        })()
      `);
      log('Test 3 Result: ' + JSON.stringify(proRes));
      if (!proRes.success) {
        log('[FAIL] Test 3 failed');
        app.exit(1);
        return;
      }
      log('[PASS] Test 3: Ed25519 Offline Token verification, tamper rejection & Pro unlock verified!');

      // 4. Test Server-Anchored 14-Day No-Card Trial Sync & Expiry Lock + Stripe Pricing Copy
      log('\n--- TEST 4: SERVER-ANCHORED 14-DAY NO-CARD TRIAL SYNC & EXPIRY LOCK ---');
      let mockTrialMode = 'active';
      const origHttpRequest = http.request.bind(http);
      const mockPortalUrl = 'http://127.0.0.1:19999';

      http.request = (urlOrOpts, optionsOrCb, maybeCb) => {
        const urlStr = typeof urlOrOpts === 'string' ? urlOrOpts : urlOrOpts.href || String(urlOrOpts);
        if (!urlStr.startsWith(mockPortalUrl)) {
          return origHttpRequest(urlOrOpts, optionsOrCb, maybeCb);
        }
        const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
        const reqEmitter = new EventEmitter();
        let reqBody = '';
        reqEmitter.write = (chunk) => {
          reqBody += String(chunk);
        };
        reqEmitter.destroy = () => {};
        reqEmitter.end = () => {
          process.nextTick(() => {
            const parsed = JSON.parse(reqBody || '{}');
            const nowSec2 = Math.floor(Date.now() / 1000);
            const resEmitter = new EventEmitter();
            let payloadStr = '{}';
            if (mockTrialMode === 'expired') {
              resEmitter.statusCode = 403;
              payloadStr = JSON.stringify({ expired: true, trialEndsAt: nowSec2 - 10, trialDaysRemaining: 0 });
            } else {
              resEmitter.statusCode = 200;
              const endsSec = nowSec2 + 14 * 86400;
              const trialPayload = {
                licenseId: 'trial_e2e_1',
                licenseKeyMasked: 'NOVA-TRIAL-14DAY',
                email: 'trial@novapdfpro.local',
                plan: 'PRO_MONTHLY',
                status: 'TRIALING',
                machineFingerprint: parsed.machineFingerprint,
                maxSeats: 1,
                issuedAt: nowSec2,
                currentPeriodEnd: endsSec,
                offlineValidUntil: endsSec,
              };
              const enc = Buffer.from(JSON.stringify(trialPayload), 'utf8').toString('base64url');
              const sig2 = crypto.sign(null, Buffer.from(enc, 'utf8'), PRIVATE_KEY_PEM);
              payloadStr = JSON.stringify({
                token: `${enc}.${sig2.toString('base64url')}`,
                trialEndsAt: endsSec,
                trialDaysRemaining: 14,
              });
            }
            if (cb) cb(resEmitter);
            resEmitter.emit('data', Buffer.from(payloadStr));
            resEmitter.emit('end');
          });
        };
        return reqEmitter;
      };

      const trialSyncActive = await win.webContents.executeJavaScript(`
        (async () => {
          await window.__licenseStore.getState().setModeForTesting('TRIAL');
          const res = await window.electronAPI.licenseSyncTrial({ portalUrl: ${JSON.stringify(mockPortalUrl)} });
          window.__licenseStore.getState().openLicenseModal();
          await new Promise(r => setTimeout(r, 150));
          const hasStripeCopy =
            document.body.innerText.includes('$2.99/mo') &&
            document.body.innerText.includes('14-day Free Pro Trial') &&
            !document.body.innerText.includes('Portal URL');
          window.__licenseStore.getState().closeLicenseModal();
          return {
            success: res.success,
            tier: res.status?.tier,
            trialAnchored: res.status?.trialAnchored,
            trialDaysRemaining: res.status?.trialDaysRemaining,
            hasStripeCopy,
          };
        })()
      `);
      log('Test 4a Result (active server trial): ' + JSON.stringify(trialSyncActive));

      mockTrialMode = 'expired';
      const trialSyncExpired = await win.webContents.executeJavaScript(`
        (async () => {
          const res = await window.electronAPI.licenseSyncTrial({ portalUrl: ${JSON.stringify(mockPortalUrl)} });
          await window.__licenseStore.getState().setModeForTesting('TRIAL');
          return {
            expiredFlag: res.expired,
            tier: res.status?.tier,
            trialExpired: res.status?.trialExpired,
          };
        })()
      `);
      log('Test 4b Result (expired server trial lock): ' + JSON.stringify(trialSyncExpired));
      http.request = origHttpRequest;

      if (
        !trialSyncActive.success ||
        trialSyncActive.tier !== 'TRIAL' ||
        !trialSyncActive.trialAnchored ||
        !trialSyncActive.hasStripeCopy ||
        !trialSyncExpired.expiredFlag ||
        trialSyncExpired.tier !== 'FREE'
      ) {
        log('[FAIL] Test 4 failed');
        app.exit(1);
        return;
      }
      log('[PASS] Test 4: Server-anchored 14-day trial sync, expiry lock & Stripe pricing copy verified!');

      // 5. Test Base44 Function Routing (/functions/*), Uppercase Fingerprint, ISO Timestamps & Default Domain
      log('\n--- TEST 5: BASE44 PRODUCTION DOMAIN & PAYLOAD COMPATIBILITY ---');
      const origHttpsRequest = https.request.bind(https);
      const hitPaths = [];
      https.request = (urlOrOpts, optionsOrCb, maybeCb) => {
        const urlStr = typeof urlOrOpts === 'string' ? urlOrOpts : urlOrOpts.href || String(urlOrOpts);
        if (!urlStr.startsWith('https://novapdf.appmys.com')) {
          return origHttpsRequest(urlOrOpts, optionsOrCb, maybeCb);
        }
        const u = new URL(urlStr);
        hitPaths.push(u.pathname);
        const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
        const reqEmitter = new EventEmitter();
        let reqBody = '';
        reqEmitter.write = (chunk) => {
          reqBody += String(chunk);
        };
        reqEmitter.destroy = () => {};
        reqEmitter.end = () => {
          process.nextTick(() => {
            const parsed = JSON.parse(reqBody || '{}');
            const nowMs = Date.now();
            const resEmitter = new EventEmitter();
            resEmitter.statusCode = 200;
            const upperFp = String(parsed.machineFingerprint || '').toUpperCase();
            let respObj = {};
            if (u.pathname === '/functions/licenseTrial') {
              const trialEndsIso = new Date(nowMs + 14 * 86400 * 1000).toISOString();
              const trialPayload = {
                status: 'TRIALING',
                plan: 'PRO_TRIAL',
                licenseKey: null,
                machineFingerprint: upperFp,
                deviceName: parsed.deviceName || 'Windows PC',
                trialEndsAt: trialEndsIso,
                offlineValidUntil: trialEndsIso,
                issuedAt: new Date(nowMs).toISOString(),
              };
              const enc = Buffer.from(JSON.stringify(trialPayload), 'utf8').toString('base64url');
              const sig = crypto.sign(null, Buffer.from(enc, 'utf8'), PRIVATE_KEY_PEM);
              respObj = {
                token: `${enc}.${sig.toString('base64url')}`,
                status: 'TRIALING',
                plan: 'PRO_TRIAL',
                trialEndsAt: trialEndsIso,
                offlineValidUntil: trialEndsIso,
              };
            } else if (u.pathname === '/functions/licenseActivate') {
              const endIso = new Date(nowMs + 365 * 86400 * 1000).toISOString();
              const offlineIso = new Date(nowMs + 30 * 86400 * 1000).toISOString();
              const actPayload = {
                status: 'ACTIVE',
                plan: 'PRO_ANNUAL',
                licenseId: 'b44_lic_1',
                licenseKey: parsed.licenseKey,
                machineFingerprint: upperFp,
                maxSeats: 2,
                offlineValidUntil: offlineIso,
                issuedAt: new Date(nowMs).toISOString(),
              };
              const enc = Buffer.from(JSON.stringify(actPayload), 'utf8').toString('base64url');
              const sig = crypto.sign(null, Buffer.from(enc, 'utf8'), PRIVATE_KEY_PEM);
              respObj = {
                token: `${enc}.${sig.toString('base64url')}`,
                status: 'ACTIVE',
                plan: 'PRO_ANNUAL',
                licenseKey: parsed.licenseKey,
                maxSeats: 2,
                seatsUsed: 1,
                currentPeriodEnd: endIso,
                offlineValidUntil: offlineIso,
              };
            }
            if (cb) cb(resEmitter);
            resEmitter.emit('data', Buffer.from(JSON.stringify(respObj)));
            resEmitter.emit('end');
          });
        };
        return reqEmitter;
      };

      const b44Res = await win.webContents.executeJavaScript(`
        (async () => {
          await window.__licenseStore.getState().setModeForTesting('TRIAL');
          const trialSync = await window.electronAPI.licenseSyncTrial();
          const actSync = await window.__licenseStore.getState().activateKey('NOVA-BASE-4411-TEST-9999');
          const stAfter = window.__licenseStore.getState();
          await stAfter.deactivate();
          await window.__licenseStore.getState().setModeForTesting('TRIAL');
          return {
            defaultPortal: trialSync.status?.portalUrl,
            trialAnchored: trialSync.status?.trialAnchored,
            trialDays: trialSync.status?.trialDaysRemaining,
            actSuccess: actSync.success,
            actTier: stAfter.tier,
            actMasked: stAfter.licenseKeyMasked,
          };
        })()
      `);
      https.request = origHttpsRequest;
      log('Test 5 Result: ' + JSON.stringify({ ...b44Res, hitPaths }));

      if (
        b44Res.defaultPortal !== 'https://novapdf.appmys.com' ||
        !b44Res.trialAnchored ||
        !b44Res.actSuccess ||
        b44Res.actTier !== 'PRO' ||
        b44Res.actMasked !== 'NOVA-BASE-****-****-9999' ||
        !hitPaths.includes('/functions/licenseTrial') ||
        !hitPaths.includes('/functions/licenseActivate')
      ) {
        log('[FAIL] Test 5 failed');
        app.exit(1);
        return;
      }
      log('[PASS] Test 5: Base44 domain routing, uppercase fingerprint & ISO timestamp verification passed!');

      // 6. Verify Version 01.31 & Transparent SHA-256 Digital Certificate (Name, Role, Reason, Timestamp, Full Hash + PDF Save)
      log('\n--- TEST 6: DIGITAL CERTIFICATE SHA-256 TRANSPARENT UI & PDF COMPILATION ---');
      const certRes = await win.webContents.executeJavaScript(`
        (async () => {
          const store = window.__editorStore.getState();
          await store.createNewDocument('A4');
          store.setActiveTab('signatures');
          await new Promise(r => setTimeout(r, 200));

          const studioText = document.body.innerText;
          const studioHasPreview =
            studioText.toUpperCase().includes('CERTIFICATE PREVIEW (TRANSPARENT • SHA-256)') &&
            studioText.includes('Authorized Signer');

          // Switch to Type signature mode cleanly
          const typeTabBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.includes('Type')
          );
          typeTabBtn?.click();
          await new Promise(r => setTimeout(r, 150));

          // Click Insert Signature on Page 1
          const insertBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.includes('Insert Signature on Page')
          );
          insertBtn?.click();
          await new Promise(r => setTimeout(r, 350));

          const stAfter = window.__editorStore.getState();
          const sealAnn = stAfter.annotations.find(a => a.certificateMeta);
          const canvasText = document.body.innerText;
          const certVisibleOnPage = Boolean(
            sealAnn &&
            canvasText.includes('DIGITALLY SIGNED • SHA-256') &&
            canvasText.includes(sealAnn.certificateMeta.signerName) &&
            canvasText.includes(sealAnn.certificateMeta.signerRole) &&
            canvasText.includes('Reason: ' + sealAnn.certificateMeta.reason) &&
            canvasText.includes('SHA-256: ' + sealAnn.certificateMeta.sha256)
          );

          // Save/compile into real PDF bytes to ensure pdfEngine WinAnsi rendering succeeds cleanly
          await stAfter.saveCurrentPdf();
          await new Promise(r => setTimeout(r, 150));
          const savedSize = window.__editorStore.getState().pdfBytes?.byteLength || 0;

          return {
            studioHasPreview,
            hasSealMeta: Boolean(sealAnn?.certificateMeta),
            shaLength: sealAnn?.certificateMeta?.sha256?.length || 0,
            certVisibleOnPage,
            savedSize,
            success: studioHasPreview && Boolean(sealAnn?.certificateMeta) && sealAnn.certificateMeta.sha256.length === 64 && certVisibleOnPage && savedSize > 500
          };
        })()
      `);
      log('Test 6 Result: ' + JSON.stringify(certRes));
      if (!certRes.success) {
        log('[FAIL] Test 6 failed');
        app.exit(1);
        return;
      }
      log('[PASS] Test 6: Transparent SHA-256 Digital Certificate (Signer, Role, Reason, Timestamp, Full SHA-256 & Save) verified!');

      // 7. Recent Documents: Trace Back on Click, Deleted/Renamed Handling, One-by-One Delete & Clear All Staying on Page
      log('\n--- TEST 7: RECENT DOCUMENTS TRACE, MISSING FILE, SINGLE DELETE & CLEAR ALL ---');
      const tmpPdfPath = path.join(__dirname, 'tmp-recent-trace.pdf');
      await win.webContents.executeJavaScript(`
        (async () => {
          const st = window.__editorStore.getState();
          await st.createNewDocument('A4');
        })()
      `);
      const samplePdfBytes = await win.webContents.executeJavaScript(`
        Array.from(window.__editorStore.getState().pdfBytes || [])
      `);
      fs.writeFileSync(tmpPdfPath, Buffer.from(samplePdfBytes));

      const recentStep1 = await win.webContents.executeJavaScript(`
        (async () => {
          localStorage.removeItem('epdf_documents_v1');
          const opened = await window.electronAPI.openPdfDialog(${JSON.stringify(tmpPdfPath)});
          if (!opened) return { opened: false };
          await window.__editorStore.getState().loadPdfBytes(new Uint8Array(opened.data), opened.name, opened.filePath);
          await window.__editorStore.getState().createNewDocument('A4');

          window.__editorStore.getState().setActiveTab('dashboard');
          await new Promise(r => setTimeout(r, 200));

          // Click the traced tmp-recent-trace.pdf row -> must load it back & open Editor
          const rows = Array.from(document.querySelectorAll('tbody tr'));
          const traceRow = rows.find(r => r.innerText.includes('tmp-recent-trace.pdf'));
          traceRow?.click();
          await new Promise(r => setTimeout(r, 350));

          const stAfterTrace = window.__editorStore.getState();
          return {
            opened: true,
            tracedTab: stAfterTrace.activeTab,
            tracedFileName: stAfterTrace.currentFileName,
            tracedFilePath: stAfterTrace.currentFilePath,
          };
        })()
      `);
      log('Test 7a Result (trace existing file): ' + JSON.stringify(recentStep1));

      // Delete the file from disk to simulate deleted/renamed file
      try { fs.unlinkSync(tmpPdfPath); } catch {}

      const recentStep2 = await win.webContents.executeJavaScript(`
        (async () => {
          const store = window.__editorStore.getState();
          store.setActiveTab('dashboard');
          await new Promise(r => setTimeout(r, 250));

          const missingBadgeShown = document.body.innerText.includes('Deleted / Renamed');

          // Click the now-missing row -> must stay on dashboard and show Document Not Found on Disk
          const rows = Array.from(document.querySelectorAll('tbody tr'));
          const traceRow = rows.find(r => r.innerText.includes('tmp-recent-trace.pdf'));
          traceRow?.click();
          await new Promise(r => setTimeout(r, 200));

          const tabAfterMissingClick = window.__editorStore.getState().activeTab;
          const missingAlertShown = document.body.innerText.includes('Document Not Found on Disk');

          // Delete one by one -> must stay on dashboard and drop count by 1
          const countBeforeSingleDelete = document.querySelectorAll('tbody tr').length;
          const removeBtn = traceRow?.querySelector('button[title="Remove from Recents"]');
          removeBtn?.click();
          await new Promise(r => setTimeout(r, 150));

          const countAfterSingleDelete = document.querySelectorAll('tbody tr').length;
          const tabAfterSingleDelete = window.__editorStore.getState().activeTab;

          // Clear All -> must empty all records and stay on dashboard
          const clearAllBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.includes('Clear All')
          );
          clearAllBtn?.click();
          await new Promise(r => setTimeout(r, 150));

          const countAfterClearAll = document.querySelectorAll('tbody tr').length;
          const tabAfterClearAll = window.__editorStore.getState().activeTab;
          const emptyMsgShown = document.body.innerText.includes('No recent documents opened yet');

          return {
            missingBadgeShown,
            tabAfterMissingClick,
            missingAlertShown,
            countBeforeSingleDelete,
            countAfterSingleDelete,
            tabAfterSingleDelete,
            countAfterClearAll,
            tabAfterClearAll,
            emptyMsgShown,
          };
        })()
      `);
      log('Test 7b Result (missing/delete/clearAll): ' + JSON.stringify(recentStep2));

      if (
        !recentStep1.opened ||
        recentStep1.tracedTab !== 'editor' ||
        recentStep1.tracedFileName !== 'tmp-recent-trace.pdf' ||
        !recentStep2.missingBadgeShown ||
        recentStep2.tabAfterMissingClick !== 'dashboard' ||
        !recentStep2.missingAlertShown ||
        recentStep2.countAfterSingleDelete !== recentStep2.countBeforeSingleDelete - 1 ||
        recentStep2.tabAfterSingleDelete !== 'dashboard' ||
        recentStep2.countAfterClearAll !== 0 ||
        recentStep2.tabAfterClearAll !== 'dashboard' ||
        !recentStep2.emptyMsgShown
      ) {
        log('[FAIL] Test 7 failed');
        app.exit(1);
        return;
      }
      log('[PASS] Test 7: Recent Documents trace, missing/deleted detection, one-by-one delete & Clear All verified!');

      // 8. Consistent Save / Apply UI & UX across Modules (Settings, Security, Signatures, Organize, Convert, Editor)
      log('\n--- TEST 8: CONSISTENT SAVE / APPLY BUTTONS ACROSS ALL MODULES ---');
      const saveApplyRes = await win.webContents.executeJavaScript(`
        (async () => {
          const store = window.__editorStore.getState();
          await store.createNewDocument('A4');
          await new Promise(r => setTimeout(r, 150));

          const editorSaveBtn = document.body.innerText.includes('Save');

          store.setActiveTab('settings');
          await new Promise(r => setTimeout(r, 120));
          const saveSettingsBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.includes('Save & Apply Settings')
          );
          saveSettingsBtn?.click();
          await new Promise(r => setTimeout(r, 120));
          const settingsSavedBadge = document.body.innerText.includes('Settings Saved');

          store.setActiveTab('security');
          await new Promise(r => setTimeout(r, 120));
          const securityApplyAndSave =
            document.body.innerText.includes('Apply Security Settings') &&
            document.body.innerText.includes('Apply & Save PDF');

          store.setActiveTab('signatures');
          await new Promise(r => setTimeout(r, 120));
          const noSavePdfInHeader = !document.body.innerText.includes('Save PDF');
          const applyCertBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent && b.textContent.trim() === 'Apply'
          );
          applyCertBtn?.click();
          await new Promise(r => setTimeout(r, 120));
          const certApplied = document.body.innerText.includes('Applied & Saved!');
          const signaturesSave =
            noSavePdfInHeader &&
            Boolean(applyCertBtn) &&
            certApplied &&
            document.body.innerText.includes('Save to Signature Library');

          store.setActiveTab('organize');
          await new Promise(r => setTimeout(r, 120));
          const organizeSave = document.body.innerText.includes('Save Document');

          store.setActiveTab('convert');
          await new Promise(r => setTimeout(r, 120));
          const convertBtn = document.body.innerText.includes('Start Local Conversion');

          return {
            editorSaveBtn,
            hasSaveSettingsBtn: Boolean(saveSettingsBtn),
            settingsSavedBadge,
            securityApplyAndSave,
            signaturesSave,
            organizeSave,
            convertBtn,
            success:
              editorSaveBtn &&
              Boolean(saveSettingsBtn) &&
              settingsSavedBadge &&
              securityApplyAndSave &&
              signaturesSave &&
              organizeSave &&
              convertBtn
          };
        })()
      `);
      log('Test 8 Result: ' + JSON.stringify(saveApplyRes));
      if (!saveApplyRes.success) {
        log('[FAIL] Test 8 failed');
        app.exit(1);
        return;
      }
      log('[PASS] Test 8: Consistent Save/Apply UI/UX across modules verified!');

      // 9. Security Integrity & Windows PDF Associations Settings UI Verification
      log('\n--- TEST 9: SECURITY HARDENING & PDF ASSOCIATIONS UI ---');
      const { LicenseManager } = require('../electron/licenseManager.cjs');
      const tmpLicDir = path.join(__dirname, 'tmp-sec-audit');
      fs.rmSync(tmpLicDir, { recursive: true, force: true });
      const lm = new LicenseManager(tmpLicDir, '01.31');
      lm.ensureTrialInitialized();
      // Tamper trial.dat on disk -> HMAC/DPAPI verification must reject forged JSON
      fs.writeFileSync(
        path.join(tmpLicDir, 'trial.dat'),
        'PLAIN2:{"v":2,"data":"{\\"trialEndsAt\\":9999999999}","mac":"0000"}',
        'utf8'
      );
      const lmReloaded = new LicenseManager(tmpLicDir, '01.31');
      const tamperedRead = lmReloaded._readTrial();
      // Verify clock rollback forces FREE
      lmReloaded._writeTrial({
        startedAt: 1000,
        lastSeenAt: Math.floor(Date.now() / 1000) + 500000,
        trialEndsAt: Math.floor(Date.now() / 1000) + 900000,
      });
      const rollbackStatus = lmReloaded.getStatus();
      fs.rmSync(tmpLicDir, { recursive: true, force: true });

      const secUiRes = await win.webContents.executeJavaScript(`
        (async () => {
          const store = window.__editorStore.getState();
          store.setActiveTab('settings');
          await new Promise(r => setTimeout(r, 150));
          const hasOpenWithBtn = document.body.innerText.includes('Add to Right-Click Menu');
          const hasDefaultReaderBtn = document.body.innerText.includes('Set as Default PDF Reader');
          const assocStatus = await window.electronAPI.getPdfAssociationStatus();
          return {
            hasOpenWithBtn,
            hasDefaultReaderBtn,
            assocSupported: Boolean(assocStatus && assocStatus.supported),
          };
        })()
      `);

      const test9Ok =
        tamperedRead === null &&
        rollbackStatus.tier === 'FREE' &&
        secUiRes.hasOpenWithBtn &&
        secUiRes.hasDefaultReaderBtn &&
        secUiRes.assocSupported;
      log('Test 9 Result: ' + JSON.stringify({ tamperedRejected: tamperedRead === null, rollbackTier: rollbackStatus.tier, ...secUiRes, success: test9Ok }));
      if (!test9Ok) {
        log('[FAIL] Test 9 failed');
        app.exit(1);
        return;
      }
      log('[PASS] Test 9: Security HMAC tamper rejection, rollback guard & Windows PDF Association settings verified!');

      log('\n======================================================');
      log('ALL SUBSCRIPTION & OFFLINE LICENSING E2E TESTS PASSED!');
      log('======================================================');
      app.exit(0);
    } catch (err) {
      log('[ERROR] ' + err.stack);
      app.exit(1);
    }
  }, 500);
});
