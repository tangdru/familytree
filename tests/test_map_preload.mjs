import { chromium } from 'playwright-core';

// Map View's vendored libraries (d3, d3-geo-projection, topojson-client,
// countries-110m.json -- see ensureMapLibs in app.js) are preloaded in the
// background right after the initial render, via requestIdleCallback, so
// the first time someone actually opens Map View doesn't have to wait on
// ~450KB of JS/JSON. This test never touches #viewModeSelect at all --
// it's checking that the preload fires purely from a normal page load.
const p1 = 'p1';
const people = {
  [p1]: {
    id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
    birthLocation: { text: 'Manila, Philippines', lat: 14.5995, lon: 120.9842 },
  },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  const mapLibRequests = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/\/(d3\.min\.js|d3-geo-projection\.min\.js|topojson-client\.min\.js|countries-110m\.json)(\?|$)/.test(u)) {
      mapLibRequests.push(u);
    }
  });
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });

  console.log('=== Map libraries load in the background without ever opening Map View ===');
  await page.waitForFunction(
    () => typeof window.d3 !== 'undefined' && typeof window.d3.geoRobinson === 'function' && typeof window.topojson !== 'undefined',
    { timeout: 5000 },
  );
  const expectedFiles = ['d3.min.js', 'd3-geo-projection.min.js', 'topojson-client.min.js', 'countries-110m.json'];
  for (const file of expectedFiles) {
    if (!mapLibRequests.some(u => u.includes(file))) throw new Error(`Expected ${file} to have been requested during background preload, but it wasn't`);
  }
  console.log('Confirmed: all 4 vendored map files requested and d3/topojson available on window, with #viewModeSelect never touched.');

  console.log('\n=== Switching to Map View afterward renders near-instantly (libs already warm) ===');
  const start = Date.now();
  await page.selectOption('#viewModeSelect', 'map');
  await page.waitForFunction(() => document.querySelectorAll('#treeContent .person-card').length > 0, { timeout: 2000 });
  const elapsed = Date.now() - start;
  // A cold (non-preloaded) load of these ~450KB of vendored files plus a
  // country-topology parse reliably takes several hundred ms+ on top of
  // the render itself -- a generous 800ms ceiling still clearly
  // distinguishes "libs were already warm" from "loading from scratch".
  if (elapsed > 800) throw new Error(`Expected Map View to render near-instantly with preloaded libs, took ${elapsed}ms`);
  console.log(`Confirmed: Map View rendered in ${elapsed}ms after the libs were already preloaded.`);

  console.log('\nERRORS:', errors);
  if (errors.length) throw new Error('Unexpected page errors: ' + JSON.stringify(errors));
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
