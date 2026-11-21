import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';

test('End-to-End Enterprise PDF Pipeline: Create -> Edit -> Annotate -> Redact -> Watermark -> Forms -> Save -> Reopen', async () => {
  // Step 1: Create a fresh multi-page blank PDF
  const doc = await PDFDocument.create();
  const page1 = doc.addPage([595.28, 841.89]); // A4
  const page2 = doc.addPage([595.28, 841.89]); // A4

  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Step 2: Content Generation on Page 1
  page1.drawText('CONFIDENTIAL MASTER SERVICE AGREEMENT', {
    x: 50,
    y: 780,
    size: 16,
    font: helveticaBold,
    color: rgb(0.05, 0.35, 0.75),
  });

  page1.drawText('Contract Value: $250,000 USD payable upon delivery of Milestone 1.', {
    x: 50,
    y: 740,
    size: 11,
    font: helvetica,
    color: rgb(0.1, 0.1, 0.1),
  });

  // Step 3: In-Place Text Editing (Redaction underlay + replacement text)
  page1.drawRectangle({
    x: 48,
    y: 736,
    width: 400,
    height: 18,
    color: rgb(1, 1, 1), // Whiteout
  });

  page1.drawText('Contract Value: $385,000 USD (Revised Annex A Milestone).', {
    x: 50,
    y: 740,
    size: 11,
    font: helveticaBold,
    color: rgb(0.1, 0.6, 0.2),
  });

  // Step 4: Permanent Redaction burning
  page1.drawRectangle({
    x: 50,
    y: 690,
    width: 280,
    height: 24,
    color: rgb(0, 0, 0), // Burn black
  });
  page1.drawText('[PERMANENTLY REDACTED TRADE SECRET]', {
    x: 55,
    y: 697,
    size: 9,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  // Step 5: Enterprise Status Stamp
  const stampColor = rgb(0.08, 0.58, 0.28);
  page1.drawRectangle({
    x: 380,
    y: 680,
    width: 150,
    height: 45,
    borderColor: stampColor,
    borderWidth: 2,
    color: rgb(1, 1, 1),
    opacity: 0.95,
  });
  page1.drawText('APPROVED', {
    x: 395,
    y: 702,
    size: 14,
    font: helveticaBold,
    color: stampColor,
  });
  page1.drawText('2026-11-06 | AUDIT VERIFIED', {
    x: 395,
    y: 688,
    size: 7.5,
    font: helvetica,
    color: stampColor,
  });

  // Step 6: Interactive Forms on Page 2
  const form = doc.getForm();
  const signatoryField = form.createTextField('signatory_name');
  signatoryField.setText('Executive Signer');
  signatoryField.addToPage(page2, { x: 50, y: 700, width: 200, height: 25 });

  const agreeCheckbox = form.createCheckBox('terms_accepted');
  agreeCheckbox.check();
  agreeCheckbox.addToPage(page2, { x: 50, y: 650, width: 20, height: 20 });

  // Step 7: Watermark and Pagination across all pages
  const totalPages = doc.getPageCount();
  for (let i = 0; i < totalPages; i++) {
    const p = doc.getPage(i);
    const { width, height } = p.getSize();

    // Watermark
    p.drawText('ENTERPRISE CONFIDENTIAL', {
      x: width * 0.15,
      y: height * 0.45,
      size: 38,
      font: helveticaBold,
      color: rgb(0.75, 0.75, 0.75),
      rotate: degrees(45),
      opacity: 0.2,
    });

    // Pagination Footer
    const footerText = `Page ${i + 1} of ${totalPages}`;
    const textWidth = helvetica.widthOfTextAtSize(footerText, 9);
    p.drawText(footerText, {
      x: (width - textWidth) / 2,
      y: 25,
      size: 9,
      font: helvetica,
      color: rgb(0.4, 0.4, 0.4),
    });
  }

  // Step 8: Document Metadata
  doc.setTitle('Enterprise Master Service Agreement');
  doc.setAuthor('Enterprise PDF Pro User');
  doc.setProducer('Enterprise PDF Pro Offline Engine v1.0');

  // Step 9: Save & Verify Binary
  const pdfBytes = await doc.save();
  assert.ok(pdfBytes.length > 1000, 'Compiled PDF must be non-empty and well-formed');
  assert.equal(String.fromCharCode(...pdfBytes.slice(0, 5)), '%PDF-');

  // Step 10: Reopen and Validate Document Integrity
  const reopened = await PDFDocument.load(pdfBytes);
  assert.equal(reopened.getPageCount(), 2, 'Page count must match original');
  assert.equal(reopened.getTitle(), 'Enterprise Master Service Agreement');

  const reopenedForm = reopened.getForm();
  assert.equal(reopenedForm.getTextField('signatory_name').getText(), 'Executive Signer');
  assert.equal(reopenedForm.getCheckBox('terms_accepted').isChecked(), true);
});
