import { chromium } from 'playwright-core';

function person(id, name, year, city) {
  return { id, name, birthDate: year ? `${year}-01-01` : '', deathDate: '', photo: '', notes: '', parents: [], spouses: [], locations: city ? [city] : [] };
}
const people = {};
const add = (p) => { people[p.id] = p; };
add(person('center', 'Alice Center', 1970, 'Boston, USA'));
add(person('far0', 'Far Zero', 1930, 'Paris, France')); // 40yr gap from Alice -- her own ring-4 (crowds nothing extra by itself)
// A crowd of 15, all close in age to Alice (ring 1 when she's centered),
// but ~40yr from Far Zero (ring 4 when HE's centered) -- crowding ring 1
// pushes every subsequent ring's radius outward via the cascade in
// renderCentric, so centering on Alice vs. Far Zero should produce a
// visibly different overall radius, giving the animation something real
// to animate between.
for (let i = 0; i < 15; i++) add(person(`crowd${i}`, `Crowd ${i}`, 1970 + (i % 5) - 2, 'Chicago, USA'));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.selectOption('#viewModeSelect', 'centric');
  await page.waitForTimeout(600);

  const readLabels = () => page.evaluate(() => Array.from(document.querySelectorAll('#linesSvg text')).map(t => t.textContent));

  console.log('=== Fixed ring set: all 4 age rings always drawn, even ones with no members ===');
  const labelsAtStart = await readLabels();
  console.log('labels:', JSON.stringify(labelsAtStart));
  if (labelsAtStart.length !== 4) throw new Error(`Expected exactly 4 age-ring labels always present, got ${labelsAtStart.length}: ${JSON.stringify(labelsAtStart)}`);
  const expectedLabels = ['0–5 yrs', '6–15 yrs', '16–30 yrs', '30+ yrs / unknown'];
  for (const l of expectedLabels) {
    if (!labelsAtStart.includes(l)) throw new Error(`Expected label "${l}" to always be present, got ${JSON.stringify(labelsAtStart)}`);
  }
  console.log('Confirmed: all 4 fixed age-ring labels present regardless of ring population.');

  console.log('\n=== Recentering on someone else: the SAME 4 labels stay -- axis does not change ===');
  await page.click('[data-id="far0"]'); // recenter on Far Zero -- redistributes the crowd into a different ring
  await page.waitForTimeout(100); // sample mid-transition, before the 380ms settle
  const labelsAfterClickImmediate = await readLabels();
  console.log('labels immediately after recentering:', JSON.stringify(labelsAfterClickImmediate));
  if (JSON.stringify([...labelsAfterClickImmediate].sort()) !== JSON.stringify([...labelsAtStart].sort())) {
    throw new Error(`Expected the same label set before and after recentering, got ${JSON.stringify(labelsAfterClickImmediate)}`);
  }
  await page.waitForTimeout(500);
  const labelsSettled = await readLabels();
  if (JSON.stringify([...labelsSettled].sort()) !== JSON.stringify([...labelsAtStart].sort())) {
    throw new Error(`Expected the same label set after settling too, got ${JSON.stringify(labelsSettled)}`);
  }
  console.log('Confirmed: recentering never changes which ring labels are shown (same metric).');

  console.log('\n=== Grid actually animates: ring radius is genuinely mid-flight partway through the transition ===');
  // Recenter back onto Alice and sample the OUTERMOST ring's radius at
  // several points -- if it's animating, the values should differ (not
  // jump straight to the final value). The outermost ring is also the
  // LAST to start (rings stagger innermost-first, see
  // CENTRIC_RING_STAGGER_MS), so the first sample needs to be timed past
  // its own stagger delay, not just after the transition starts overall.
  await page.click('[data-id="center"]');
  const readMaxRadius = () => page.evaluate(() =>
    Math.max(...Array.from(document.querySelectorAll('#linesSvg circle[stroke-dasharray]')).map(c => parseFloat(c.getAttribute('r'))))
  );
  await page.waitForTimeout(260); // past the 4th ring's own stagger delay (3 * 70ms), while it's still animating
  const r1 = await readMaxRadius();
  await page.waitForTimeout(100);
  const r2 = await readMaxRadius();
  await page.waitForTimeout(400); // let it fully settle
  const r3 = await readMaxRadius();
  console.log(`outer ring radius samples during transition: ${r1.toFixed(1)} -> ${r2.toFixed(1)} -> settled ${r3.toFixed(1)}`);
  if (r1 === r2) throw new Error('Expected the grid radius to be genuinely animating (different values at different points mid-transition), but it was identical');
  console.log('Confirmed: grid radius is animating, not snapping instantly.');

  console.log('\n=== Background beyond the outermost ring spans the full viewport (not just the content box) ===');
  await page.waitForTimeout(300);
  const bg = await page.evaluate(() => {
    const rect = document.querySelector('#linesSvg rect');
    const vp = document.getElementById('treeViewport').getBoundingClientRect();
    if (!rect) return null;
    const r = rect.getBoundingClientRect();
    return { rectLeft: r.left, rectTop: r.top, rectRight: r.right, rectBottom: r.bottom, vpLeft: vp.left, vpTop: vp.top, vpRight: vp.right, vpBottom: vp.bottom };
  });
  console.log('background rect vs viewport:', JSON.stringify(bg));
  if (!bg) throw new Error('Expected a background <rect> in the centric grid');
  if (bg.rectLeft > bg.vpLeft + 1 || bg.rectTop > bg.vpTop + 1 || bg.rectRight < bg.vpRight - 1 || bg.rectBottom < bg.vpBottom - 1) {
    throw new Error('Expected the background rect to fully cover the viewport, but it does not reach all edges');
  }
  console.log('Confirmed: background rect covers the entire viewport, edge to edge.');

  console.log('\n=== Background still fully covers the viewport after panning/zooming ===');
  const viewport = await page.evaluate(() => document.getElementById('treeViewport').getBoundingClientRect());
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(150);
  const bgAfterZoom = await page.evaluate(() => {
    const rect = document.querySelector('#linesSvg rect');
    const vp = document.getElementById('treeViewport').getBoundingClientRect();
    const r = rect.getBoundingClientRect();
    return { rectLeft: r.left, rectTop: r.top, rectRight: r.right, rectBottom: r.bottom, vpLeft: vp.left, vpTop: vp.top, vpRight: vp.right, vpBottom: vp.bottom };
  });
  if (bgAfterZoom.rectLeft > bgAfterZoom.vpLeft + 1 || bgAfterZoom.rectTop > bgAfterZoom.vpTop + 1 ||
      bgAfterZoom.rectRight < bgAfterZoom.vpRight - 1 || bgAfterZoom.rectBottom < bgAfterZoom.vpBottom - 1) {
    throw new Error('Expected the background rect to still cover the viewport after zooming in');
  }
  console.log('Confirmed: background still covers the full viewport after zooming.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
