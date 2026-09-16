import { chromium } from 'playwright-core';

// The edit form only auto-fills zodiac live as someone's OWN birthdate
// field is touched (see maybeAutoSetZodiac) -- which never happens for
// existing people nobody's re-opened since. backfillZodiacs (see init in
// app.js) fills in a blank zodiac from a known birthdate once on load,
// but must never touch a zodiac that's already set (it can deliberately
// differ from the documented birth year -- see zodiacAdjustedBirthDate).
const a = 'a', b = 'b', c = 'c';
const people = {
  [a]: { id: a, name: 'Alice Doe', birthDate: '1988-05-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
  [b]: { id: b, name: 'Bob Doe', birthDate: '1988-05-01', deathDate: '', photo: '', notes: '', zodiac: 'Rabbit', parents: [], spouses: [] },
  [c]: { id: c, name: 'Carol Doe', birthDate: '', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
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
  await page.waitForTimeout(500);

  console.log('=== A known birthdate with no zodiac gets backfilled on load ===');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people);
  console.log(JSON.stringify({ alice: saved.a.zodiac, bob: saved.b.zodiac, carol: saved.c.zodiac }));
  if (saved.a.zodiac !== 'Dragon') throw new Error(`Expected Alice (born 1988-05-01) backfilled to Dragon, got: ${saved.a.zodiac}`);
  console.log('Confirmed: a blank zodiac is inferred from the known birthdate.');

  console.log('\n=== An already-set zodiac is never overwritten ===');
  if (saved.b.zodiac !== 'Rabbit') throw new Error(`Expected Bob's existing (deliberately different) zodiac to survive untouched, got: ${saved.b.zodiac}`);
  console.log('Confirmed: an existing zodiac is left alone even when it doesn\'t match the birth year.');

  console.log('\n=== No birthdate means nothing to infer from -- stays blank ===');
  if (saved.c.zodiac) throw new Error(`Expected Carol (no birthdate) to stay blank, got: ${saved.c.zodiac}`);
  console.log('Confirmed: a person with no birthdate is left alone.');

  console.log('\n=== The view card reflects the backfilled zodiac ===');
  await page.click('.person-card:has-text("Alice Doe")');
  await page.waitForTimeout(300);
  const meta = await page.evaluate(() => document.getElementById('viewMeta').textContent);
  console.log('Alice meta line:', meta);
  if (!meta.includes('Dragon')) throw new Error(`Expected the view card to show Dragon, got: ${meta}`);
  console.log('Confirmed: the backfilled zodiac shows up on the person view card.');

  console.log('\n=== Reloading again is a no-op (idempotent) ===');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const savedAgain = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people);
  if (savedAgain.a.zodiac !== 'Dragon' || savedAgain.b.zodiac !== 'Rabbit' || savedAgain.c.zodiac) {
    throw new Error(`Expected a second load to leave everything as-is, got: ${JSON.stringify({ a: savedAgain.a.zodiac, b: savedAgain.b.zodiac, c: savedAgain.c.zodiac })}`);
  }
  console.log('Confirmed: re-running the backfill on a later load changes nothing further.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
