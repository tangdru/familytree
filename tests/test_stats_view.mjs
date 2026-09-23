import { chromium } from 'playwright-core';

// Stats View: a population-level dashboard (see renderStatsView in app.js)
// built entirely from fields the tree already stores. This dataset is
// hand-picked so every derived number is easy to verify by hand:
//   - gp1(1930-1990) x gp2(1932-2002) -> p1(1960), p2(1962)   [family size 2]
//   - p1(1960) x p3(1962, no recorded parents) -> c1(1990), c2(1992), c3(1994)
//                                                             [family size 3]
// No one has an explicit `zodiac` -- the app's own on-load migration backfills
// it from birth year (inferZodiacFromBirthYear), which by construction always
// agrees with the documented year, so birth years are never zodiac-adjusted.
const people = {
  gp1: {
    id: 'gp1', name: 'Grandpa Joe', birthDate: '1930-01-01', deathDate: '1990-06-01', photo: '', notes: '',
    parents: [], spouses: ['gp2'],
    birthLocation: { text: 'Hanoi, Vietnam', lat: 21.0278, lon: 105.8342 },
    locations: [{ text: 'Seattle, Washington', lat: 47.6062, lon: -122.3321 }],
  },
  gp2: {
    id: 'gp2', name: 'Grandma Jane', birthDate: '1932-01-01', deathDate: '2002-06-01', photo: 'data:x', notes: '',
    parents: [], spouses: ['gp1'],
    birthLocation: { text: 'Hanoi, Vietnam', lat: 21.0278, lon: 105.8342 },
  },
  p1: { id: 'p1', name: 'Parent One', birthDate: '1960-01-01', deathDate: '', photo: '', notes: '', parents: ['gp1', 'gp2'], spouses: ['p3'] },
  p2: { id: 'p2', name: 'Parent Two', birthDate: '1962-01-01', deathDate: '', photo: '', notes: '', parents: ['gp1', 'gp2'], spouses: [] },
  p3: { id: 'p3', name: 'Parent Three', birthDate: '1962-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: ['p1'] },
  c1: {
    id: 'c1', name: 'Child One', birthDate: '1990-01-01', deathDate: '', photo: '', notes: '', parents: ['p1', 'p3'], spouses: [],
    stories: [{ id: 's1', text: 'A memory.', mentions: [], audioUrl: null, createdAt: '2020-01-01', updatedAt: '2020-01-01' }],
  },
  c2: { id: 'c2', name: 'Child Two', birthDate: '1992-01-01', deathDate: '', photo: '', notes: '', parents: ['p1', 'p3'], spouses: [] },
  c3: { id: 'c3', name: 'Child Three', birthDate: '1994-01-01', deathDate: '', photo: '', notes: '', parents: ['p1', 'p3'], spouses: [] },
};

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const expectedMigrationKm = haversineKm(21.0278, 105.8342, 47.6062, -122.3321);

async function loadPeopleIntoStats(page, data) {
  await page.evaluate((d) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: d }));
  }, data);
  await page.reload({ waitUntil: 'networkidle' });
  await page.selectOption('#viewModeSelect', 'stats');
  await page.waitForTimeout(400);
}

async function readCards(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll('.stat-card')].map(card => ({
      title: card.querySelector('.stat-card-title').textContent,
      note: card.querySelector('.stat-card-note')?.textContent || null,
      emptyMsg: card.querySelector('.stat-card-empty')?.textContent || null,
      axisLabels: [...card.querySelectorAll('.stat-chart-axis-label')].map(e => e.textContent),
      valueLabels: [...card.querySelectorAll('.stat-chart-value-label')].map(e => e.textContent),
      dotCount: card.querySelectorAll('.stat-chart-dot').length,
      areaCount: card.querySelectorAll('.stat-chart-area').length,
      legendItems: [...card.querySelectorAll('.stat-donut-legend-item')].map(e => e.textContent.trim()),
      gaugeRows: [...card.querySelectorAll('.stat-gauge-row')].map(r => ({
        label: r.querySelector('.stat-gauge-label').textContent,
        pct: r.querySelector('.stat-gauge-pct').textContent,
      })),
    }));
  });
}

function byTitle(cards, title) {
  const card = cards.find(c => c.title === title);
  if (!card) throw new Error(`Expected a "${title}" card, got titles: ${cards.map(c => c.title).join(', ')}`);
  return card;
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });

  console.log('=== Stats View renders all 8 population-level insight cards ===');
  await loadPeopleIntoStats(page, people);
  const cards = await readCards(page);
  const expectedTitles = [
    'Family size', 'Longevity over time', 'Chinese zodiac breakdown', 'Family size by generation',
    'Migration distance (km)', 'Population over time', 'Generation gap', 'Data completeness',
  ];
  const actualTitles = cards.map(c => c.title);
  if (JSON.stringify(actualTitles) !== JSON.stringify(expectedTitles)) {
    throw new Error(`Expected card titles ${JSON.stringify(expectedTitles)}, got ${JSON.stringify(actualTitles)}`);
  }
  console.log('Confirmed: all 8 cards render, in the expected order.');

  console.log('\n=== Family size distribution (bar chart) matches the two real families ===');
  const familySize = byTitle(cards, 'Family size');
  const expectedBuckets = ['1', '2', '3', '4', '5+'];
  if (JSON.stringify(familySize.axisLabels) !== JSON.stringify(expectedBuckets)) {
    throw new Error(`Expected bucket labels ${JSON.stringify(expectedBuckets)}, got ${JSON.stringify(familySize.axisLabels)}`);
  }
  // Only the "2 children" (gp1+gp2) and "3 children" (p1+p3) families exist,
  // so exactly two buckets get a nonzero bar -> two value labels, both "1".
  if (JSON.stringify(familySize.valueLabels) !== JSON.stringify(['1', '1'])) {
    throw new Error(`Expected exactly two families of size 1 each in their bucket, got value labels ${JSON.stringify(familySize.valueLabels)}`);
  }
  console.log('Confirmed: one family of 2 children, one family of 3 children.');

  console.log('\n=== Longevity scatter plot has one dot per person with a recorded death ===');
  const longevity = byTitle(cards, 'Longevity over time');
  if (longevity.dotCount !== 2) throw new Error(`Expected 2 longevity dots (gp1, gp2), got ${longevity.dotCount}`);
  if (!longevity.axisLabels.includes('1930') || !longevity.axisLabels.includes('1932')) {
    throw new Error(`Expected birth-year axis labels to include 1930 and 1932, got ${JSON.stringify(longevity.axisLabels)}`);
  }
  console.log('Confirmed: 2 points plotted, spanning birth years 1930-1932.');

  console.log('\n=== Chinese zodiac breakdown reflects birth-year-inferred signs, in cycle order ===');
  const zodiac = byTitle(cards, 'Chinese zodiac breakdown');
  // Rat(p1,1960), Tiger(p2+p3,1962), Horse(gp1+c1,1930/1990), Monkey(gp2+c2,1932/1992), Dog(c3,1994).
  const expectedZodiacOrder = ['Rat (1)', 'Tiger (2)', 'Horse (2)', 'Monkey (2)', 'Dog (1)'];
  for (const expected of expectedZodiacOrder) {
    if (!zodiac.legendItems.some(item => item.includes(expected))) {
      throw new Error(`Expected zodiac legend to include "${expected}", got ${JSON.stringify(zodiac.legendItems)}`);
    }
  }
  const orderIndexes = expectedZodiacOrder.map(exp => zodiac.legendItems.findIndex(item => item.includes(exp)));
  const isSorted = orderIndexes.every((v, i) => i === 0 || v > orderIndexes[i - 1]);
  if (!isSorted) throw new Error(`Expected zodiac legend in 12-year-cycle order, got ${JSON.stringify(zodiac.legendItems)}`);
  console.log('Confirmed: 5 signs present, ordered by the real zodiac cycle, not by count.');

  console.log('\n=== Family size by generation shows the two real generations growing ===');
  const familyTrend = byTitle(cards, 'Family size by generation');
  if (JSON.stringify(familyTrend.axisLabels) !== JSON.stringify(['Gen 1', 'Gen 2'])) {
    throw new Error(`Expected generation labels ["Gen 1","Gen 2"], got ${JSON.stringify(familyTrend.axisLabels)}`);
  }
  if (familyTrend.dotCount !== 2) throw new Error(`Expected 2 points on the family-size trend line, got ${familyTrend.dotCount}`);
  console.log('Confirmed: one point per generation (Gen 1: 2 children/family, Gen 2: 3 children/family).');

  console.log('\n=== Migration distance matches an independently-computed haversine distance ===');
  const migration = byTitle(cards, 'Migration distance (km)');
  if (!migration.note.includes('across 1 people with both recorded')) {
    throw new Error(`Expected exactly 1 person counted (only gp1 has both a coded birthplace and a separate current location), got note: "${migration.note}"`);
  }
  const statedKm = Number((migration.note.match(/Average ([\d,]+) km/) || [])[1]?.replace(/,/g, ''));
  if (!Number.isFinite(statedKm) || Math.abs(statedKm - expectedMigrationKm) > 5) {
    throw new Error(`Expected ~${Math.round(expectedMigrationKm)} km (Hanoi to Seattle), got "${migration.note}"`);
  }
  console.log(`Confirmed: ${statedKm} km matches an independent haversine calculation (~${Math.round(expectedMigrationKm)} km).`);

  console.log('\n=== Population over time spans from the earliest birth to the current decade ===');
  const population = byTitle(cards, 'Population over time');
  if (population.areaCount !== 1) throw new Error(`Expected one area path, got ${population.areaCount}`);
  if (population.axisLabels[0] !== '1930') throw new Error(`Expected the curve to start at decade 1930, got ${population.axisLabels[0]}`);
  if (population.axisLabels[population.axisLabels.length - 1] !== '2020') {
    throw new Error(`Expected the curve to end at decade 2020, got ${population.axisLabels[population.axisLabels.length - 1]}`);
  }
  console.log('Confirmed: population curve runs from the 1930s (gp1\'s birth) to the 2020s.');

  console.log('\n=== Generation gap widens from Gen 1 to Gen 2, matching hand-computed averages ===');
  const genGap = byTitle(cards, 'Generation gap');
  // Gen 1 (gp1/gp2 -> p1/p2): gaps 30,28,32,30 -> avg 30. Gen 2 (p1/p3 -> c1/c2/c3,
  // p3's level relaxes to match spouse p1's level 1 -- see computeLevels):
  // gaps 30,28,32,30,34,32 -> avg 31.
  if (JSON.stringify(genGap.axisLabels) !== JSON.stringify(['Gen 1', 'Gen 2'])) {
    throw new Error(`Expected ["Gen 1","Gen 2"], got ${JSON.stringify(genGap.axisLabels)}`);
  }
  if (JSON.stringify(genGap.valueLabels) !== JSON.stringify(['30', '31'])) {
    throw new Error(`Expected average parent-age-at-birth of [30, 31] years, got ${JSON.stringify(genGap.valueLabels)}`);
  }
  console.log('Confirmed: Gen 1 averages a 30-year gap, Gen 2 averages 31 years.');

  console.log('\n=== Data completeness reflects exactly who has a photo/location/story ===');
  const completeness = byTitle(cards, 'Data completeness');
  const expectedGauges = [
    { label: 'Has a photo', pct: '13%' }, // 1 of 8 (gp2)
    { label: 'Has a recorded location', pct: '25%' }, // 2 of 8 (gp1, gp2)
    { label: 'Has at least one story', pct: '13%' }, // 1 of 8 (c1)
  ];
  if (JSON.stringify(completeness.gaugeRows) !== JSON.stringify(expectedGauges)) {
    throw new Error(`Expected ${JSON.stringify(expectedGauges)}, got ${JSON.stringify(completeness.gaugeRows)}`);
  }
  console.log('Confirmed: 13% photo, 25% location, 13% story coverage.');

  console.log('\n=== Sparse data (no relations, no deaths, no locations) shows honest empty states, not broken charts ===');
  await loadPeopleIntoStats(page, { solo: { id: 'solo', name: 'Solo Person', birthDate: '1970-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] } });
  const sparseCards = await readCards(page);
  if (sparseCards.length !== 8) throw new Error(`Expected 8 cards even with sparse data, got ${sparseCards.length}`);
  // Chinese zodiac breakdown is deliberately excluded here: the solo person
  // still has a birthDate, so the app's own auto-inference migration gives
  // them a zodiac sign too, correctly producing a real (if tiny) 1-person
  // donut rather than an empty state.
  const noneShouldHaveContent = ['Family size', 'Longevity over time', 'Family size by generation', 'Migration distance (km)', 'Generation gap'];
  for (const title of noneShouldHaveContent) {
    const card = byTitle(sparseCards, title);
    if (!card.emptyMsg) throw new Error(`Expected "${title}" to show an empty-state message with only one unrelated person, got none (note: ${card.note})`);
  }
  console.log('Confirmed: every relation/death/location-dependent card shows an honest "not enough data" message instead of an empty chart.');

  console.log('\n=== Mouse wheel scrolls the dashboard natively instead of being hijacked into canvas zoom ===');
  // Reload the full 8-card dataset -- the previous (sparse, single-person)
  // step's dashboard is short enough to fit without overflowing, which
  // would make this assertion pass for the wrong reason (nothing to
  // scroll) rather than actually proving the wheel-passthrough fix.
  await loadPeopleIntoStats(page, people);
  const before = await page.evaluate(() => document.getElementById('statsContainer').scrollTop);
  await page.hover('#statsContainer');
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => document.getElementById('statsContainer').scrollTop);
  if (after <= before) throw new Error(`Expected the wheel event to scroll #statsContainer natively, but scrollTop went from ${before} to ${after}`);
  console.log(`Confirmed: wheel scroll moved the dashboard (scrollTop ${before} -> ${after}).`);

  console.log('\n=== Switching away from Stats View and back never leaves stale cards or a visible canvas ===');
  await loadPeopleIntoStats(page, people);
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(400);
  const traditionalState = await page.evaluate(() => ({
    canvasVisible: getComputedStyle(document.getElementById('treeCanvas')).display !== 'none',
    statsVisible: getComputedStyle(document.getElementById('statsContainer')).display !== 'none',
    personCardCount: document.querySelectorAll('.person-card').length,
  }));
  if (!traditionalState.canvasVisible) throw new Error('Expected the tree canvas to be visible again after leaving Stats View');
  if (traditionalState.statsVisible) throw new Error('Expected #statsContainer to be hidden after leaving Stats View');
  if (traditionalState.personCardCount !== Object.keys(people).length) {
    throw new Error(`Expected ${Object.keys(people).length} person cards back in Traditional Tree, got ${traditionalState.personCardCount}`);
  }
  await page.selectOption('#viewModeSelect', 'stats');
  await page.waitForTimeout(400);
  const backInStats = await readCards(page);
  if (backInStats.length !== 8) throw new Error(`Expected exactly 8 cards on re-entry (no duplicates), got ${backInStats.length}`);
  console.log('Confirmed: clean handoff both directions, no duplicate cards, no leftover canvas.');

  console.log('\nERRORS:', errors);
  if (errors.length) throw new Error('Unexpected page errors: ' + JSON.stringify(errors));
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
