import { chromium } from 'playwright-core';

// Map View plots each person's CURRENT location only (locations[0], or
// birthLocation as a fallback -- see currentLocationCoordsOf in app.js) on
// a Robinson-projection world map. Markers/clusters render at a constant
// on-screen size regardless of the map's own zoom (MAP_MARKER_TARGET_SCALE,
// counter-scaled against view.scale -- see updateMapZoomLevel), and people
// too close together to tell apart at the current zoom collapse into a
// single numbered cluster badge (clusterMapPoints) instead of overlapping
// cards. Clicking a cluster zooms in on it; a cluster that's STILL not
// resolvable once MAX_ZOOM is reached (an exact shared address, which no
// amount of zoom can ever separate) falls back to a fanned row instead of
// staying an unbreakable cluster forever.
const p1 = 'p1', p2 = 'p2', p3 = 'p3', p4 = 'p4';
const people = {
  // Far from everyone else -- always its own individual card, at any zoom.
  [p1]: {
    id: p1, name: 'Ana Cruz', birthDate: '1978-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
    birthLocation: { text: 'Sydney, Australia', lat: -33.8688, lon: 151.2093 },
  },
  // Exact same coordinates as p3 -- can never be separated by zooming
  // alone, so this pair should always end up as a "2" cluster until
  // MAX_ZOOM, then fall back to a fanned row.
  [p2]: {
    id: p2, name: 'Tom Doe', birthDate: '1990-06-15', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
    birthLocation: { text: 'London, UK', lat: 51.5074, lon: -0.1278 },
  },
  [p3]: {
    id: p3, name: 'Ravi Singh', birthDate: '1988-11-20', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
    birthLocation: { text: 'London, UK', lat: 51.5074, lon: -0.1278 },
  },
  // No geocoded location at all -- should be skipped, not crash.
  [p4]: {
    id: p4, name: 'No Location Nell', birthDate: '1978-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
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

  const mapState = () => page.evaluate(() => ({
    scale: parseFloat(document.getElementById('treeCanvas').style.transform.match(/scale\(([\d.]+)\)/)[1]),
    cardNames: [...document.querySelectorAll('.map-card')].map(c => c.querySelector('.person-name').textContent),
    clusterCounts: [...document.querySelectorAll('.map-cluster')].map(c => parseInt(c.textContent, 10)),
  }));

  console.log('=== Map View is a selectable view mode ===');
  const hasOption = await page.evaluate(() => !!document.querySelector('#viewModeSelect option[value="map"]'));
  if (!hasOption) throw new Error('Expected #viewModeSelect to have a "map" option');
  console.log('Confirmed: dropdown has a Map View option.');

  console.log('\n=== On entry: Ana is an individual card, Tom+Ravi collapse into a "2" cluster ===');
  await page.selectOption('#viewModeSelect', 'map');
  await page.waitForTimeout(900); // first load: vendored d3/topojson/world-atlas fetch
  const landDrawn = await page.evaluate(() => !!document.querySelector('#linesSvg path'));
  if (!landDrawn) throw new Error('Expected a filled land path in #linesSvg once the map libs finish loading');
  let s = await mapState();
  if (!s.cardNames.includes('Ana Cruz')) throw new Error(`Expected Ana Cruz to render as her own individual card, got cards: ${JSON.stringify(s.cardNames)}`);
  if (s.clusterCounts.length !== 1 || s.clusterCounts[0] !== 2) throw new Error(`Expected exactly one "2" cluster (Tom+Ravi, exact same coordinates), got: ${JSON.stringify(s.clusterCounts)}`);
  const totalRepresented = s.cardNames.length + s.clusterCounts.reduce((a, b) => a + b, 0);
  if (totalRepresented !== 3) throw new Error(`Expected 3 people represented total (Nell has no location and is skipped), got ${totalRepresented}`);
  console.log(`Confirmed: ${JSON.stringify(s.cardNames)} + cluster(s) ${JSON.stringify(s.clusterCounts)} = 3 people, Nell skipped.`);

  console.log('\n=== Markers stay the same on-screen size across very different zoom levels ===');
  const sizeAt = async () => page.evaluate(() => {
    const el = document.querySelector('.map-card') || document.querySelector('.map-cluster');
    return el.getBoundingClientRect().width;
  });
  const sizeAtEntry = await sizeAt();
  const vpCenter = await page.locator('#treeViewport').boundingBox();
  await page.mouse.move(vpCenter.x + vpCenter.width / 2, vpCenter.y + vpCenter.height / 2);
  await page.mouse.wheel(0, -4000); // zoom in a lot via the real wheel handler
  await page.waitForTimeout(300);
  const scaleAfterWheel = (await mapState()).scale;
  if (scaleAfterWheel <= s.scale) throw new Error(`Expected wheel-zooming in to increase view.scale, went from ${s.scale} to ${scaleAfterWheel}`);
  const sizeAfterZoom = await sizeAt();
  if (Math.abs(sizeAfterZoom - sizeAtEntry) > 3) throw new Error(`Expected a marker's rendered size to stay constant across zoom levels (map zooms, people don't) -- was ${sizeAtEntry.toFixed(1)}px, now ${sizeAfterZoom.toFixed(1)}px at scale ${scaleAfterWheel}`);
  console.log(`Confirmed: marker size stayed ~${sizeAtEntry.toFixed(1)}px while view.scale went from ${s.scale.toFixed(2)} to ${scaleAfterWheel.toFixed(2)}.`);

  console.log('\n=== Map View zooms in well past the tree views\' shared 2x ceiling ===');
  // The whole world only spans MAP_W (1600) px of map-space, so the tree
  // views' shared MAX_ZOOM (2x) would barely zoom in at all in real terms
  // -- Map View gets its own, much higher MAP_MAX_ZOOM ceiling (see
  // setZoom in app.js).
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -4000);
    await page.waitForTimeout(80);
  }
  const scalePast2x = (await mapState()).scale;
  if (scalePast2x <= 2) throw new Error(`Expected Map View to zoom in past the tree views' 2x ceiling, got ${scalePast2x}`);
  console.log(`Confirmed: reached scale ${scalePast2x.toFixed(2)}, well past the 2x ceiling other views are capped at.`);

  console.log('\n=== Zooming all the way to MAP_MAX_ZOOM resolves every cluster into individuals ===');
  for (let i = 0; i < 15; i++) {
    await page.mouse.wheel(0, -4000);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(300);
  s = await mapState();
  if (s.clusterCounts.length !== 0) throw new Error(`Expected no clusters left at max zoom (an exact shared address should fan out instead), got: ${JSON.stringify(s.clusterCounts)}`);
  const namesAtMax = s.cardNames.slice().sort();
  if (JSON.stringify(namesAtMax) !== JSON.stringify(['Ana Cruz', 'Ravi Singh', 'Tom Doe'])) throw new Error(`Expected all 3 geocoded people as individual (fanned) cards at max zoom, got: ${JSON.stringify(namesAtMax)}`);
  const [tomLeft, raviLeft] = await page.evaluate(() => {
    const posOf = (name) => {
      const card = [...document.querySelectorAll('.map-card')].find(c => c.querySelector('.person-name').textContent === name);
      return parseFloat(card.style.left);
    };
    return [posOf('Tom Doe'), posOf('Ravi Singh')];
  });
  if (Math.abs(tomLeft - raviLeft) < 10) throw new Error(`Expected Tom and Ravi (exact same coordinates) to be fanned apart once resolved to individuals, got left positions ${tomLeft} and ${raviLeft}`);
  console.log('Confirmed: at max zoom, the unresolvable Tom/Ravi cluster fans out into two separate, spaced-apart cards.');

  console.log('\n=== Clicking a cluster (while zoomed back out) zooms in on it ===');
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(300);
  await page.selectOption('#viewModeSelect', 'map');
  await page.waitForTimeout(900);
  const scaleBeforeClusterClick = (await mapState()).scale;
  await page.click('.map-cluster');
  await page.waitForTimeout(600);
  const scaleAfterClusterClick = (await mapState()).scale;
  if (scaleAfterClusterClick <= scaleBeforeClusterClick) throw new Error(`Expected clicking a cluster to zoom in, went from ${scaleBeforeClusterClick} to ${scaleAfterClusterClick}`);
  console.log(`Confirmed: clicking the cluster zoomed from ${scaleBeforeClusterClick.toFixed(2)} to ${scaleAfterClusterClick.toFixed(2)}.`);

  console.log('\n=== Clicking an individual card still opens that person\'s profile ===');
  await page.click('.map-card[data-id]'); // any individual card present
  await page.waitForTimeout(400);
  const modalHidden = await page.evaluate(() => document.getElementById('personViewModal').hidden);
  if (modalHidden) throw new Error('Expected clicking an individual Map View card to open the Person View');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(200);
  console.log("Confirmed: clicking an individual card still opens that person's profile.");

  console.log('\n=== No Static/Dynamic toggle exists anymore ===');
  const toggleGone = await page.evaluate(() => !document.getElementById('migrationModeToggle') && !document.getElementById('migrationDynamicPlaceholder'));
  if (!toggleGone) throw new Error('Expected the old Static/Dynamic toggle and placeholder to be fully removed');
  console.log('Confirmed: no leftover toggle/placeholder DOM.');

  console.log('\n=== The map fits to a zoomed-out fraction of the viewport\'s height (MAP_ZOOM_OUT) on entry ===');
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(300);
  await page.selectOption('#viewModeSelect', 'map');
  await page.waitForTimeout(900);
  const fitInfo = await page.evaluate(() => {
    const m = document.getElementById('treeCanvas').style.transform.match(/scale\(([\d.]+)\)/);
    return {
      scale: m ? parseFloat(m[1]) : null,
      contentH: document.getElementById('treeContent').offsetHeight,
      viewportH: document.getElementById('treeViewport').clientHeight,
    };
  });
  const renderedH = fitInfo.contentH * fitInfo.scale;
  const MAP_ZOOM_OUT = 0.7;
  const expectedH = (fitInfo.viewportH - 48) * MAP_ZOOM_OUT;
  if (Math.abs(renderedH - expectedH) > 40) throw new Error(`Expected the map's rendered height (${renderedH.toFixed(0)}px) to be ~${expectedH.toFixed(0)}px (viewport height * MAP_ZOOM_OUT)`);
  console.log(`Confirmed: rendered height ${renderedH.toFixed(0)}px against an expected ~${expectedH.toFixed(0)}px.`);

  console.log('\n=== Dragging pans the map horizontally ===');
  const beforeDrag = await page.evaluate(() => document.getElementById('treeCanvas').style.transform);
  const vpBox = await page.locator('#treeViewport').boundingBox();
  await page.mouse.move(vpBox.x + vpBox.width / 2, vpBox.y + vpBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(vpBox.x + vpBox.width / 2 - 200, vpBox.y + vpBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const afterDrag = await page.evaluate(() => document.getElementById('treeCanvas').style.transform);
  if (afterDrag === beforeDrag) throw new Error('Expected dragging on Map View to pan the canvas, but the transform never changed');
  console.log('Confirmed: dragging pans the map.');

  console.log('\n=== The land fades in from 10% to 100% opacity when entering Map View ===');
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(400);
  await page.selectOption('#viewModeSelect', 'map');
  const earlyOpacity = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#linesSvg path')).opacity));
  if (earlyOpacity >= 0.9) throw new Error(`Expected the land to start near 10% opacity right after entering Map View, got ${earlyOpacity}`);
  await page.waitForTimeout(700);
  const settledOpacity = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#linesSvg path')).opacity));
  if (Math.abs(settledOpacity - 1) > 0.02) throw new Error(`Expected the land to settle at full opacity, got ${settledOpacity}`);
  console.log(`Confirmed: land opacity went from ${earlyOpacity.toFixed(2)} right after entry to ${settledOpacity.toFixed(2)} once settled.`);

  console.log('\nERRORS:', errors);
  if (errors.length) throw new Error('Unexpected page errors: ' + JSON.stringify(errors));
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
