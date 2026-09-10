import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 1000 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== Add Person: firing submit multiple times back-to-back (before the first save resolves) should only create ONE person ===');
  await page.click('#addPersonBtn');
  await page.waitForTimeout(200);
  await page.click('#nameInput');
  await page.keyboard.type('Impatient Tapper');

  // Fire requestSubmit() three times synchronously in one turn -- this is
  // the actual race: on a slow (e.g. Supabase) save, each extra tap used to
  // land before the first submission's isSavingPerson guard was set by an
  // earlier turn, generating its own uid() and its own duplicate person.
  // Calling requestSubmit() repeatedly in the same synchronous block
  // reproduces that race deterministically regardless of real network
  // timing, since the async handler only yields at its first `await`.
  const submitCount = await page.evaluate(() => {
    const form = document.getElementById('personForm');
    let n = 0;
    for (let i = 0; i < 3; i++) { form.requestSubmit(); n++; }
    return n;
  });
  console.log('requestSubmit() calls fired synchronously:', submitCount);
  await page.waitForTimeout(300);

  const peopleAfter = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('familytree.data.v1')).people));
  const tapperCards = peopleAfter.filter(p => p.name === 'Impatient Tapper');
  console.log('number of "Impatient Tapper" records saved:', tapperCards.length);
  if (tapperCards.length !== 1) throw new Error(`Expected exactly 1 saved person, got ${tapperCards.length} (duplicate-save bug)`);

  const cardCount = await page.locator('.person-card:has-text("Impatient Tapper")').count();
  console.log('number of "Impatient Tapper" cards rendered on the tree:', cardCount);
  if (cardCount !== 1) throw new Error(`Expected exactly 1 rendered tree card, got ${cardCount}`);

  console.log('\n=== Save button should be back to normal (enabled, "Save") after the dust settles ===');
  const btnState = await page.evaluate(() => {
    const btn = document.querySelector('#personForm button[type="submit"]');
    return { disabled: btn.disabled, text: btn.textContent };
  });
  console.log(JSON.stringify(btnState));
  if (btnState.disabled) throw new Error('Expected the Save button to be re-enabled after saving');
  if (btnState.text !== 'Save') throw new Error('Expected the Save button text to be restored to "Save"');

  console.log('\n=== While a save is genuinely in flight, the button reads "Saving…" and is disabled ===');
  // Reopen and check the button's state synchronously right as the first
  // requestSubmit() call is in flight (still inside its microtask before
  // saveData() resolves).
  await page.waitForTimeout(200); // let the view/toast settle from the previous save
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.click('#addPersonBtn');
  await page.waitForTimeout(200);
  await page.click('#nameInput');
  await page.keyboard.type('Second Person');
  const midSaveState = await page.evaluate(() => {
    const form = document.getElementById('personForm');
    const btn = document.querySelector('#personForm button[type="submit"]');
    form.requestSubmit();
    // Read the button's state immediately after -- still synchronous,
    // before the async handler's first await has resolved.
    return { disabled: btn.disabled, text: btn.textContent };
  });
  console.log(JSON.stringify(midSaveState));
  if (!midSaveState.disabled) throw new Error('Expected the Save button to be disabled immediately upon submitting');
  if (midSaveState.text !== 'Saving…') throw new Error('Expected the Save button to read "Saving…" immediately upon submitting');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
