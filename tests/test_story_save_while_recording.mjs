import { chromium } from 'playwright-core';

// Reproduces two real bugs reported from a phone: tapping Save while a
// story's voice recording was still running did nothing visible (Save only
// ever looked at the already-finished audioBlob, which stays null until the
// recorder's own 'stop' event fires), and a voice-only story (recording,
// no typed text) couldn't be saved at all because Save unconditionally
// required non-empty text.
const alice = 'alice';
const people = {
  [alice]: { id: alice, name: 'Alice Doe', birthDate: '1950-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  await page.click('.person-card:has-text("Alice Doe")');
  await page.waitForTimeout(200);
  await page.click('#addStoryBtn');
  await page.waitForTimeout(100);

  console.log('=== Tapping Save while still recording, with no typed text, finishes the recording and saves it ===');
  await page.click('.story-record-btn');
  await page.waitForTimeout(300);
  if (await page.locator('.story-record-btn.is-recording').count() !== 1) throw new Error('Expected recording to be in progress before tapping Save');
  await page.click('.story-editor-footer .btn-primary');
  await page.waitForTimeout(500);

  const stillEditing = await page.locator('.story-editor').count();
  if (stillEditing !== 0) throw new Error('Expected the editor to close (story saved) after tapping Save mid-recording, but it is still open');
  const cardAudioSrc = await page.locator('.story-audio').getAttribute('src');
  if (!cardAudioSrc || !cardAudioSrc.startsWith('data:audio')) throw new Error(`Expected the saved story to carry a playable audio src, got: ${(cardAudioSrc || '').slice(0, 30)}`);
  console.log('Confirmed: Save mid-recording finishes the recording and saves a voice-only story.');

  console.log('\n=== The saved story has no text, only audio, and that is fine ===');
  const cardText = await page.locator('.story-text').first().textContent();
  if ((cardText || '').trim() !== '') throw new Error(`Expected an empty text for a voice-only story, got: "${cardText}"`);
  console.log('Confirmed: an audio-only story with empty text saved and rendered without error.');

  console.log('\nERRORS:', errors);
  if (errors.length) throw new Error('Unexpected page errors: ' + JSON.stringify(errors));
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
