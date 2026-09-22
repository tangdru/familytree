import { chromium } from 'playwright-core';

// Globe View's vendored libraries (d3, topojson-client, countries-110m.json
// -- see ensureGlobeLibs in app.js) are preloaded in the background right
// after the initial render, via requestIdleCallback, so the first time
// someone actually opens Globe View doesn't have to wait on ~400KB of
// JS/JSON. This test never touches #viewModeSelect at all -- it's checking
// that the preload fires purely from a normal page load.
const p1 = 'p1';
const people = {
  // New York sits well within the default rotation's front-facing
  // hemisphere (GLOBE_DEFAULT_ROTATION centers the Americas/Atlantic) --
  // unlike Manila, this renders as a visible marker on entry.
  [p1]: {
    id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
    birthLocation: { text: 'New York, USA', lat: 40.7128, lon: -74.006 },
  },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  const globeLibRequests = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/\/(d3\.min\.js|topojson-client\.min\.js|countries-110m\.json)(\?|$)/.test(u)) {
      globeLibRequests.push(u);
    }
  });
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });

  console.log('=== Globe libraries load in the background without ever opening Globe View ===');
  await page.waitForFunction(
    () => typeof window.d3 !== 'undefined' && typeof window.d3.geoOrthographic === 'function' && typeof window.topojson !== 'undefined',
    { timeout: 5000 },
  );
  const expectedFiles = ['d3.min.js', 'topojson-client.min.js', 'countries-110m.json'];
  for (const file of expectedFiles) {
    if (!globeLibRequests.some(u => u.includes(file))) throw new Error(`Expected ${file} to have been requested during background preload, but it wasn't`);
  }
  console.log('Confirmed: all 3 vendored globe files requested and d3/topojson available on window, with #viewModeSelect never touched.');

  console.log('\n=== Switching to Globe View afterward renders near-instantly (libs already warm) ===');
  const start = Date.now();
  await page.selectOption('#viewModeSelect', 'globe');
  await page.waitForFunction(() => document.querySelectorAll('#treeContent .map-card').length > 0, { timeout: 2000 });
  const elapsed = Date.now() - start;
  // A cold (non-preloaded) load of these ~400KB of vendored files plus a
  // country-topology parse reliably takes several hundred ms+ on top of
  // the render itself -- a generous 800ms ceiling still clearly
  // distinguishes "libs were already warm" from "loading from scratch".
  if (elapsed > 800) throw new Error(`Expected Globe View to render near-instantly with preloaded libs, took ${elapsed}ms`);
  console.log(`Confirmed: Globe View rendered in ${elapsed}ms after the libs were already preloaded.`);

  console.log('\nERRORS:', errors);
  if (errors.length) throw new Error('Unexpected page errors: ' + JSON.stringify(errors));
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
