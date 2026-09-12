import { chromium } from 'playwright-core';

// A reported bug: the whole Add/Edit card visibly shifted sideways when
// the on-screen keyboard opened while typing a location. The modal is
// position: fixed over a page that's otherwise overflow: hidden (see
// style.css) -- there's never a legitimate reason for the page to drift
// HORIZONTALLY (the keyboard only ever needs vertical room), so unlike
// resetPageScroll (deliberately skipped while a dialog is open, since
// forcing vertical scroll back to 0 there fights the browser's own
// keyboard-avoidance scrolling -- see test_search_keyboard_scroll.mjs),
// resetHorizontalScroll runs unconditionally, including while a modal is
// open, on both the visualViewport's own events and a plain window
// scroll -- see app.js.
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 400, height: 700 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => window.localStorage.setItem('familytree.tourSeen.v1', '1'));
await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

console.log('=== Open the Add Person modal, then force a horizontal drift while it stays open ===');
await page.click('#addPersonBtn');
await page.waitForTimeout(200);
const setup = await page.evaluate(() => {
  // overflow: hidden on html/body normally blocks this outright -- relaxed
  // only to construct the drift scenario itself; the real-world equivalent
  // is iOS Safari's own keyboard-avoidance logic overriding overflow: hidden.
  document.documentElement.style.overflow = 'auto';
  document.body.style.width = '900px';
  document.documentElement.scrollLeft = 120;
  return { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
});
console.log('forced overflow set up:', JSON.stringify(setup));
if (setup.scrollWidth <= setup.clientWidth) throw new Error('Failed to set up real horizontal overflow for the drift scenario');

const settled = await page.evaluate(() => document.documentElement.scrollLeft);
const modalStillOpen = await page.evaluate(() => !document.getElementById('personModal').hidden);
console.log('scrollLeft after the drift (expect 0, self-corrected):', settled, '| modal still open:', modalStillOpen);
if (settled !== 0) throw new Error(`Expected the horizontal drift to self-correct even with the modal open, got ${settled}`);
if (!modalStillOpen) throw new Error('Expected the modal to remain open -- this fix must not close it');
console.log('Confirmed: horizontal drift corrects itself while the modal stays open.');

console.log('\n=== A visualViewport resize (simulating the keyboard opening/closing) also corrects it ===');
await page.evaluate(() => {
  document.documentElement.scrollLeft = 80;
});
await page.evaluate(() => window.visualViewport.dispatchEvent(new Event('resize')));
await page.waitForTimeout(50);
const afterResize = await page.evaluate(() => document.documentElement.scrollLeft);
console.log('scrollLeft after visualViewport resize (expect 0):', afterResize);
if (afterResize !== 0) throw new Error(`Expected the resize handler to also correct horizontal drift, got ${afterResize}`);
console.log('Confirmed: visualViewport resize also corrects horizontal drift.');

console.log('\nERRORS:', errors);
if (errors.length) process.exit(1);
console.log('\nALL PASSED');
await browser.close();
