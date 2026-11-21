import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';

const getDocument = typeof pdfjs.getDocument === 'function'
  ? pdfjs.getDocument
  : (pdfjs.default?.getDocument || pdfjs.default);
import { pdfEngine } from '../src/services/pdfEngine.ts';

test('Paragraph Layout: layoutParagraphLines preserves explicit newlines and wraps long paragraphs', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // 1. Explicit multi-line paragraph test
  const multilineText = 'First line of paragraph.\nSecond line.\nThird line.';
  const linesUnconstrained = pdfEngine.layoutParagraphLines(multilineText, font, 12, undefined);
  assert.equal(linesUnconstrained.length, 3);
  assert.equal(linesUnconstrained[0], 'First line of paragraph.');
  assert.equal(linesUnconstrained[1], 'Second line.');
  assert.equal(linesUnconstrained[2], 'Third line.');

  // 2. Long text wrapping test with constraint (e.g. 150 points)
  const longParagraph =
    'This is a comprehensive enterprise paragraph with multiple sentences designed to verify that long text wraps cleanly within the designated box width without overflowing or getting cut off.';
  const wrappedLines = pdfEngine.layoutParagraphLines(longParagraph, font, 12, 150);

  assert.ok(wrappedLines.length > 3, 'Paragraph must wrap into multiple lines when width is constrained');
  for (const line of wrappedLines) {
    const lineWidth = font.widthOfTextAtSize(line, 12);
    assert.ok(
      lineWidth <= 155, // small tolerance for single long words
      `Line width (${lineWidth}) must not exceed maxWidth (150)`
    );
  }
});

test('Paragraph & Long Text: Apply modifications correctly burns multi-line text and replacement underlay', async () => {
  // Create a blank 1-page document
  const blankDocBytes = await pdfEngine.createBlankDocument('A4', 1);

  const longText =
    'Enterprise Agreement Paragraph 1: All confidential materials, financial records, and proprietary documentation remain strictly protected under offline air-gapped security protocols.\n\nParagraph 2: Authorized personnel may modify document contents locally with verified audit logging.';

  const modifiedBytes = await pdfEngine.applyModifications(blankDocBytes, {
    textItems: [
      {
        id: 'para_1',
        pageIndex: 0,
        x: 50,
        y: 80,
        width: 250, // Constrained paragraph width
        text: longText,
        fontSize: 11,
        fontFamily: 'Helvetica',
        color: '#1e293b',
        lineHeight: 1.35,
        align: 'left',
        isBold: true,
      },
      {
        id: 'para_replaced',
        pageIndex: 0,
        x: 50,
        y: 350,
        width: 280,
        text: 'REPLACED AUDIT NOTE:\nThis replacement text completely covers the original content block with a pristine whiteout underlay and renders multi-line content.',
        fontSize: 10,
        fontFamily: 'TimesRoman',
        color: '#b91c1c',
        lineHeight: 1.25,
        align: 'center',
        isRedactionReplacement: true,
        boundingBox: {
          x: 50,
          y: 350,
          width: 140, // Original was smaller
          height: 15,
        },
      },
    ],
  });

  assert.ok(modifiedBytes && modifiedBytes.length > 500, 'Modified PDF must be produced');

  // Verify with pdfjs extraction that all lines and words were baked into the PDF text layer
  const task = getDocument({ data: modifiedBytes });
  const doc = await task.promise;
  assert.equal(doc.numPages, 1);

  const page = await doc.getPage(1);
  const textContent = await page.getTextContent();
  const normalizedText = textContent.items
    .map((i) => i.str)
    .join(' ')
    .replace(/\s+/g, ' ');

  assert.ok(normalizedText.includes('Enterprise Agreement Paragraph 1:'));
  assert.ok(normalizedText.includes('offline air-gapped security protocols.'));
  assert.ok(normalizedText.includes('Paragraph 2: Authorized personnel'));
  assert.ok(normalizedText.includes('REPLACED AUDIT NOTE:'));
  assert.ok(normalizedText.includes('pristine whiteout underlay'));
});
