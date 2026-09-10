import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
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
  await page.selectOption('#viewModeSelect', 'centric');
  await page.waitForTimeout(700);
  await page.click('[data-id="documented"]');
  await page.waitForTimeout(700);

  const dist = await page.evaluate(() => {
    const center = document.querySelector('.centric-center-card');
    const plain = document.querySelector('[data-id="plain"]');
    const cr = center.getBoundingClientRect(), pr = plain.getBoundingClientRect();
    const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    const px = pr.left + pr.width / 2, py = pr.top + pr.height / 2;
    const scale = parseFloat(document.getElementById('treeCanvas').style.transform.match(/scale\(([\d.]+)\)/)[1]);
    return Math.hypot(px - cx, py - cy) / scale;
  });
  console.log('distance from center to plain (content-space):', dist.toFixed(1), '-- expect ~220 (ring 1, since both are effectively 1970)');
  if (dist > 260) throw new Error(`Expected ring-1 distance (~220), got ${dist.toFixed(1)} -- suggests the zodiac-adjusted year is NOT being used for Centric's age ring`);
  console.log('ALL PASSED');
} finally {
  await browser.close();
}
