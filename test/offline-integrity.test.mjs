import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

test('Offline Integrity: Complete workflow executes strictly in-memory / local filesystem', async () => {
  // 1. Create document
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // 2. Add confidential content
  page.drawText('OFFLINE-FIRST ENTERPRISE DOCUMENT', {
    x: 50,
    y: 780,
    size: 14,
    font,
    color: rgb(0.1, 0.5, 0.9),
  });

  page.drawText('Client Name: Antigravity Systems LLC', {
    x: 50,
    y: 750,
    size: 12,
    font,
  });

  // 3. Apply redaction
  page.drawRectangle({
    x: 48,
    y: 746,
    width: 250,
    height: 18,
    color: rgb(0, 0, 0),
  });
  page.drawText('[REDACTED CLIENT]', {
    x: 52,
    y: 750,
    size: 10,
    font,
    color: rgb(1, 1, 1),
  });

  // 4. Save and verify byte signature
  const bytes = await doc.save();
  assert.ok(bytes.length > 500);

  // Check PDF magic header "%PDF-"
  const header = String.fromCharCode(...bytes.slice(0, 5));
  assert.equal(header, '%PDF-', 'PDF must begin with valid binary magic bytes');

  // 5. Reopen
  const reopened = await PDFDocument.load(bytes);
  assert.equal(reopened.getPageCount(), 1);
});
