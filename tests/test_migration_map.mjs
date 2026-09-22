import { chromium } from 'playwright-core';

// Migration Map plots each person's geocoded location history
// (birthLocation + locations[], see migrationStopsFor in app.js) as an arc
// trail on a Robinson-projection world map. Jane has 3 dated, geocoded
// stops (birth in Manila, then New York, then San Francisco) so she gets
// 2 arc segments once focused; Ana has 2 stops (Sao Paulo -> Sydney) and
// is never focused, so she stays a single flat dim-grey arc; Tom has only
// a birthLocation (1 stop) so he gets a marker but no arc at all.
const p1 = 'p1', p2 = 'p2', p3 = 'p3';
const people = {
  [p1]: {
    id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
    birthLocation: { text: 'Manila, Philippines', lat: 14.5995, lon: 120.9842, startDate: '1985-03-02', endDate: '2003-01-01' },
    locations: [
      { text: 'San Francisco, CA', lat: 37.7749, lon: -122.4194, startDate: '2010-01-01', endDate: null },
      { text: 'New York, NY', lat: 40.7128, lon: -74.006, startDate: '2003-01-01', endDate: '2010-01-01' },
    ],
  },
  [p2]: {
    id: p2, name: 'Tom Doe', birthDate: '1990-06-15', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
    birthLocation: { text: 'London, UK', lat: 51.5074, lon: -0.1278, startDate: '1990-06-15', endDate: null },
  },
  [p3]: {
    id: p3, name: 'Ana Cruz', birthDate: '1978-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
    birthLocation: { text: 'Sao Paulo, Brazil', lat: -23.5505, lon: -46.6333, startDate: '1978-01-01', endDate: '2005-01-01' },
    locations: [{ text: 'Sydney, Australia', lat: -33.8688, lon: 151.2093, startDate: '2005-01-01', endDate: null }],
  },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== Migration Map is a selectable view mode ===');
  const hasOption = await page.evaluate(() => !!document.querySelector('#viewModeSelect option[value="migration"]'));
  if (!hasOption) throw new Error('Expected #viewModeSelect to have a "migration" option');
  console.log('Confirmed: dropdown has a Migration Map option.');

  console.log('\n=== Switching to it shows the Static/Dynamic toggle and lazy-loads the map ===');
  await page.selectOption('#viewModeSelect', 'migration');
  await page.waitForTimeout(900); // first load: vendored d3/topojson/world-atlas fetch
  const toggleOpacity = await page.evaluate(() => getComputedStyle(document.getElementById('migrationModeToggle')).opacity);
  if (parseFloat(toggleOpacity) < 0.9) throw new Error(`Expected the Static/Dynamic toggle visible, opacity was ${toggleOpacity}`);
  const landDrawn = await page.evaluate(() => !!document.querySelector('#linesSvg path'));
  if (!landDrawn) throw new Error('Expected a filled land path in #linesSvg once the map libs finish loading');
  const markerCount = await page.evaluate(() => document.querySelectorAll('.migration-marker').length);
  if (markerCount !== 3) throw new Error(`Expected 3 markers (one per person with a geocoded stop), got ${markerCount}`);
  console.log('Confirmed: toggle visible, land drawn, 3 markers placed.');

  console.log('\n=== Everyone starts dim grey with no arc-focus and no gradients ===');
  const initialGradients = await page.evaluate(() => document.querySelectorAll('linearGradient').length);
  if (initialGradients !== 0) throw new Error(`Expected no focused (gradient) arcs before any marker is clicked, got ${initialGradients}`);
  console.log('Confirmed: no one is focused by default.');

  console.log('\n=== Clicking a marker focuses that person: magenta gradient arcs, focused ring ===');
  await page.click(`.migration-marker[data-id="${p1}"]`);
  await page.waitForTimeout(400);
  const janeFocused = await page.evaluate((id) => document.querySelector(`.migration-marker[data-id="${id}"]`).classList.contains('focused'), p1);
  if (!janeFocused) throw new Error("Expected Jane's marker to gain the .focused class after being clicked");
  const janeGradients = await page.evaluate(() => document.querySelectorAll('linearGradient').length);
  if (janeGradients !== 2) throw new Error(`Expected 2 gradient arc segments for Jane's 3 stops, got ${janeGradients}`);
  const anaStroke = await page.evaluate((id) => {
    const marker = document.querySelector(`.migration-marker[data-id="${id}"]`);
    return marker && marker.classList.contains('focused');
  }, p3);
  if (anaStroke) throw new Error('Expected Ana to remain unfocused while Jane is focused');
  console.log("Confirmed: Jane's path renders as 2 gradient magenta segments; Ana stays unfocused.");

  console.log('\n=== Clicking the already-focused marker opens her profile instead (Centric-style convention) ===');
  await page.click(`.migration-marker[data-id="${p1}"]`);
  await page.waitForTimeout(400);
  const modalHidden = await page.evaluate(() => document.getElementById('personViewModal').hidden);
  const modalName = await page.evaluate(() => document.getElementById('viewName')?.textContent || '');
  if (modalHidden) throw new Error('Expected the Person View to open when clicking the already-focused marker');
  if (!modalName.includes('Jane')) throw new Error(`Expected the opened profile to be Jane's, got: ${modalName}`);
  console.log("Confirmed: re-clicking the focused marker opens Jane's profile.");
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(200);

  console.log('\n=== Switching to Dynamic hides the map and shows the placeholder ===');
  await page.click('#migrationModeToggle .centric-metric-btn[data-mode="dynamic"]');
  await page.waitForTimeout(300);
  const placeholderHidden = await page.evaluate(() => document.getElementById('migrationDynamicPlaceholder').hidden);
  const markersInDynamic = await page.evaluate(() => document.querySelectorAll('.migration-marker').length);
  if (placeholderHidden) throw new Error('Expected the Dynamic-mode placeholder to be visible');
  if (markersInDynamic !== 0) throw new Error(`Expected no markers drawn in Dynamic mode, got ${markersInDynamic}`);
  console.log('Confirmed: Dynamic mode shows the "coming soon" placeholder instead of the map.');

  console.log('\n=== Switching back to Static restores the map ===');
  await page.click('#migrationModeToggle .centric-metric-btn[data-mode="static"]');
  await page.waitForTimeout(300);
  const markersBack = await page.evaluate(() => document.querySelectorAll('.migration-marker').length);
  if (markersBack !== 3) throw new Error(`Expected 3 markers again after switching back to Static, got ${markersBack}`);
  console.log('Confirmed: Static mode restores the full map.');

  console.log('\n=== Leaving Migration Map for another view hides the toggle and placeholder ===');
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(400);
  const toggleOpacityAfter = await page.evaluate(() => getComputedStyle(document.getElementById('migrationModeToggle')).opacity);
  const placeholderHiddenAfter = await page.evaluate(() => document.getElementById('migrationDynamicPlaceholder').hidden);
  if (parseFloat(toggleOpacityAfter) > 0.1) throw new Error('Expected the Static/Dynamic toggle to fade out after leaving Migration Map');
  if (!placeholderHiddenAfter) throw new Error('Expected the Dynamic placeholder to be hidden after leaving Migration Map');
  console.log('Confirmed: toggle and placeholder both clean up on view switch.');

  console.log('\nERRORS:', errors);
  if (errors.length) throw new Error('Unexpected page errors: ' + JSON.stringify(errors));
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
