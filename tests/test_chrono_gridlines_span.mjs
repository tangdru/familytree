import { chromium } from 'playwright-core';

const gp1 = 'gp1', gp2 = 'gp2', p1 = 'p1', p2 = 'p2';
const people = {
  [gp1]: { id: gp1, name: 'Eleanor Hart', birthDate: '1938-03-12', deathDate: '2015-11-02', photo: '', notes: '', parents: [], spouses: [gp2] },
  [gp2]: { id: gp2, name: 'Walter Hart', birthDate: '1935-07-04', deathDate: '2012-01-20', photo: '', notes: '', parents: [], spouses: [gp1] },
  [p1]: { id: p1, name: 'Susan Hart', birthDate: '1962-05-18', deathDate: '', photo: '', notes: '', parents: [gp1, gp2], spouses: [p2] },
  [p2]: { id: p2, name: 'Michael Doe', birthDate: '1960-09-09', deathDate: '', photo: '', notes: '', parents: [], spouses: [p1] },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.selectOption('#viewModeSelect', 'chronological');
  await page.waitForTimeout(600);

  const measureGridlines = () => page.evaluate(() => {
    const viewport = document.getElementById('treeViewport').getBoundingClientRect();
    const lines = Array.from(document.querySelectorAll('#linesSvg > line'))
      .filter(el => el.getAttribute('stroke-width') === '1');
    return lines.map(el => {
      const r = el.getBoundingClientRect();
      return { screenLeft: r.left - viewport.left, screenRight: r.right - viewport.left, width: viewport.width };
    });
  });

  console.log('=== Default (auto-fit) zoom: content likely narrower than the 1200px viewport ===');
  let lines = await measureGridlines();
  console.log(JSON.stringify(lines[0]));
  for (const l of lines) {
    if (l.screenLeft > 1) throw new Error(`Expected gridline to reach the viewport's left edge, but it starts at ${l.screenLeft}px`);
    if (l.screenRight < l.width - 1) throw new Error(`Expected gridline to reach the viewport's right edge (${l.width}px), but it ends at ${l.screenRight}px`);
  }
  console.log('Confirmed: gridlines span the full viewport width at default zoom.');

  console.log('\n=== Zoomed in: gridlines should still span the full (now differently-positioned) viewport ===');
  const viewport = await page.evaluate(() => document.getElementById('treeViewport').getBoundingClientRect());
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(150);
  lines = await measureGridlines();
  for (const l of lines) {
    if (l.screenLeft > 1) throw new Error(`Zoomed in: expected gridline to reach left edge, starts at ${l.screenLeft}px`);
    if (l.screenRight < l.width - 1) throw new Error(`Zoomed in: expected gridline to reach right edge (${l.width}px), ends at ${l.screenRight}px`);
  }
  console.log('Confirmed: gridlines still span the full viewport width when zoomed in.');

  console.log('\n=== Panned far to the side: gridlines should still cover the viewport ===');
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await page.mouse.down();
  await page.mouse.move(viewport.x + viewport.width / 2 - 900, viewport.y + viewport.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  lines = await measureGridlines();
  for (const l of lines) {
    if (l.screenLeft > 1) throw new Error(`Panned: expected gridline to reach left edge, starts at ${l.screenLeft}px`);
    if (l.screenRight < l.width - 1) throw new Error(`Panned: expected gridline to reach right edge (${l.width}px), ends at ${l.screenRight}px`);
  }
  console.log('Confirmed: gridlines still span the full viewport width after panning.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
