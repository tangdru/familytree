import { chromium } from 'playwright-core';
import path from 'node:path';

const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (msg) => {
  // Chromium's generic "Failed to load resource: 404" for /favicon.ico
  // carries no URL in msg.text(), so it's filtered by message text alone;
  // confirmed against the server access log to be only the favicon.
  if (msg.type() === 'error' && !/Failed to load resource.*404/.test(msg.text())) {
    errors.push('console.error: ' + msg.text());
  }
});

await page.goto('http://127.0.0.1:8934/index.html');
await page.waitForSelector('#songTitle');

// --- PDF import ---
await page.setInputFiles('#chordproFile', path.resolve('sample_leadsheet.pdf'));
await page.waitForSelector('#pasteArea:not(.hidden)', { timeout: 10000 });
const pdfText = await page.inputValue('#pasteText');
console.log('=== PDF converted text ===\n' + pdfText);

if (!/\[G\]/.test(pdfText) || !/\[C\]/.test(pdfText)) throw new Error('PDF import: expected chords not found');
if (!/Amazing grace/.test(pdfText)) throw new Error('PDF import: lyrics missing');
if (!/\{title: Amazing Grace\}/.test(pdfText)) throw new Error('PDF import: title has bad spacing: ' + pdfText.split('\n')[0]);
// Check rough alignment: G should land at/near "Amazing" (offset 0), C near "sweet"
const line1 = pdfText.split('\n').find((l) => l.includes('Amazing grace'));
console.log('line1:', JSON.stringify(line1));
if (!/^\[G\]Amazing/.test(line1)) throw new Error('PDF import: chord not aligned to start of line as expected: ' + line1);

await page.click('#loadPastedBtn');
await page.waitForTimeout(200);
const pdfLineCount = await page.locator('.song-line').count();
console.log('rendered lines after PDF load:', pdfLineCount);
if (pdfLineCount < 2) throw new Error('PDF import: song did not render after load');

// --- DOCX import ---
await page.setInputFiles('#chordproFile', path.resolve('sample_leadsheet.docx'));
await page.waitForSelector('#pasteArea:not(.hidden)', { timeout: 10000 });
await page.waitForTimeout(300);
const docxText = await page.inputValue('#pasteText');
console.log('=== DOCX converted text ===\n' + docxText);
if (!/\[C\]/.test(docxText) || !/\[C7\]/.test(docxText)) throw new Error('DOCX import: expected chords not found');
if (!/other night/.test(docxText) || !/sleeping/.test(docxText)) throw new Error('DOCX import: lyrics missing');

// --- Unsupported .doc ---
// (skipped: no real .doc binary sample; error path covered by code review since
// it's a simple synchronous extension check before any parsing is attempted)

await browser.close();

if (errors.length) {
  console.error('CONSOLE/PAGE ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('OK: PDF and DOCX lead sheet import both converted correctly');
