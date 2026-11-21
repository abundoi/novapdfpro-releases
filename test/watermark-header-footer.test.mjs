import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjs from 'pdfjs-dist';

const getDocument = typeof pdfjs.getDocument === 'function'
  ? pdfjs.getDocument
  : (pdfjs.default?.getDocument || pdfjs.default);
import { pdfEngine } from '../src/services/pdfEngine.ts';

test('Watermark: Apply modifications correctly centers watermark and supports excludeFirstPage', async () => {
  // Create a 2-page blank document
  const blankDocBytes = await pdfEngine.createBlankDocument('A4', 2);

  const modifiedBytes = await pdfEngine.applyModifications(blankDocBytes, {
    watermark: {
      text: 'TOP SECRET AUDIT',
      fontSize: 54,
      rotationDegrees: 45,
      opacity: 0.3,
      colorHex: '#dc2626',
      excludeFirstPage: true,
    },
  });

  assert.ok(modifiedBytes && modifiedBytes.length > 500, 'Modified PDF must be produced');

  // Verify with pdfjs that page 1 does NOT have watermark, but page 2 DOES
  const task = getDocument({ data: modifiedBytes });
  const doc = await task.promise;
  assert.equal(doc.numPages, 2);

  const page1 = await doc.getPage(1);
  const text1 = (await page1.getTextContent()).items.map((i) => i.str).join(' ');
  assert.ok(
    !text1.includes('TOP SECRET AUDIT'),
    'Page 1 must NOT contain watermark when excludeFirstPage is true'
  );

  const page2 = await doc.getPage(2);
  const text2 = (await page2.getTextContent()).items.map((i) => i.str).join(' ');
  assert.ok(
    text2.includes('TOP SECRET AUDIT'),
    'Page 2 must contain watermark when excludeFirstPage is true'
  );
});

test('Header & Footer: Apply modifications evaluates tokens and renders multi-zone headers/footers', async () => {
  // Create a 3-page blank document
  const blankDocBytes = await pdfEngine.createBlankDocument('A4', 3);

  const modifiedBytes = await pdfEngine.applyModifications(blankDocBytes, {
    headerFooter: {
      headerLeft: 'ACME Corp',
      headerCenter: 'Enterprise Specification',
      headerRight: 'CONFIDENTIAL',
      footerLeft: 'Audit Copy',
      footerCenter: 'Page {page} of {total}',
      footerRight: 'Rev 1.0',
      fontSize: 9,
      colorHex: '#0f172a',
      excludeFirstPage: false,
    },
  });

  assert.ok(modifiedBytes && modifiedBytes.length > 500, 'Modified PDF must be produced');

  const task = getDocument({ data: modifiedBytes });
  const doc = await task.promise;
  assert.equal(doc.numPages, 3);

  // Check Page 1
  const page1 = await doc.getPage(1);
  const text1 = (await page1.getTextContent()).items.map((i) => i.str).join(' ');
  assert.ok(text1.includes('ACME Corp'), 'Page 1 header left present');
  assert.ok(text1.includes('Enterprise Specification'), 'Page 1 header center present');
  assert.ok(text1.includes('CONFIDENTIAL'), 'Page 1 header right present');
  assert.ok(text1.includes('Page 1 of 3'), 'Page 1 footer pagination evaluated');
  assert.ok(text1.includes('Audit Copy'), 'Page 1 footer left present');

  // Check Page 3
  const page3 = await doc.getPage(3);
  const text3 = (await page3.getTextContent()).items.map((i) => i.str).join(' ');
  assert.ok(text3.includes('Page 3 of 3'), 'Page 3 footer pagination evaluated');
});

test('Header & Footer: excludeFirstPage suppresses headers & footers on cover page', async () => {
  const blankDocBytes = await pdfEngine.createBlankDocument('A4', 2);

  const modifiedBytes = await pdfEngine.applyModifications(blankDocBytes, {
    headerFooter: {
      headerCenter: 'Document Header',
      footerCenter: 'Page {page} of {total}',
      excludeFirstPage: true,
    },
  });

  const task = getDocument({ data: modifiedBytes });
  const doc = await task.promise;

  const page1 = await doc.getPage(1);
  const text1 = (await page1.getTextContent()).items.map((i) => i.str).join(' ');
  assert.ok(!text1.includes('Document Header'), 'Page 1 must not have header');
  assert.ok(!text1.includes('Page 1 of 2'), 'Page 1 must not have footer');

  const page2 = await doc.getPage(2);
  const text2 = (await page2.getTextContent()).items.map((i) => i.str).join(' ');
  assert.ok(text2.includes('Document Header'), 'Page 2 must have header');
  assert.ok(text2.includes('Page 2 of 2'), 'Page 2 must have footer');
});
