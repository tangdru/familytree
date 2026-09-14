import { chromium } from 'playwright-core';

// Voice recording needs a real (fake) media device -- these two flags make
// Chromium serve a synthetic audio/video stream and auto-grant the
// getUserMedia prompt, so MediaRecorder has something to actually record
// without a human present.
const alice = 'alice';
const people = {
  [alice]: { id: alice, name: 'Alice Doe', birthDate: '1950-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
try {
  const context = await browser.newContext({ viewport: { width: 480, height: 950 }, permissions: ['microphone'] });
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
  await page.fill('.story-editor-textarea', 'A story with a recording');

  console.log('=== Clicking the mic button starts recording ===');
  await page.click('.story-record-btn');
  await page.waitForTimeout(300);
  if (await page.locator('.story-record-btn.is-recording').count() !== 1) throw new Error('Expected the record button to show a recording state after clicking it');
  console.log('Confirmed: recording starts and the button reflects it.');

  await page.waitForTimeout(1200);

  console.log('\n=== Clicking it again stops recording and shows a preview ===');
  await page.click('.story-record-btn');
  await page.waitForTimeout(500);
  if (await page.locator('.story-record-btn.is-recording').count() !== 0) throw new Error('Expected the recording state to clear after stopping');
  if (!(await page.locator('.story-editor-audio').isVisible())) throw new Error('Expected an audio preview to appear after stopping the recording');
  const previewSrc = await page.locator('.story-editor-audio audio').getAttribute('src');
  if (!previewSrc || !previewSrc.startsWith('blob:')) throw new Error(`Expected a blob: preview URL, got: ${previewSrc}`);
  console.log('Confirmed: stopping produces a playable preview.');

  console.log('\n=== Removing the recording before saving clears the preview ===');
  await page.click('.story-editor-audio .icon-btn');
  await page.waitForTimeout(100);
  if (await page.locator('.story-editor-audio').isVisible()) throw new Error('Expected removing the recording to hide the preview');
  console.log('Confirmed: the remove button clears a not-yet-saved recording.');

  console.log('\n=== Re-recording and saving embeds the audio on the story card ===');
  await page.click('.story-record-btn');
  await page.waitForTimeout(1200);
  await page.click('.story-record-btn');
  await page.waitForTimeout(500);
  await page.click('.story-editor-footer .btn-primary');
  await page.waitForTimeout(500);
  const cardAudioSrc = await page.locator('.story-audio').getAttribute('src');
  // Local-only mode (no Supabase configured) embeds the recording directly
  // as a data URL, the same fallback photos already use.
  if (!cardAudioSrc || !cardAudioSrc.startsWith('data:audio')) throw new Error(`Expected the saved story to carry a playable audio src, got: ${(cardAudioSrc || '').slice(0, 30)}`);
  console.log('Confirmed: the saved story has a playable recording attached.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
