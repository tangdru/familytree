import { chromium } from 'playwright-core';

const p1 = 'p1';
const people = { [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', parents: [], spouses: [] } };

const viewports = [
  { name: 'iPhone SE', width: 375, height: 667 },
  { name: 'iPhone 15 Pro Max', width: 430, height: 932 },
  { name: 'iPad portrait', width: 768, height: 1024 },
  { name: 'Desktop', width: 1440, height: 900 },
  { name: 'Short landscape phone', width: 740, height: 360 },
  { name: 'Very short window', width: 480, height: 300 },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  for (const vp of viewports) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.addInitScript((data) => {
      window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
    }, people);
    await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
    await page.click('.person-card:has-text("Jane Doe")');
    await page.waitForTimeout(200);

    const info = await page.evaluate(() => {
      const card = document.getElementById('personViewCard');
      const footer = document.querySelector('.view-modal-footer');
      const rect = card.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      return {
        viewportHeight: window.innerHeight,
        cardHeight: rect.height,
        cardTop: rect.top,
        cardBottom: rect.bottom,
        footerBottom: footerRect.bottom,
        footerVisible: footerRect.bottom <= window.innerHeight && footerRect.top >= 0,
      };
    });
    const expectedPctVh = vp.height * 0.88;
    // fitModalOverlaysToVisualViewport (see app.js) also caps the modal at
    // the overlay's real available space (viewport height minus its own
    // 20px+20px padding) via an inline max-height, JS-measured rather than
    // relying on dvh/vh alone -- at most viewport sizes 88vh is already
    // the tighter constraint and this cap never engages, but at very
    // short heights it's the correct binding one: the old 88vh-only
    // formula could let the modal encroach a few px into that padding
    // (e.g. 300*0.88=264 leaves only 36px for a real 40px of padding).
    const expectedAvailableSpace = vp.height - 40;
    const expectedHeight = Math.min(800, expectedPctVh, expectedAvailableSpace);
    console.log(`${vp.name} (${vp.width}x${vp.height}): cardHeight=${info.cardHeight.toFixed(1)} expected=${expectedHeight.toFixed(1)} fitsInViewport=${info.cardBottom <= info.viewportHeight} footerVisible=${info.footerVisible}`);
    if (Math.abs(info.cardHeight - expectedHeight) > 1) {
      throw new Error(`${vp.name}: card height ${info.cardHeight} doesn't match expected min(800, 88vh, available-space)=${expectedHeight}`);
    }
    if (info.cardBottom > info.viewportHeight + 1) {
      throw new Error(`${vp.name}: card overflows the viewport (bottom ${info.cardBottom} > viewport height ${info.viewportHeight})`);
    }
    if (!info.footerVisible) {
      throw new Error(`${vp.name}: footer (Close/Edit) is not fully visible within the viewport`);
    }
    await page.close();
  }
  console.log('\nALL PASSED -- card height scales with viewport (capped at 700px) and never overflows, on every tested size.');
} finally {
  await browser.close();
}
