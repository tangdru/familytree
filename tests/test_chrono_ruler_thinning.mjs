import { chromium } from 'playwright-core';

const gp1 = 'gp1', gp2 = 'gp2', p1 = 'p1', p2 = 'p2', c1 = 'c1', c2 = 'c2';
const people = {
  [gp1]: { id: gp1, name: 'Eleanor Hart', birthDate: '1938-03-12', deathDate: '2015-11-02', photo: '', notes: '', parents: [], spouses: [gp2] },
  [gp2]: { id: gp2, name: 'Walter Hart', birthDate: '1935-07-04', deathDate: '2012-01-20', photo: '', notes: '', parents: [], spouses: [gp1] },
  [p1]: { id: p1, name: 'Susan Hart', birthDate: '1962-05-18', deathDate: '', photo: '', notes: '', parents: [gp1, gp2], spouses: [p2] },
  [p2]: { id: p2, name: 'Michael Doe', birthDate: '1960-09-09', deathDate: '', photo: '', notes: '', parents: [], spouses: [p1] },
  [c1]: { id: c1, name: 'Jane Doe', birthDate: '1990-02-14', deathDate: '', photo: '', notes: '', parents: [p1, p2], spouses: [] },
  [c2]: { id: c2, name: 'Tom Doe', birthDate: '1993-08-30', deathDate: '', photo: '', notes: '', parents: [p1, p2], spouses: [] },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.selectOption('#viewModeSelect', 'chronological');
  await page.waitForTimeout(500);

  const measureVisible = () => page.evaluate(() => {
    const ruler = document.getElementById('chronoRuler').getBoundingClientRect();
    const labels = Array.from(document.querySelectorAll('.chrono-year-label'))
      .filter(el => getComputedStyle(el).display !== 'none')
      .map(el => {
        const r = el.getBoundingClientRect();
        return {
          text: el.textContent,
          top: r.top - ruler.top,
          left: r.left - ruler.left,
          right: (ruler.left + ruler.width) - r.right,
          width: r.width,
        };
      })
      .sort((a, b) => a.top - b.top);
    return { rulerWidth: ruler.width, labels };
  });

  console.log('=== Centering check at default zoom ===');
  const { rulerWidth, labels: labelsDefault } = await measureVisible();
  console.log('ruler width:', rulerWidth);
  for (const l of labelsDefault) {
    console.log(`  ${l.text}: left=${l.left.toFixed(1)} right=${l.right.toFixed(1)} width=${l.width}`);
    if (Math.abs(l.left - l.right) > 2) {
      throw new Error(`Expected label "${l.text}" to be horizontally centered (left=${l.left.toFixed(1)}, right=${l.right.toFixed(1)})`);
    }
  }
  console.log('Confirmed: all visible labels are horizontally centered in the ruler column.');

  console.log('\n=== Zoom out far: labels should thin out, never collide ===');
  const viewport = await page.evaluate(() => document.getElementById('treeViewport').getBoundingClientRect());
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await page.mouse.wheel(0, 3000); // zoom out hard, well past MIN_ZOOM territory
  await page.waitForTimeout(200);

  const { labels: labelsZoomedOut } = await measureVisible();
  console.log('visible labels zoomed out:', labelsZoomedOut.map(l => l.text).join(', '));
  if (labelsZoomedOut.length < 2) throw new Error('Expected at least a couple of labels to remain visible even zoomed out');

  for (let i = 1; i < labelsZoomedOut.length; i++) {
    const gap = labelsZoomedOut[i].top - labelsZoomedOut[i - 1].top;
    console.log(`  gap ${labelsZoomedOut[i - 1].text} -> ${labelsZoomedOut[i].text}: ${gap.toFixed(1)}px`);
    if (gap < 18) {
      throw new Error(`Labels "${labelsZoomedOut[i - 1].text}" and "${labelsZoomedOut[i].text}" are only ${gap.toFixed(1)}px apart -- should have been thinned`);
    }
  }
  console.log('Confirmed: no two visible labels collide when zoomed out.');

  const todayVisible = labelsZoomedOut.some(l => l.text === 'Today');
  console.log('Today label present among visible labels:', todayVisible);
  if (!todayVisible) throw new Error('Expected "Today" to remain visible even when decades around it get thinned');

  console.log('\n=== Zoom back to default: all originally-visible labels reappear ===');
  await page.mouse.wheel(0, -3000);
  await page.waitForTimeout(200);
  const { labels: labelsBack } = await measureVisible();
  console.log('visible labels back at default zoom:', labelsBack.map(l => l.text).join(', '));
  if (labelsBack.length !== labelsDefault.length) {
    throw new Error(`Expected label visibility to be restored when zooming back in (had ${labelsDefault.length}, now ${labelsBack.length})`);
  }
  console.log('Confirmed: label thinning is reversible.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
