import { chromium } from 'playwright-core';

const errors = [];
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--allow-file-access-from-files',
  ],
});
const context = await browser.newContext({ permissions: ['microphone'] });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !msg.text().includes('favicon')) errors.push('console.error: ' + msg.text());
});

await page.goto('http://127.0.0.1:8934/index.html');
await page.waitForSelector('#songTitle');

// Tuner
await page.click('.tab-btn[data-tab="tuner"]');
await page.click('#tunerToggleBtn');
await page.waitForTimeout(1500);
const tunerBtnText = await page.textContent('#tunerToggleBtn');
console.log('tuner button after start:', tunerBtnText);
if (!tunerBtnText.includes('Stop')) throw new Error('tuner did not start');
await page.click('#tunerToggleBtn');

// Rhythm coach
await page.click('.tab-btn[data-tab="rhythm"]');
await page.click('#rhythmToggleBtn');
await page.waitForTimeout(2000);
const rhythmBtnText = await page.textContent('#rhythmToggleBtn');
const dotCount = await page.locator('.beat-dot').count();
console.log('rhythm button after start:', rhythmBtnText, '| beat dots (from fake silent audio, may be 0):', dotCount);
if (!rhythmBtnText.includes('Stop')) throw new Error('rhythm coach did not start');
await page.click('#rhythmToggleBtn');

// Key detect (short-circuit by checking it starts without throwing; full 6s wait is slow)
await page.click('#detectKeyBtn');
await page.waitForTimeout(500);
const detectBtnText = await page.textContent('#detectKeyBtn');
console.log('detect key button mid-listen:', detectBtnText);
if (!detectBtnText.includes('Listening')) throw new Error('key detect did not start listening');

await browser.close();

if (errors.length) {
  console.error('CONSOLE/PAGE ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('OK: mic-based features start/stop without errors');
