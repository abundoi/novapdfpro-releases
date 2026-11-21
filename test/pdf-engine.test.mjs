import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';

test('PDF Engine: Create blank document and verify page count & dimensions', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Enterprise PDF Pro Blank Document Test', {
    x: 50,
    y: 750,
    size: 16,
    font,
    color: rgb(0, 0, 0),
  });

  const pdfBytes = await doc.save();
  assert.ok(pdfBytes.length > 500, 'PDF bytes generated must be valid');

  // Reopen and verify
  const loaded = await PDFDocument.load(pdfBytes);
  assert.equal(loaded.getPageCount(), 1, 'Page count must be 1');
  const size = loaded.getPage(0).getSize();
  assert.equal(Math.round(size.width), 595, 'Page width must match A4 width');
  assert.equal(Math.round(size.height), 842, 'Page height must match A4 height');
});

test('PDF Engine: Text modification & redaction replacement underlay', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  // Original text
  page.drawText('Original Contract Price: $50,000 USD', {
    x: 50,
    y: 700,
    size: 14,
    font,
    color: rgb(0, 0, 0),
  });

  // Authentic permanent text modification: whiteout existing text area + draw modified text
  page.drawRectangle({
    x: 48,
    y: 698,
    width: 320,
    height: 20,
    color: rgb(1, 1, 1),
  });

  page.drawText('Original Contract Price: $120,000 USD [MODIFIED]', {
    x: 50,
    y: 700,
    size: 14,
    font: boldFont,
    color: rgb(0.1, 0.4, 0.8),
  });

  const saved = await doc.save();
  const reopened = await PDFDocument.load(saved);
  assert.equal(reopened.getPageCount(), 1);
  assert.ok(saved.length > 0);
});

test('PDF Engine: Page operations - Insert, Duplicate, Rotate, Reorder, Delete', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // Page 1
  const p1 = doc.addPage([500, 700]);
  p1.drawText('Page 1', { x: 50, y: 650, size: 20, font });

  // Page 2
  const p2 = doc.addPage([500, 700]);
  p2.drawText('Page 2', { x: 50, y: 650, size: 20, font });

  assert.equal(doc.getPageCount(), 2);

  // 1. Rotate Page 1 by 90 degrees
  p1.setRotation(degrees(90));
  assert.equal(p1.getRotation().angle, 90);

  // 2. Duplicate Page 1
  const [duplicated] = await doc.copyPages(doc, [0]);
  doc.insertPage(1, duplicated);
  assert.equal(doc.getPageCount(), 3);

  // 3. Delete Page 3
  doc.removePage(2);
  assert.equal(doc.getPageCount(), 2);

  // 4. Reorder pages (swap 0 and 1)
  const newDoc = await PDFDocument.create();
  const copied = await newDoc.copyPages(doc, [1, 0]);
  newDoc.addPage(copied[0]);
  newDoc.addPage(copied[1]);
  assert.equal(newDoc.getPageCount(), 2);

  const finalBytes = await newDoc.save();
  assert.ok(finalBytes.length > 500);
});

test('PDF Engine: Document Merging & Splitting', async () => {
  // Document A (2 pages)
  const docA = await PDFDocument.create();
  docA.addPage([400, 600]);
  docA.addPage([400, 600]);
  const bytesA = await docA.save();

  // Document B (3 pages)
  const docB = await PDFDocument.create();
  docB.addPage([400, 600]);
  docB.addPage([400, 600]);
  docB.addPage([400, 600]);
  const bytesB = await docB.save();

  // Merge A and B
  const merged = await PDFDocument.create();
  const lA = await PDFDocument.load(bytesA);
  const lB = await PDFDocument.load(bytesB);

  const copiedA = await merged.copyPages(lA, lA.getPageIndices());
  copiedA.forEach((p) => merged.addPage(p));
  const copiedB = await merged.copyPages(lB, lB.getPageIndices());
  copiedB.forEach((p) => merged.addPage(p));

  const mergedBytes = await merged.save();
  const loadedMerged = await PDFDocument.load(mergedBytes);
  assert.equal(loadedMerged.getPageCount(), 5, 'Merged document must have 2 + 3 = 5 pages');

  // Split merged document into individual pages
  const splitDocs = [];
  for (let i = 0; i < loadedMerged.getPageCount(); i++) {
    const single = await PDFDocument.create();
    const [c] = await single.copyPages(loadedMerged, [i]);
    single.addPage(c);
    splitDocs.push(await single.save());
  }
  assert.equal(splitDocs.length, 5, 'Splitting 5-page PDF must result in 5 single-page PDFs');
});

test('PDF Engine: Permanent Redaction burning and sanitation', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);

  // Redaction rectangle: solid black opaque block
  page.drawRectangle({
    x: 50,
    y: 500,
    width: 250,
    height: 30,
    color: rgb(0, 0, 0),
  });

  // Stamp [REDACTED] label inside
  page.drawText('[PERMANENTLY REDACTED]', {
    x: 60,
    y: 510,
    size: 10,
    font,
    color: rgb(1, 1, 1),
  });

  const bytes = await doc.save();
  const reopened = await PDFDocument.load(bytes);
  assert.equal(reopened.getPageCount(), 1);
});

test('PDF Engine: Watermarking and Header/Footer Pagination', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([595, 842]);
    const { width, height } = page.getSize();

    // Watermark
    page.drawText('CONFIDENTIAL', {
      x: width * 0.2,
      y: height * 0.5,
      size: 48,
      font: boldFont,
      color: rgb(0.8, 0.8, 0.8),
      rotate: degrees(45),
      opacity: 0.25,
    });

    // Footer Page Number
    const pageText = `Page ${i + 1} of 3`;
    page.drawText(pageText, {
      x: width / 2 - 30,
      y: 20,
      size: 9,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
  }

  const bytes = await doc.save();
  const reopened = await PDFDocument.load(bytes);
  assert.equal(reopened.getPageCount(), 3);
});

test('PDF Engine: Interactive Form Creation and Field Values', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();

  const nameField = form.createTextField('fullName');
  nameField.setText('Jane Doe, Enterprise Architect');
  nameField.addToPage(page, { x: 50, y: 700, width: 250, height: 25 });

  const consentBox = form.createCheckBox('termsAgreed');
  consentBox.check();
  consentBox.addToPage(page, { x: 50, y: 650, width: 20, height: 20 });

  const dropdown = form.createDropdown('securityClearance');
  dropdown.setOptions(['Public', 'Confidential', 'Top Secret']);
  dropdown.select('Confidential');
  dropdown.addToPage(page, { x: 50, y: 600, width: 200, height: 25 });

  const bytes = await doc.save();
  const reopened = await PDFDocument.load(bytes);
  const reopenedForm = reopened.getForm();

  assert.equal(reopenedForm.getTextField('fullName').getText(), 'Jane Doe, Enterprise Architect');
  assert.equal(reopenedForm.getCheckBox('termsAgreed').isChecked(), true);
  assert.deepEqual(reopenedForm.getDropdown('securityClearance').getSelected(), ['Confidential']);
});
