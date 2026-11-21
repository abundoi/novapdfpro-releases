import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';

const getDocument = typeof pdfjs.getDocument === 'function'
  ? pdfjs.getDocument
  : (pdfjs.default?.getDocument || pdfjs.default);
import {
  isPdfEncrypted,
  encryptPdfDocument,
  computeP,
  computeO,
  computeU,
  computeFileEncryptionKey,
  calculateMD5,
  arcfourCipher,
} from '../src/services/pdfCrypto.ts';

// Helper to clone Uint8Array into fresh ArrayBuffer so worker transfer does not detach original
function cloneBytes(src) {
  const buf = new ArrayBuffer(src.byteLength);
  const u8 = new Uint8Array(buf);
  u8.set(src);
  return u8;
}

test('Document Encryption: isPdfEncrypted correctly identifies unencrypted vs encrypted PDFs', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const plainBytes = await doc.save();

  assert.equal(isPdfEncrypted(plainBytes), false, 'Plain PDF must not be flagged as encrypted');

  encryptPdfDocument(doc, { userPassword: 'TestPassword123' });
  const encBytes = await doc.save({ useObjectStreams: false });

  assert.equal(isPdfEncrypted(encBytes), true, 'Encrypted PDF must be flagged as encrypted');
});

test('Document Encryption: Password required for access - blocks unauthorized access without password', async () => {
  const secretText = 'CONFIDENTIAL ENTERPRISE AUDIT REPORT 2026';
  const password = 'SuperSecretAuditPassword456!';

  const doc = await PDFDocument.create();
  const page = doc.addPage([500, 500]);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText(secretText, { x: 50, y: 400, size: 18, font, color: rgb(0.1, 0.5, 0.2) });

  encryptPdfDocument(doc, {
    userPassword: password,
    ownerPassword: 'AdminMasterPassword999!',
    permissions: {
      printing: 'lowResolution',
      copying: false,
      modifying: false,
    },
  });

  const rawEncryptedBytes = await doc.save({ useObjectStreams: false });

  // 1. Attempt access without password: must be rejected with NEED_PASSWORD (1)
  let needPasswordFired = false;
  try {
    const task = getDocument({ data: cloneBytes(rawEncryptedBytes) });
    task.onPassword = (callback, reason) => {
      if (reason === 1) needPasswordFired = true;
      callback(new Error('User cancelled password prompt'));
    };
    await task.promise;
    assert.fail('PDF without password should have been blocked');
  } catch (err) {
    assert.equal(needPasswordFired, true, 'Must demand password with reason NEED_PASSWORD (1)');
  }

  // 2. Attempt access with incorrect password: must be rejected with INCORRECT_PASSWORD (2)
  let incorrectPasswordFired = false;
  try {
    const task = getDocument({
      data: cloneBytes(rawEncryptedBytes),
      password: 'CompletelyWrongPassword',
    });
    task.onPassword = (callback, reason) => {
      if (reason === 2) incorrectPasswordFired = true;
      callback(new Error('User aborted'));
    };
    await task.promise;
    assert.fail('PDF with wrong password should have been rejected');
  } catch (err) {
    assert.equal(incorrectPasswordFired, true, 'Must reject with reason INCORRECT_PASSWORD (2)');
  }

  // 3. Attempt access with correct user password: must succeed and decrypt exact text
  const taskValid = getDocument({
    data: cloneBytes(rawEncryptedBytes),
    password,
  });
  const proxy = await taskValid.promise;
  assert.equal(proxy.numPages, 1, 'Decrypted document must have 1 page');

  const p1 = await proxy.getPage(1);
  const tc = await p1.getTextContent();
  const extracted = tc.items.map((i) => i.str).join(' ');
  assert.ok(
    extracted.includes(secretText),
    `Decrypted content must include "${secretText}", got "${extracted}"`
  );

  // 4. Attempt access with correct owner password: must succeed and decrypt exact text
  const taskOwner = getDocument({
    data: cloneBytes(rawEncryptedBytes),
    password: 'AdminMasterPassword999!',
  });
  const proxyOwner = await taskOwner.promise;
  assert.equal(proxyOwner.numPages, 1, 'Owner-unlocked document must have 1 page');
});

test('Document Encryption: Permissions flag /P is correctly computed according to ISO 32000-1', () => {
  // Default full permissions
  const pFull = computeP({});
  assert.equal(pFull, -4, 'Default full permissions should be -4');

  // Restrict printing: bits 3 (4) and 12 (2048) cleared
  const pNoPrint = computeP({ printing: 'none' });
  assert.equal((pNoPrint & 4) === 0, true, 'Print bit 3 must be cleared');
  assert.equal((pNoPrint & 2048) === 0, true, 'High-res print bit 12 must be cleared');

  // Restrict copying: bit 5 (16) and bit 10 (512) cleared
  const pNoCopy = computeP({ copying: false });
  assert.equal((pNoCopy & 16) === 0, true, 'Copy bit 5 must be cleared');
  assert.equal((pNoCopy & 512) === 0, true, 'Accessibility copy bit 10 must be cleared');

  // Restrict modifying: bit 4 (8), bit 6 (32), bit 11 (1024) cleared
  const pNoModify = computeP({ modifying: false });
  assert.equal((pNoModify & 8) === 0, true, 'Modify bit 4 must be cleared');
  assert.equal((pNoModify & 32) === 0, true, 'Annotation bit 6 must be cleared');
  assert.equal((pNoModify & 1024) === 0, true, 'Assemble bit 11 must be cleared');
});
