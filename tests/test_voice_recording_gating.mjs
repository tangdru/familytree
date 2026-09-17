import { chromium } from 'playwright-core';

// The record button hides itself (rather than showing and failing) when
// on a Supabase-connected tree that hasn't run the updated
// supabase-schema.sql yet -- see voiceRecordingReady in app.js, probed
// once in init() via a list() call against the voice-recordings bucket.
// Local-only mode (no Supabase configured at all, the case this test
// exercises) never needs the bucket, so the button always shows there.
const p1 = 'p1';
const people = {
  [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 950 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== Local-only mode: the record button shows (no bucket needed) ===');
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#addStoryBtn');
  await page.waitForTimeout(150);
  const recordBtnVisible = await page.locator('.story-record-btn').isVisible();
  console.log('Record button visible in local-only mode:', recordBtnVisible);
  if (!recordBtnVisible) throw new Error('Expected the record button to show in local-only mode');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
