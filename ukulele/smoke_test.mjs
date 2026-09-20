import { chromium } from 'playwright-core';

const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('console.error: ' + msg.text());
});

await page.goto('http://127.0.0.1:8934/index.html');
await page.waitForSelector('#songTitle');

// Load a demo song
await page.selectOption('#demoSongSelect', 'Amazing Grace');
await page.waitForTimeout(200);
const title = await page.textContent('#songTitle');
const key = await page.textContent('#keyDisplay');
const lineCount = await page.locator('.song-line').count();
console.log('title:', title, '| key:', key, '| lines:', lineCount);
if (title !== 'Amazing Grace') throw new Error('title mismatch');
if (lineCount < 4) throw new Error('expected rendered lines');

// Click a chord to open the diagram modal
await page.locator('.chord-sym').first().click();
await page.waitForTimeout(100);
const modalVisible = await page.locator('#chordModal').isVisible();
const diagramSvg = await page.locator('.chord-diagram-svg').count();
console.log('modal visible:', modalVisible, '| svg rendered:', diagramSvg);
if (!modalVisible || !diagramSvg) throw new Error('chord diagram did not render');
await page.locator('.chord-modal-backdrop').click({ position: { x: 5, y: 5 } });

// Play & auto-scroll (no mic needed -- metronome uses AudioContext only, and
// jsdom-less real Chromium supports it headless without a physical device).
await page.click('#playBtn');
await page.waitForTimeout(600);
const activeLines = await page.locator('.song-line.active-line').count();
console.log('active lines after play:', activeLines);
if (activeLines !== 1) throw new Error('expected exactly one active line during scroll');
await page.click('#stopBtn');

// Tab switching
await page.click('.tab-btn[data-tab="tuner"]');
await page.waitForTimeout(100);
const tunerVisible = await page.locator('#tab-tuner').isVisible();
console.log('tuner tab visible:', tunerVisible);
if (!tunerVisible) throw new Error('tuner tab did not show');

// Paste-your-own-chords path
await page.click('.tab-btn[data-tab="play"]');
await page.click('#togglePasteBtn');
await page.fill('#pasteText', '{title: Pasted Song}\n{key: Am}\n\n[Am]Testing [G]paste [F]flow\n');
await page.click('#loadPastedBtn');
await page.waitForTimeout(200);
const pastedTitle = await page.textContent('#songTitle');
console.log('pasted title:', pastedTitle);
if (pastedTitle !== 'Pasted Song') throw new Error('paste-load did not work');

await browser.close();

if (errors.length) {
  console.error('CONSOLE/PAGE ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('OK: no console/page errors, all smoke checks passed');
