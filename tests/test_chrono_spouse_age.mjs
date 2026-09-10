import { chromium } from 'playwright-core';

// Michael has recorded parents (a blood lineage) -- Susan married in (no
// recorded parents), but her OWN birth year (1935) is known and is much
// earlier than Michael's (1960). Her card should sit at her OWN age now,
// not be pinned to Michael's row.
// Grace also married in, but has NO birth year on record at all -- she
// should still fall back to sitting with her partner Tom (whose year is
// known), since there's nothing else to place her by.
const people = {
  grandpa: { id: 'grandpa', name: 'Grandpa Doe', birthDate: '1930-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
  michael: { id: 'michael', name: 'Michael Doe', birthDate: '1960-01-01', deathDate: '', photo: '', notes: '', parents: ['grandpa'], spouses: ['susan'] },
  susan: { id: 'susan', name: 'Susan Hart', birthDate: '1935-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: ['michael'] },
  tom: { id: 'tom', name: 'Tom Doe', birthDate: '1958-01-01', deathDate: '', photo: '', notes: '', parents: ['grandpa'], spouses: ['grace'] },
  grace: { id: 'grace', name: 'Grace Unknown', birthDate: '', deathDate: '', photo: '', notes: '', parents: [], spouses: ['tom'] },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.selectOption('#viewModeSelect', 'chronological');
  await page.waitForTimeout(300);

  const tops = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.person-card'));
    const out = {};
    for (const c of cards) {
      const name = c.querySelector('.person-name').textContent;
      out[name] = { top: parseFloat(c.style.top), marriedIn: c.classList.contains('married-in') };
    }
    return out;
  });
  console.log(JSON.stringify(tops, null, 2));

  if (!(tops['Susan Hart'].top < tops['Michael Doe'].top)) {
    throw new Error('Expected Susan (b.1935) to sit ABOVE Michael (b.1960), not pinned to his row');
  }
  if (!tops['Susan Hart'].marriedIn) throw new Error('Expected Susan to still show the married-in dashed border (no recorded parents)');
  console.log('Susan is above Michael:', tops['Susan Hart'].top, '<', tops['Michael Doe'].top, '-- OK, unlinked from spouse age');

  if (tops['Grace Unknown'].top !== tops['Tom Doe'].top) {
    throw new Error('Expected Grace (no birth year at all) to still fall back to aligning with Tom');
  }
  if (!tops['Grace Unknown'].marriedIn) throw new Error('Expected Grace to show the married-in dashed border too');
  console.log('Grace (no DOB) still aligns with Tom:', tops['Grace Unknown'].top, '===', tops['Tom Doe'].top, '-- OK, fallback preserved');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
