import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 400, height: 700 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => window.localStorage.setItem('familytree.tourSeen.v1', '1'));
await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

// Spy on window.scrollTo (what resetPageScroll calls) as a proxy for
// whether the visualViewport resize handler actually ran resetPageScroll,
// since headless Chromium at this viewport size has no real page overflow
// to scroll (so checking scrollY directly can't tell them apart).
await page.evaluate(() => {
  window.__scrollToCalls = 0;
  const orig = window.scrollTo;
  window.scrollTo = function (...args) { window.__scrollToCalls++; return orig.apply(this, args); };
});

console.log('=== Search open, simulate a visualViewport resize (keyboard opening) ===');
await page.click('#searchToggleBtn');
await page.waitForTimeout(100);
const searchOpenBefore = await page.evaluate(() => document.getElementById('searchWrap').classList.contains('open'));
await page.evaluate(() => { window.__scrollToCalls = 0; }); // reset counter after focus-related noise
await page.evaluate(() => window.visualViewport.dispatchEvent(new Event('resize')));
await page.waitForTimeout(50);
const callsWhileOpen = await page.evaluate(() => window.__scrollToCalls);
console.log('search open:', searchOpenBefore, 'scrollTo() calls after resize event while search open:', callsWhileOpen);
if (callsWhileOpen !== 0) {
  throw new Error(`Expected resetPageScroll NOT to run while search is open, but scrollTo() was called ${callsWhileOpen} time(s)`);
}
console.log('Confirmed: resetPageScroll does NOT run while search is open.');

console.log('\n=== Close search, simulate a visualViewport resize (keyboard closing) ===');
await page.keyboard.press('Escape'); // closeSearch() via the input's own Escape handler
await page.waitForTimeout(100);
const searchOpenAfterClose = await page.evaluate(() => document.getElementById('searchWrap').classList.contains('open'));
await page.evaluate(() => { window.__scrollToCalls = 0; });
await page.evaluate(() => window.visualViewport.dispatchEvent(new Event('resize')));
await page.waitForTimeout(50);
const callsAfterClose = await page.evaluate(() => window.__scrollToCalls);
console.log('search open:', searchOpenAfterClose, 'scrollTo() calls after resize event with search closed:', callsAfterClose);
if (callsAfterClose < 1) {
  throw new Error(`Expected resetPageScroll to still run once search is closed (original fix unaffected), but scrollTo() was called ${callsAfterClose} time(s)`);
}
console.log('Confirmed: resetPageScroll still runs normally once search is closed (original fix unaffected).');

console.log('\nERRORS:', errors);
if (errors.length) process.exit(1);
console.log('\nALL PASSED');
await browser.close();
