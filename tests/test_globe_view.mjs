import { chromium } from 'playwright-core';

// Globe View plots each person's CURRENT location only (locations[0], or
// birthLocation as a fallback -- see currentLocationCoordsOf in app.js) on a
// spinning orthographic globe (renderGlobeFrame). Markers/clusters always
// render at the same flat CSS scale (GLOBE_MARKER_TARGET_SCALE) regardless
// of the globe's own zoom, and people too close together to tell apart at
// the current zoom collapse into a single numbered cluster badge
// (clusterGlobePoints) instead of overlapping cards. Clicking a cluster
// rotates (longitude only -- rotation is locked to the north-south axis,
// see rotateGlobeBy) and zooms in on it; a cluster that's STILL not
// resolvable once fully zoomed in (an exact shared address, which no amount
// of zoom can ever separate) falls back to a fanned row instead of staying
// an unbreakable cluster forever. A person on the far side of the globe
// from the current rotation isn't rendered at all.
const p1 = 'p1', p2 = 'p2', p3 = 'p3', p4 = 'p4', p5 = 'p5';
const people = {
  // Sydney sits on the far side of the globe from the default rotation
  // (GLOBE_DEFAULT_ROTATION centers the Americas/Atlantic) -- should be
  // culled entirely on entry, not projected onto the visible hemisphere.
  [p1]: {
    id: p1, name: 'Ana Cruz', birthDate: '1978-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
    birthLocation: { text: 'Sydney, Australia', lat: -33.8688, lon: 151.2093 },
  },
  // Exact same coordinates as p3, and on the front-facing hemisphere by
  // default -- can never be separated by zooming alone, so this pair should
  // always end up as a "2" cluster until fully zoomed in, then fall back to
  // a fanned row.
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
  // Los Angeles sits close to the default rotation's front-facing center
  // (unlike London, ~60 degrees off it) and far enough from Tom/Ravi on
  // screen to always render as her own individual card -- used to test
  // clicking an individual card without depending on how far a deep zoom
  // test elsewhere has pushed things around (see the north-south-axis
  // rotation lock in rotateGlobeBy: a point far from the fixed tilt
  // latitude, like London, can drift off-screen once zoomed in a lot,
  // since re-centering can only ever adjust longitude).
  [p5]: {
    id: p5, name: 'Chris Lee', birthDate: '1995-04-10', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
    birthLocation: { text: 'Los Angeles, USA', lat: 34.0522, lon: -118.2437 },
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

  const globeState = () => page.evaluate(() => ({
    cardNames: [...document.querySelectorAll('.map-card')].map(c => c.querySelector('.person-name').textContent),
    clusterCounts: [...document.querySelectorAll('.map-cluster')].map(c => parseInt(c.textContent, 10)),
  }));

  console.log('=== Globe View is a selectable view mode ===');
  const hasOption = await page.evaluate(() => !!document.querySelector('#viewModeSelect option[value="globe"]'));
  if (!hasOption) throw new Error('Expected #viewModeSelect to have a "globe" option');
  console.log('Confirmed: dropdown has a Globe View option.');

  console.log('\n=== On entry: land+sphere are drawn, Sydney is culled (far side), Tom+Ravi collapse into a "2" cluster ===');
  await page.selectOption('#viewModeSelect', 'globe');
  await page.waitForTimeout(900); // first load: vendored d3/topojson/world-atlas fetch
  const paintedPaths = await page.evaluate(() => document.querySelectorAll('#linesSvg path').length);
  if (paintedPaths !== 2) throw new Error(`Expected exactly 2 paths in #linesSvg (sphere + land), got ${paintedPaths}`);
  let s = await globeState();
  if (s.cardNames.includes('Ana Cruz')) throw new Error(`Expected Ana Cruz (Sydney) to be culled as being on the far side of the globe at the default rotation, but she rendered: ${JSON.stringify(s.cardNames)}`);
  if (!s.cardNames.includes('Chris Lee')) throw new Error(`Expected Chris Lee (Los Angeles, front-facing and far from the London cluster) to render individually, got cards: ${JSON.stringify(s.cardNames)}`);
  if (s.clusterCounts.length !== 1 || s.clusterCounts[0] !== 2) throw new Error(`Expected exactly one "2" cluster (Tom+Ravi, exact same coordinates, front-facing), got: ${JSON.stringify(s.clusterCounts)}`);
  const totalRepresented = s.cardNames.length + s.clusterCounts.reduce((a, b) => a + b, 0);
  if (totalRepresented !== 3) throw new Error(`Expected 3 people represented on entry (Ana culled, Nell has no location), got ${totalRepresented}`);
  console.log(`Confirmed: ${JSON.stringify(s.cardNames)} + cluster(s) ${JSON.stringify(s.clusterCounts)} = 3 people visible; Ana culled, Nell skipped.`);

  console.log('\n=== Clicking an individual card still opens that person\'s profile ===');
  await page.click('[data-id="p5"].map-card');
  await page.waitForTimeout(400);
  const modalHidden = await page.evaluate(() => document.getElementById('personViewModal').hidden);
  if (modalHidden) throw new Error('Expected clicking an individual Globe View card to open the Person View');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(200);
  console.log("Confirmed: clicking an individual card still opens that person's profile.");

  console.log('\n=== Markers stay the same on-screen size across very different zoom levels ===');
  const sizeAt = async () => page.evaluate(() => {
    const el = document.querySelector('.map-card') || document.querySelector('.map-cluster');
    return el.getBoundingClientRect().width;
  });
  const sizeAtEntry = await sizeAt();
  const vpBox = await page.locator('#treeViewport').boundingBox();
  await page.mouse.move(vpBox.x + vpBox.width / 2, vpBox.y + vpBox.height / 2);
  await page.mouse.wheel(0, -4000); // zoom in a lot via the real wheel handler
  await page.waitForTimeout(300);
  const sizeAfterZoom = await sizeAt();
  if (Math.abs(sizeAfterZoom - sizeAtEntry) > 3) throw new Error(`Expected a marker's rendered size to stay constant across zoom levels (globe zooms, people don't) -- was ${sizeAtEntry.toFixed(1)}px, now ${sizeAfterZoom.toFixed(1)}px`);
  console.log(`Confirmed: marker size stayed ~${sizeAtEntry.toFixed(1)}px across a large wheel-zoom.`);

  console.log('\n=== Zooming all the way in resolves the Tom/Ravi cluster into fanned individuals ===');
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, -4000);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(300);
  s = await globeState();
  if (s.clusterCounts.length !== 0) throw new Error(`Expected no clusters left at max zoom (an exact shared address should fan out instead), got: ${JSON.stringify(s.clusterCounts)}`);
  const namesAtMax = s.cardNames.slice().sort();
  if (JSON.stringify(namesAtMax) !== JSON.stringify(['Chris Lee', 'Ravi Singh', 'Tom Doe'])) throw new Error(`Expected Tom and Ravi as individual (fanned) cards at max zoom, alongside Chris Lee (Ana still culled, on the far side), got: ${JSON.stringify(namesAtMax)}`);
  const [tomLeft, raviLeft] = await page.evaluate(() => {
    const posOf = (name) => {
      const card = [...document.querySelectorAll('.map-card')].find(c => c.querySelector('.person-name').textContent === name);
      return parseFloat(card.style.left);
    };
    return [posOf('Tom Doe'), posOf('Ravi Singh')];
  });
  if (Math.abs(tomLeft - raviLeft) < 10) throw new Error(`Expected Tom and Ravi (exact same coordinates) to be fanned apart once resolved to individuals, got left positions ${tomLeft} and ${raviLeft}`);
  console.log('Confirmed: at max zoom, the unresolvable Tom/Ravi cluster fans out into two separate, spaced-apart cards.');

  console.log('\n=== The fit-view button resets zoom back to the default (markers return to entry size) ===');
  await page.click('#fitViewBtn');
  await page.waitForTimeout(600);
  const sizeAfterFit = await sizeAt();
  if (Math.abs(sizeAfterFit - sizeAtEntry) > 3) throw new Error(`Expected fit-view to reset marker size back to ~${sizeAtEntry.toFixed(1)}px, got ${sizeAfterFit.toFixed(1)}px`);
  s = await globeState();
  if (s.clusterCounts.length !== 1 || s.clusterCounts[0] !== 2) throw new Error(`Expected Tom+Ravi to re-collapse into a "2" cluster after fit-view resets zoom, got: ${JSON.stringify(s.clusterCounts)}`);
  console.log('Confirmed: fit-view resets zoom (marker size back to entry, Tom+Ravi re-clustered).');

  console.log('\n=== Dragging rotates the globe (a visible marker\'s screen position changes) ===');
  const clusterBefore = await page.evaluate(() => {
    const el = document.querySelector('.map-cluster');
    return { left: parseFloat(el.style.left), top: parseFloat(el.style.top) };
  });
  await page.mouse.move(vpBox.x + vpBox.width / 2, vpBox.y + vpBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(vpBox.x + vpBox.width / 2 - 250, vpBox.y + vpBox.height / 2 + 40, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const clusterAfter = await page.evaluate(() => {
    const el = document.querySelector('.map-cluster');
    return el ? { left: parseFloat(el.style.left), top: parseFloat(el.style.top) } : null;
  });
  if (!clusterAfter) throw new Error('Expected the Tom+Ravi cluster to still be present (just moved) after a modest drag');
  const moved = Math.hypot(clusterAfter.left - clusterBefore.left, clusterAfter.top - clusterBefore.top);
  if (moved < 20) throw new Error(`Expected dragging to noticeably rotate the globe and move the cluster's screen position, moved only ${moved.toFixed(1)}px`);
  console.log(`Confirmed: dragging rotated the globe, moving the cluster ${moved.toFixed(1)}px on screen.`);

  console.log('\n=== Clicking a cluster rotates (longitude only) and zooms in on it ===');
  await page.click('#fitViewBtn');
  await page.waitForTimeout(600);
  const sphereWidthBefore = await page.evaluate(() => document.querySelectorAll('#linesSvg path')[0].getBoundingClientRect().width);
  const clusterRectBefore = await page.evaluate(() => document.querySelector('.map-cluster').getBoundingClientRect());
  // A real click (as opposed to Playwright's own ElementHandle.click()) needs
  // to be by raw coordinates rather than by element handle: every rendered
  // frame fully removes and rebuilds every .map-card/.map-cluster node (see
  // renderGlobeFrame), which defeats Playwright's own actionability wait (it
  // expects to click the SAME node it found stable, but a cluster click
  // kicks off animateGlobeTo, whose frames keep swapping the node out) even
  // though an ordinary mouse click at the same screen point works fine for a
  // real user.
  await page.mouse.click(clusterRectBefore.x + clusterRectBefore.width / 2, clusterRectBefore.y + clusterRectBefore.height / 2);
  await page.waitForTimeout(600);
  const sphereWidthAfter = await page.evaluate(() => document.querySelectorAll('#linesSvg path')[0].getBoundingClientRect().width);
  const zoomRatio = sphereWidthAfter / sphereWidthBefore;
  if (Math.abs(zoomRatio - 3) > 0.3) throw new Error(`Expected clicking a cluster to zoom in by GLOBE_CLUSTER_ZOOM_FACTOR (3x), got a ${zoomRatio.toFixed(2)}x change in the sphere's rendered size`);
  console.log(`Confirmed: clicking a cluster zoomed in ~${zoomRatio.toFixed(2)}x.`);
  // Tom+Ravi (London, 51.5N) sit well off the fixed front-facing latitude
  // (GLOBE_DEFAULT_ROTATION's -38 -- rotation only ever spins longitude, see
  // rotateGlobeBy/the click handler above), so re-centering on them can only
  // ever adjust their horizontal position, never bring them to true center
  // vertically -- confirming that is a more accurate check than expecting
  // them to land at the exact viewport center.
  const clusterRectAfter = await page.evaluate(() => {
    const el = document.querySelector('.map-cluster');
    return el ? el.getBoundingClientRect() : null;
  });
  if (!clusterRectAfter) throw new Error('Expected the Tom+Ravi cluster to still be present (still unresolvable at only 3x zoom) after the click');
  const vw = await page.evaluate(() => document.getElementById('treeViewport').clientWidth);
  const centerX = clusterRectAfter.x + clusterRectAfter.width / 2;
  if (Math.abs(centerX - vw / 2) > 5) throw new Error(`Expected the click to re-center the cluster horizontally (~${(vw / 2).toFixed(0)}px), got ${centerX.toFixed(0)}px`);
  console.log('Confirmed: the click re-centered the cluster horizontally (rotation stayed locked to the north-south axis).');

  console.log('\n=== The globe fades in from 10% to 100% opacity when entering Globe View ===');
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(400);
  await page.selectOption('#viewModeSelect', 'globe');
  const earlyOpacity = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelectorAll('#linesSvg path')[1]).opacity));
  if (earlyOpacity >= 0.9) throw new Error(`Expected the globe to start near 10% opacity right after entering Globe View, got ${earlyOpacity}`);
  await page.waitForTimeout(700);
  const settledOpacity = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelectorAll('#linesSvg path')[1]).opacity));
  if (Math.abs(settledOpacity - 1) > 0.02) throw new Error(`Expected the globe to settle at full opacity, got ${settledOpacity}`);
  console.log(`Confirmed: land opacity went from ${earlyOpacity.toFixed(2)} right after entry to ${settledOpacity.toFixed(2)} once settled.`);

  console.log('\nERRORS:', errors);
  if (errors.length) throw new Error('Unexpected page errors: ' + JSON.stringify(errors));
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
