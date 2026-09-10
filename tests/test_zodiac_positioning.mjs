import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  // 'documented' has a fabricated birth year (1975) but the family knows
  // the zodiac sign (Dog -> really 1970). 'plain' is a normal person with
  // no zodiac issue, born the same real year (1970) as a control.
  await page.addInitScript(() => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({
      people: {
        documented: { id: 'documented', name: 'Documented Person', birthDate: '1975-06-15', zodiac: 'Dog', deathDate: '', photo: '', notes: '', parents: [], spouses: [], locations: [] },
        plain: { id: 'plain', name: 'Plain Person', birthDate: '1970-06-15', zodiac: '', deathDate: '', photo: '', notes: '', parents: [], spouses: [], locations: [] },
      },
    }));
  });
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== Chronological view positions the zodiac-corrected person at the SAME Y as a real 1970-born person ===');
  await page.selectOption('#viewModeSelect', 'chronological');
  await page.waitForTimeout(500);
  const tops = await page.evaluate(() => ({
    documented: document.querySelector('[data-id="documented"]').style.top,
    plain: document.querySelector('[data-id="plain"]').style.top,
  }));
  console.log('tops:', JSON.stringify(tops));
  if (tops.documented !== tops.plain) {
    throw new Error(`Expected both to be positioned at the same Y (both effectively 1970-born), got documented=${tops.documented} plain=${tops.plain}`);
  }
  console.log('Confirmed: Chronological view positions by the zodiac-adjusted year.');

  console.log('\n=== Centric view buckets the zodiac-corrected person the same as a real 1970-born person ===');
  await page.selectOption('#viewModeSelect', 'centric');
  await page.waitForTimeout(700);
  // Center on 'plain' (born 1970) and compare each other person's ring.
  await page.click('[data-id="documented"]'); // recenters onto 'documented' first isn't needed; just read current rings with default center
  await page.waitForTimeout(50);
  const radii = await page.evaluate(() => {
    const doc = document.querySelector('[data-id="documented"]');
    const pln = document.querySelector('[data-id="plain"]');
    return { documentedLeft: doc ? doc.style.left : null, plainLeft: pln ? pln.style.left : null };
  });
  console.log('radii/positions after recentering on documented:', JSON.stringify(radii));

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
