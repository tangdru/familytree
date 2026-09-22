import { chromium } from 'playwright-core';

// Globe View plots each person's CURRENT location only (locations[0], or
// birthLocation as a fallback -- see currentLocationCoordsOf in app.js) on a
// spinning orthographic globe (renderGlobeFrame). Markers/clusters always
// render at the same flat CSS scale (GLOBE_MARKER_TARGET_SCALE) regardless
// of the globe's own zoom, and people too close together to tell apart at
// the current zoom collapse into a single numbered cluster badge
// (clusterGlobePoints) instead of overlapping cards. Clicking a cluster
// rotates+zooms in on it; a cluster that's STILL not resolvable once fully
// zoomed in (an exact shared address, which no amount of zoom can ever
// separate) falls back to a fanned row instead of staying an unbreakable
// cluster forever. A person on the far side of the globe from the current
// rotation isn't rendered at all. Releasing a drag carries the rotation on
// under inertia (startGlobeInertia), decaying under simulated friction
// until it settles, rather than stopping dead the instant the pointer
// lifts; grabbing the globe again cancels the spin immediately.
const p1 = 'p1', p2 = 'p2', p3 = 'p3', p4 = 'p4';
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
  if (s.clusterCounts.length !== 1 || s.clusterCounts[0] !== 2) throw new Error(`Expected exactly one "2" cluster (Tom+Ravi, exact same coordinates, front-facing), got: ${JSON.stringify(s.clusterCounts)}`);
  const totalRepresented = s.cardNames.length + s.clusterCounts.reduce((a, b) => a + b, 0);
  if (totalRepresented !== 2) throw new Error(`Expected 2 people represented on entry (Ana culled, Nell has no location), got ${totalRepresented}`);
  console.log(`Confirmed: ${JSON.stringify(s.cardNames)} + cluster(s) ${JSON.stringify(s.clusterCounts)} = 2 people visible; Ana culled, Nell skipped.`);

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
  if (JSON.stringify(namesAtMax) !== JSON.stringify(['Ravi Singh', 'Tom Doe'])) throw new Error(`Expected Tom and Ravi as individual (fanned) cards at max zoom (Ana still culled, on the far side), got: ${JSON.stringify(namesAtMax)}`);
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

  console.log('\n=== Releasing a fast drag keeps the globe spinning under inertia, then settles ===');
  await page.click('#fitViewBtn');
  await page.waitForTimeout(600);
  const posOfCluster = () => page.evaluate(() => {
    const el = document.querySelector('.map-cluster');
    return el ? { left: parseFloat(el.style.left), top: parseFloat(el.style.top) } : null;
  });
  const beforeFlick = await posOfCluster();
  // A fast flick (a big move in few steps, i.e. a short elapsed time) --
  // trackGlobeDragVelocity measures speed between the last two move events,
  // so what matters is how fast the FINAL movement was, not the gesture's
  // overall average.
  await page.mouse.move(vpBox.x + vpBox.width / 2, vpBox.y + vpBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(vpBox.x + vpBox.width / 2 - 300, vpBox.y + vpBox.height / 2, { steps: 3 });
  await page.mouse.up();
  const rightAfterRelease = await posOfCluster();
  await page.waitForTimeout(150);
  const shortlyAfter = await posOfCluster();
  if (!rightAfterRelease || !shortlyAfter) throw new Error('Expected the cluster to still be present through the flick');
  const driftedAfterRelease = Math.hypot(shortlyAfter.left - rightAfterRelease.left, shortlyAfter.top - rightAfterRelease.top);
  if (driftedAfterRelease < 5) throw new Error(`Expected the globe to keep spinning under inertia right after releasing a fast flick, but it barely moved (${driftedAfterRelease.toFixed(1)}px) in the 150ms after release`);
  console.log(`Confirmed: the globe kept spinning ${driftedAfterRelease.toFixed(1)}px in the 150ms right after releasing a fast flick.`);
  // Poll for the drift-per-interval to drop below a small threshold,
  // rather than waiting a single fixed duration -- the exact instant
  // inertia decays below GLOBE_INERTIA_MIN_SPEED depends on exactly how
  // fast Playwright's synthetic flick came in, and (now that auto-spin
  // exists) settling is a moving target: the globe legitimately starts
  // moving again on its own GLOBE_AUTOSPIN_IDLE_DELAY_MS after it settles,
  // so a fixed wait risks sampling right as that resume kicks in.
  let settled = shortlyAfter;
  let foundSettle = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(150);
    const cur = await posOfCluster();
    if (!cur) throw new Error('Expected the cluster to still be present while the spin decays');
    const stepMoved = Math.hypot(cur.left - settled.left, cur.top - settled.top);
    settled = cur;
    if (stepMoved < 3) { foundSettle = true; break; }
  }
  if (!foundSettle) throw new Error('Expected the inertia spin to decay to a stop within ~4.5s, but it never settled');
  // Confirm that was a real settle, not one still sample mid-decay, by
  // re-checking well within the idle window before auto-spin could
  // plausibly have resumed yet.
  await page.waitForTimeout(300);
  const stillSettled = await posOfCluster();
  const driftAfterSettle = Math.hypot(stillSettled.left - settled.left, stillSettled.top - settled.top);
  if (driftAfterSettle > 3) throw new Error(`Expected the inertia spin to stay stopped immediately after settling, but it drifted ${driftAfterSettle.toFixed(1)}px in the next 300ms`);
  console.log('Confirmed: the free-spin decays under friction and comes to a stop rather than spinning forever.');
  const totalDrift = Math.hypot(settled.left - beforeFlick.left, settled.top - beforeFlick.top);
  if (totalDrift < 40) throw new Error(`Expected the flick's total rotation (drag + inertia) to clearly exceed a plain drag's own movement, got only ${totalDrift.toFixed(1)}px total`);

  console.log('\n=== After a short idle period, the globe resumes auto-spinning on its own ===');
  // GLOBE_AUTOSPIN_IDLE_DELAY_MS (1200ms) after settling, plus up to
  // FIT_VIEW_MS (380ms) if it also had to level back to its home tilt --
  // it didn't here (the flick above was purely horizontal), but the
  // margin costs nothing.
  await page.waitForTimeout(1200 + 380 + 500);
  const afterIdle = await posOfCluster();
  if (!afterIdle) throw new Error('Expected the cluster to still be present once auto-spin resumes');
  const autoSpinDrift = Math.hypot(afterIdle.left - stillSettled.left, afterIdle.top - stillSettled.top);
  if (autoSpinDrift < 5) throw new Error(`Expected the globe to resume auto-spinning on its own after the idle delay, but it's still sitting still (${autoSpinDrift.toFixed(1)}px drift)`);
  console.log(`Confirmed: the globe resumed auto-spinning on its own (~${autoSpinDrift.toFixed(1)}px drift after the idle delay).`);

  console.log('\n=== A tilted drag eases back to the home tilt once idle ===');
  await page.click('#fitViewBtn');
  await page.waitForTimeout(600);
  const beforeTilt = await posOfCluster();
  // Purely vertical (dx = 0) so this isolates the tilt cleanly: for an
  // off-center point like this cluster, its projected Y depends on BOTH
  // longitude and latitude jointly, not latitude alone, so a drag that also
  // moved longitude wouldn't let a simple before/after Y comparison prove
  // the tilt specifically recovered. Longitude staying untouched by
  // leveling is instead a property of the code, not something this pixel
  // check needs to prove: startGlobeLeveling only ever writes
  // globeRotation[1] (see its definition), so it structurally cannot
  // touch [0] regardless of what a drag or auto-spin did to it.
  // Paused, then finished with one tiny final move, so the released
  // velocity is near zero and no inertia carries it further -- isolates
  // the leveling ease from the free-spin tested above.
  await page.mouse.move(vpBox.x + vpBox.width / 2, vpBox.y + vpBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(vpBox.x + vpBox.width / 2, vpBox.y + vpBox.height / 2 - 148, { steps: 20 });
  await page.waitForTimeout(200);
  await page.mouse.move(vpBox.x + vpBox.width / 2, vpBox.y + vpBox.height / 2 - 150, { steps: 1 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterTiltDrag = await posOfCluster();
  if (!afterTiltDrag) throw new Error('Expected the cluster to still be present after the tilt drag');
  const tiltedVertically = Math.abs(afterTiltDrag.top - beforeTilt.top);
  if (tiltedVertically < 20) throw new Error(`Expected the vertical drag component to visibly tilt the globe, top only moved ${tiltedVertically.toFixed(0)}px (from ${beforeTilt.top.toFixed(0)} to ${afterTiltDrag.top.toFixed(0)})`);
  // Wait through the idle delay and the leveling ease, but check before
  // auto-spin (longitude-only, so it shouldn't move the vertical position
  // much on its own) has had long to run.
  await page.waitForTimeout(1200 + 380 + 100);
  const afterLeveling = await posOfCluster();
  if (!afterLeveling) throw new Error('Expected the cluster to still be present after leveling');
  const remainingTilt = Math.abs(afterLeveling.top - beforeTilt.top);
  if (remainingTilt > 20) throw new Error(`Expected the globe to ease its tilt back to the home axis once idle (vertical position back near ${beforeTilt.top.toFixed(0)}px), but it's still ${afterLeveling.top.toFixed(0)}px, ${remainingTilt.toFixed(0)}px of tilt remaining`);
  console.log('Confirmed: the globe eased its tilt back to the home axis once idle, without needing to touch longitude.');

  console.log('\n=== Grabbing the globe again stops an in-progress free-spin immediately ===');
  await page.click('#fitViewBtn');
  await page.waitForTimeout(600);
  await page.mouse.move(vpBox.x + vpBox.width / 2, vpBox.y + vpBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(vpBox.x + vpBox.width / 2 - 300, vpBox.y + vpBox.height / 2, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(50); // let inertia actually pick up before grabbing it again
  await page.mouse.move(vpBox.x + vpBox.width / 2, vpBox.y + vpBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(50);
  const grabbed = await posOfCluster();
  await page.waitForTimeout(200);
  const stillGrabbed = await posOfCluster();
  await page.mouse.up();
  if (!grabbed || !stillGrabbed) throw new Error('Expected the cluster to still be present after re-grabbing mid-spin');
  const driftedWhileHeld = Math.hypot(stillGrabbed.left - grabbed.left, stillGrabbed.top - grabbed.top);
  if (driftedWhileHeld > 3) throw new Error(`Expected grabbing the globe to immediately cancel its free-spin, but it kept drifting ${driftedWhileHeld.toFixed(1)}px while held (not dragged)`);
  console.log('Confirmed: grabbing the globe mid-spin stops the free-spin immediately.');

  console.log('\n=== Clicking a cluster rotates+zooms in on it, eventually resolving it into individuals ===');
  await page.click('#fitViewBtn');
  await page.waitForTimeout(600);
  for (let i = 0; i < 5; i++) {
    const cluster = await page.$('.map-cluster');
    if (!cluster) break;
    await cluster.click();
    await page.waitForTimeout(500);
  }
  s = await globeState();
  if (s.clusterCounts.length !== 0) throw new Error(`Expected repeated cluster clicks to eventually zoom in enough to resolve Tom+Ravi into individuals, still clustered: ${JSON.stringify(s.clusterCounts)}`);
  console.log('Confirmed: clicking a cluster repeatedly zooms in until it resolves into individual cards.');

  console.log('\n=== Clicking an individual card still opens that person\'s profile ===');
  await page.click('.map-card[data-id]'); // any individual card present
  await page.waitForTimeout(400);
  const modalHidden = await page.evaluate(() => document.getElementById('personViewModal').hidden);
  if (modalHidden) throw new Error('Expected clicking an individual Globe View card to open the Person View');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(200);
  console.log("Confirmed: clicking an individual card still opens that person's profile.");

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
