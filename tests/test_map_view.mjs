import { chromium } from 'playwright-core';

// Map View plots each person's CURRENT location only (locations[0], or
// birthLocation as a fallback -- see currentLocationCoordsOf in app.js) on
// a Robinson-projection world map, using real .person-card elements (not a
// bespoke marker) so it inherits the app's existing photo/name/subtitle
// styling and the same captureCardPositions/animateLayoutIn FLIP
// transition every other view uses. There is no migration history, no
// focus concept, and no Static/Dynamic toggle -- clicking a card just
// opens that person's profile, same as Zodiac/Centric do.
const p1 = 'p1', p2 = 'p2', p3 = 'p3', p4 = 'p4';
const people = {
  [p1]: {
    id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
    birthLocation: { text: 'Manila, Philippines', lat: 14.5995, lon: 120.9842 },
    locations: [{ text: 'San Francisco, CA', lat: 37.7749, lon: -122.4194 }],
  },
  [p2]: {
    id: p2, name: 'Tom Doe', birthDate: '1990-06-15', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
    birthLocation: { text: 'London, UK', lat: 51.5074, lon: -0.1278 },
  },
  // No geocoded location at all -- should be skipped, not crash.
  [p3]: {
    id: p3, name: 'No Location Nell', birthDate: '1978-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
  },
  // Same exact coordinates as Tom's -- covers resolveMapCardOverlaps
  // spreading two people who currently live in the same place into a row
  // instead of stacking their cards exactly on top of each other.
  [p4]: {
    id: p4, name: 'Ravi Singh', birthDate: '1988-11-20', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
    birthLocation: { text: 'London, UK', lat: 51.5074, lon: -0.1278 },
  },
  // Boston and Chicago (~1700km apart -- genuinely different cities, not
  // a shared address) project only ~68px apart on this Robinson map once
  // the whole world is compressed into a 1600px-wide canvas -- well under
  // a card-width. Covers resolveMapCardOverlaps clustering on real
  // lat/lon, not projected screen distance, so these two are never
  // mistaken for sharing a location and fanned into the same row.
  p5: {
    id: 'p5', name: 'Bea Boston', birthDate: '1965-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
    birthLocation: { text: 'Boston, MA', lat: 42.3601, lon: -71.0589 },
  },
  p6: {
    id: 'p6', name: 'Cal Chicago', birthDate: '1968-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
    birthLocation: { text: 'Chicago, IL', lat: 41.8781, lon: -87.6298 },
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

  console.log('=== Map View is a selectable view mode ===');
  const hasOption = await page.evaluate(() => !!document.querySelector('#viewModeSelect option[value="map"]'));
  if (!hasOption) throw new Error('Expected #viewModeSelect to have a "map" option');
  console.log('Confirmed: dropdown has a Map View option.');

  console.log('\n=== Switching to it draws land and real person cards (not a bespoke marker) ===');
  await page.selectOption('#viewModeSelect', 'map');
  await page.waitForTimeout(900); // first load: vendored d3/topojson/world-atlas fetch
  const landDrawn = await page.evaluate(() => !!document.querySelector('#linesSvg path'));
  if (!landDrawn) throw new Error('Expected a filled land path in #linesSvg once the map libs finish loading');
  const cardCount = await page.evaluate(() => document.querySelectorAll('#treeContent .person-card').length);
  if (cardCount !== 5) throw new Error(`Expected 5 cards (Nell has no geocoded location and is skipped), got ${cardCount}`);
  const hasBespokeMarker = await page.evaluate(() => !!document.querySelector('.migration-marker'));
  if (hasBespokeMarker) throw new Error('Expected no leftover .migration-marker elements -- Map View should only use real .person-card elements');
  console.log('Confirmed: land drawn, 5 real .person-card elements placed, Nell (no location) skipped.');

  console.log('\n=== Boston and Chicago are genuinely different cities and never get fanned together ===');
  const [bostonPos, chicagoPos] = await page.evaluate(() => {
    const posOf = (id) => {
      const el = document.querySelector(`.person-card[data-id="${id}"]`);
      return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
    };
    return [posOf('p5'), posOf('p6')];
  });
  const cityDist = Math.hypot(bostonPos.x - chicagoPos.x, bostonPos.y - chicagoPos.y);
  // The real (correct) projected gap between these two cities is ~68px;
  // the bug this guards against pulled them into the same fan-out row at
  // a full CARD_WIDTH*MAP_CARD_SCALE+SPOUSE_GAP (91px) spacing instead.
  if (cityDist > 80) throw new Error(`Expected Boston and Chicago to sit at their real ~68px projected gap, not be fanned apart like a shared location -- got ${cityDist.toFixed(1)}px`);
  console.log(`Confirmed: Boston and Chicago sit ${cityDist.toFixed(1)}px apart (their real projected gap), not merged into one cluster.`);

  console.log('\n=== Each card shows the current-location text as its subtitle ===');
  const janeSubtitle = await page.evaluate((id) => document.querySelector(`.person-card[data-id="${id}"] .person-dates`).textContent, p1);
  if (!janeSubtitle.includes('San Francisco')) throw new Error(`Expected Jane's subtitle to show her current location (San Francisco), got: ${janeSubtitle}`);
  console.log(`Confirmed: Jane's card subtitle reads "${janeSubtitle}".`);

  console.log('\n=== Clicking a card opens that person\'s profile directly -- no focus concept ===');
  await page.click(`.person-card[data-id="${p1}"]`);
  await page.waitForTimeout(400);
  const modalHidden = await page.evaluate(() => document.getElementById('personViewModal').hidden);
  const modalName = await page.evaluate(() => document.getElementById('viewName')?.textContent || '');
  if (modalHidden) throw new Error('Expected clicking a Map View card to open the Person View');
  if (!modalName.includes('Jane')) throw new Error(`Expected the opened profile to be Jane's, got: ${modalName}`);
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(200);
  console.log("Confirmed: clicking a card opens that person's profile.");

  console.log('\n=== Tom and Ravi share the exact same coordinates, but their cards never overlap ===');
  // Read the world-space left/top the render function itself set (not
  // getBoundingClientRect, which reports post-pan/zoom screen pixels --
  // the map's own fit-to-view scale would otherwise shrink this distance
  // and make the assertion depend on viewport size).
  const [tomPos, raviPos] = await page.evaluate(([tId, rId]) => {
    const posOf = (id) => {
      const el = document.querySelector(`.person-card[data-id="${id}"]`);
      return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
    };
    return [posOf(tId), posOf(rId)];
  }, [p2, p4]);
  const centerDist = Math.hypot(tomPos.x - raviPos.x, tomPos.y - raviPos.y);
  // Fanned by CARD_WIDTH*MAP_CARD_SCALE+SPOUSE_GAP (91px) -- their own
  // scaled-down width plus a gap, not the full unscaled card width.
  if (centerDist < 80) throw new Error(`Expected Tom and Ravi's cards to be spread by their scaled card width, got ${centerDist}px`);
  // Both must still be independently clickable -- the actual bug this
  // guards against is a fully-overlapping card intercepting the one
  // beneath it.
  await page.click(`.person-card[data-id="${p4}"]`);
  await page.waitForTimeout(300);
  const raviModalName = await page.evaluate(() => document.getElementById('viewName')?.textContent || '');
  if (!raviModalName.includes('Ravi')) throw new Error(`Expected clicking Ravi's card to open his profile, got: ${raviModalName}`);
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(200);
  await page.click(`.person-card[data-id="${p2}"]`);
  await page.waitForTimeout(300);
  const tomModalName = await page.evaluate(() => document.getElementById('viewName')?.textContent || '');
  if (!tomModalName.includes('Tom')) throw new Error(`Expected clicking Tom's card to also independently open his profile, got: ${tomModalName}`);
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(200);
  console.log(`Confirmed: cards spread ${centerDist.toFixed(1)}px apart, both independently clickable.`);

  console.log('\n=== No Static/Dynamic toggle exists anymore ===');
  const toggleGone = await page.evaluate(() => !document.getElementById('migrationModeToggle') && !document.getElementById('migrationDynamicPlaceholder'));
  if (!toggleGone) throw new Error('Expected the old Static/Dynamic toggle and placeholder to be fully removed');
  console.log('Confirmed: no leftover toggle/placeholder DOM.');

  console.log('\n=== Switching away and back re-renders cleanly ===');
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(400);
  await page.selectOption('#viewModeSelect', 'map');
  await page.waitForTimeout(600);
  const cardCountAgain = await page.evaluate(() => document.querySelectorAll('#treeContent .person-card').length);
  if (cardCountAgain !== 5) throw new Error(`Expected 5 cards again after switching back to Map View, got ${cardCountAgain}`);
  console.log('Confirmed: switching away and back still works.');

  console.log('\n=== The map fits to a zoomed-out fraction of the viewport\'s height (MAP_ZOOM_OUT) ===');
  const fitInfo = await page.evaluate(() => {
    const m = document.getElementById('treeCanvas').style.transform.match(/scale\(([\d.]+)\)/);
    const scale = m ? parseFloat(m[1]) : null;
    return {
      scale,
      contentH: document.getElementById('treeContent').offsetHeight,
      viewportW: document.getElementById('treeViewport').clientWidth,
      viewportH: document.getElementById('treeViewport').clientHeight,
    };
  });
  const renderedH = fitInfo.contentH * fitInfo.scale;
  // MAP_ZOOM_OUT (0.7) dials the fill-height fit back down -- see
  // computeFitTransform's zoomOut option -- so the rendered height should
  // land at ~70% of the viewport height, not the full height.
  const MAP_ZOOM_OUT = 0.7;
  const expectedH = (fitInfo.viewportH - 48) * MAP_ZOOM_OUT;
  if (Math.abs(renderedH - expectedH) > 40) throw new Error(`Expected the map's rendered height (${renderedH.toFixed(0)}px) to be ~${expectedH.toFixed(0)}px (viewport height * MAP_ZOOM_OUT)`);
  console.log(`Confirmed: rendered height ${renderedH.toFixed(0)}px against an expected ~${expectedH.toFixed(0)}px (viewport ${fitInfo.viewportH}px * ${MAP_ZOOM_OUT}).`);

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

  console.log('\n=== Cards render at half their usual size (MAP_CARD_SCALE) ===');
  const cardScale = await page.evaluate((id) => {
    const style = getComputedStyle(document.querySelector(`.person-card[data-id="${id}"]`));
    const m = style.transform.match(/matrix\(([^,]+),/); // matrix(a,b,c,d,tx,ty) -- a is the x-scale
    return m ? parseFloat(m[1]) : null;
  }, p1);
  if (!cardScale || Math.abs(cardScale - 0.5) > 0.01) throw new Error(`Expected Map View cards to render at scale(0.5), got computed scale ${cardScale}`);
  console.log(`Confirmed: cards render at scale(${cardScale}).`);

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

  console.log('\n=== Leaving and re-entering Map View replays the fade (it\'s per-entry, not one-time) ===');
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(400);
  await page.selectOption('#viewModeSelect', 'map');
  const secondEntryOpacity = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#linesSvg path')).opacity));
  if (secondEntryOpacity >= 0.9) throw new Error(`Expected a fresh entry into Map View to fade in again, got opacity ${secondEntryOpacity}`);
  console.log(`Confirmed: re-entering Map View starts the fade again (opacity ${secondEntryOpacity.toFixed(2)}).`);

  console.log('\nERRORS:', errors);
  if (errors.length) throw new Error('Unexpected page errors: ' + JSON.stringify(errors));
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
