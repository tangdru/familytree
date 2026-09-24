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
      headlineValue: card.querySelector('.stat-headline-value')?.textContent || null,
      headlineLabel: card.querySelector('.stat-headline-label')?.textContent || null,
      axisLabels: [...card.querySelectorAll('.stat-chart-axis-label')].map(e => e.textContent),
      bubbleValues: [...card.querySelectorAll('.stat-bubble-value')].map(e => e.textContent),
      dotCount: card.querySelectorAll('.stat-chart-dot').length,
      annotationText: card.querySelector('.stat-chart-annotation')?.textContent || null,
      areaCount: card.querySelectorAll('.stat-chart-area').length,
      wheelEmoji: [...card.querySelectorAll('.stat-wheel-emoji')].map(e => e.textContent),
      wheelCounts: [...card.querySelectorAll('.stat-wheel-count')].map(e => e.textContent),
      multiplePanels: [...card.querySelectorAll('.stat-multiple-panel')].map(p => ({
        label: p.querySelector('.stat-multiple-label').textContent,
        endLabel: p.querySelector('.stat-chart-end-label')?.textContent || null,
        axisLabels: [...p.querySelectorAll('.stat-chart-axis-label')].map(e => e.textContent),
      })),
      radialLegend: [...card.querySelectorAll('.stat-radial-legend-item')].map(e => e.textContent.trim()),
      badges: [...card.querySelectorAll('.stat-badge-item')].map(b => ({
        pct: b.querySelector('.stat-badge-pct').textContent,
        label: b.querySelector('.stat-badge-label').textContent,
      })),
    }));
  });
}

function byTitle(cards, title) {
  const card = cards.find(c => c.title === title);
  if (!card) throw new Error(`Expected a "${title}" card, got titles: ${cards.map(c => c.title).join(', ')}`);
  return card;
}

const EXPECTED_TITLES = [
  'Family size', 'Longevity over time', 'Chinese zodiac breakdown', 'Generational trends',
  'Migration distance (km)', 'Population over time', 'Data completeness',
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });

  console.log('=== Stats View renders all 7 population-level insight cards ===');
  await loadPeopleIntoStats(page, people);
  const cards = await readCards(page);
  const actualTitles = cards.map(c => c.title);
  if (JSON.stringify(actualTitles) !== JSON.stringify(EXPECTED_TITLES)) {
    throw new Error(`Expected card titles ${JSON.stringify(EXPECTED_TITLES)}, got ${JSON.stringify(actualTitles)}`);
  }
  console.log('Confirmed: all 7 cards render, in the expected order.');

  console.log('\n=== Family size bubbles match the two real families, headline shows the largest ===');
  const familySize = byTitle(cards, 'Family size');
  if (familySize.headlineValue !== '3') {
    throw new Error(`Expected the largest-family headline to read "3" (p1+p3's 3 kids), got "${familySize.headlineValue}"`);
  }
  const expectedBuckets = ['1', '2', '3', '4', '5+'];
  if (JSON.stringify(familySize.axisLabels) !== JSON.stringify(expectedBuckets)) {
    throw new Error(`Expected bucket labels ${JSON.stringify(expectedBuckets)}, got ${JSON.stringify(familySize.axisLabels)}`);
  }
  // Only the "2 children" (gp1+gp2) and "3 children" (p1+p3) families exist,
  // so exactly two buckets get a bubble, each holding exactly 1 family.
  if (JSON.stringify(familySize.bubbleValues) !== JSON.stringify(['1', '1'])) {
    throw new Error(`Expected exactly two families of size 1 each in their bucket, got bubble values ${JSON.stringify(familySize.bubbleValues)}`);
  }
  console.log('Confirmed: one family of 2 children, one family of 3 children; headline calls out the largest (3).');

  console.log('\n=== Longevity scatter plot annotates the oldest life directly ===');
  const longevity = byTitle(cards, 'Longevity over time');
  if (longevity.headlineValue !== '70 yrs') throw new Error(`Expected headline "70 yrs" (gp2's 70-year lifespan), got "${longevity.headlineValue}"`);
  if (longevity.dotCount !== 2) throw new Error(`Expected 2 longevity dots (gp1, gp2), got ${longevity.dotCount}`);
  if (longevity.annotationText !== '70 yrs') throw new Error(`Expected the on-chart annotation to read "70 yrs", got "${longevity.annotationText}"`);
  if (!longevity.axisLabels.includes('1930') || !longevity.axisLabels.includes('1932')) {
    throw new Error(`Expected birth-year axis labels to include 1930 and 1932, got ${JSON.stringify(longevity.axisLabels)}`);
  }
  console.log('Confirmed: 2 points plotted, oldest life (70 yrs) called out both as the headline and directly on the chart.');

  console.log('\n=== Chinese zodiac wheel reflects birth-year-inferred signs, most common as headline ===');
  const zodiac = byTitle(cards, 'Chinese zodiac breakdown');
  // Rat(p1,1960), Tiger(p2+p3,1962 -- SAME birth year), Horse(gp1+c1,1930/1990),
  // Monkey(gp2+c2,1932/1992), Dog(c3,1994). Tiger/Horse/Monkey tie at 2 each;
  // .reduce picks the first strictly-greater, so whichever comes first in
  // ZODIAC_CYCLE order (Tiger, before Horse and Monkey) wins the tie.
  if (zodiac.headlineValue !== '🐅 Tiger') throw new Error(`Expected the most-common-sign headline to read "🐅 Tiger" (ties with Horse/Monkey, cycle order wins), got "${zodiac.headlineValue}"`);
  const expectedWheelCounts = ['1', '2', '2', '2', '1']; // Rat, Tiger, Horse, Monkey, Dog in cycle order
  if (JSON.stringify(zodiac.wheelCounts.slice().sort()) !== JSON.stringify(expectedWheelCounts.slice().sort())) {
    throw new Error(`Expected wheel wedge counts ${JSON.stringify(expectedWheelCounts)}, got ${JSON.stringify(zodiac.wheelCounts)}`);
  }
  if (zodiac.wheelEmoji.length !== 5) throw new Error(`Expected 5 zodiac signs represented (Rat, Tiger, Horse, Monkey, Dog), got ${zodiac.wheelEmoji.length} emoji labels`);
  console.log(`Confirmed: 5 signs on the wheel (counts ${JSON.stringify(zodiac.wheelCounts)}), headline names the most common (first tie-breaker in cycle order).`);

  console.log('\n=== Generational trends merges family size + generation gap as two single-axis panels ===');
  const genTrends = byTitle(cards, 'Generational trends');
  if (genTrends.multiplePanels.length !== 2) throw new Error(`Expected 2 small-multiple panels, got ${genTrends.multiplePanels.length}`);
  const familyPanel = genTrends.multiplePanels.find(p => p.label === 'Family size');
  const gapPanel = genTrends.multiplePanels.find(p => p.label === 'Generation gap (yrs)');
  if (!familyPanel || !gapPanel) throw new Error(`Expected panels labeled "Family size" and "Generation gap (yrs)", got ${JSON.stringify(genTrends.multiplePanels.map(p => p.label))}`);
  if (JSON.stringify(familyPanel.axisLabels) !== JSON.stringify(['Gen 1', 'Gen 2'])) {
    throw new Error(`Expected generation labels ["Gen 1","Gen 2"], got ${JSON.stringify(familyPanel.axisLabels)}`);
  }
  if (familyPanel.endLabel !== '3.0') throw new Error(`Expected the family-size panel's end label to be "3.0" (Gen 2 average), got "${familyPanel.endLabel}"`);
  // Gen 1 (gp1/gp2 -> p1/p2): gaps 30,28,32,30 -> avg 30. Gen 2 (p1/p3 -> c1/c2/c3,
  // p3's level relaxes to match spouse p1's level 1 -- see computeLevels):
  // gaps 30,28,32,30,34,32 -> avg 31.
  if (gapPanel.endLabel !== '31') throw new Error(`Expected the generation-gap panel's end label to be "31" (Gen 2 average), got "${gapPanel.endLabel}"`);
  console.log('Confirmed: two single-axis panels (never one dual-axis chart), each ending in its own directly-labeled value.');

  console.log('\n=== Migration distance radial ladder matches an independently-computed haversine distance ===');
  const migration = byTitle(cards, 'Migration distance (km)');
  if (!migration.note.includes('across 1 people with both recorded')) {
    throw new Error(`Expected exactly 1 person counted (only gp1 has both a coded birthplace and a separate current location), got note: "${migration.note}"`);
  }
  const statedKm = Number((migration.note.match(/Average ([\d,]+) km/) || [])[1]?.replace(/,/g, ''));
  if (!Number.isFinite(statedKm) || Math.abs(statedKm - expectedMigrationKm) > 5) {
    throw new Error(`Expected ~${Math.round(expectedMigrationKm)} km (Hanoi to Seattle), got "${migration.note}"`);
  }
  const headlineKm = Number((migration.headlineValue || '').replace(/[^\d]/g, ''));
  if (Math.abs(headlineKm - expectedMigrationKm) > 5) {
    throw new Error(`Expected the farthest-move headline to also read ~${Math.round(expectedMigrationKm)} km, got "${migration.headlineValue}"`);
  }
  if (!migration.radialLegend.some(item => item.startsWith('5k+:') && item.endsWith('1'))) {
    throw new Error(`Expected the radial legend to show "5k+: 1" (the one long-distance move), got ${JSON.stringify(migration.radialLegend)}`);
  }
  console.log(`Confirmed: ${statedKm} km matches an independent haversine calculation (~${Math.round(expectedMigrationKm)} km), radial legend confirms the bucket.`);

  console.log('\n=== Population over time annotates the peak decade directly ===');
  const population = byTitle(cards, 'Population over time');
  // Peak is at the 2000s, not 2020s: by then all 8 are born, gp2 (d.2002)
  // is still alive at the decade's start (2002 >= 2000), but gp1 (d.1990)
  // is already gone (1990 < 2000) -- 8 - 1 = 7, the tree's actual maximum.
  if (population.headlineValue !== '7') throw new Error(`Expected the peak-population headline to read "7" (all 8 born, only gp1 already gone by the 2000s), got "${population.headlineValue}"`);
  if (population.headlineLabel !== 'alive in the 2000s') throw new Error(`Expected the headline label to name the 2000s as the peak decade, got "${population.headlineLabel}"`);
  if (population.areaCount !== 1) throw new Error(`Expected one area path, got ${population.areaCount}`);
  if (population.annotationText !== '7') throw new Error(`Expected the on-chart peak annotation to read "7", got "${population.annotationText}"`);
  if (population.axisLabels[0] !== '1930') throw new Error(`Expected the curve to start at decade 1930, got ${population.axisLabels[0]}`);
  if (population.axisLabels[population.axisLabels.length - 1] !== '2020') {
    throw new Error(`Expected the curve to end at decade 2020, got ${population.axisLabels[population.axisLabels.length - 1]}`);
  }
  console.log('Confirmed: population curve runs from the 1930s to the 2020s, peak (7, in the 2000s) called out as both headline and on-chart annotation.');

  console.log('\n=== Data completeness badges reflect exactly who has a photo/location/story ===');
  const completeness = byTitle(cards, 'Data completeness');
  const expectedBadges = [
    { pct: '13%', label: 'Has a photo' }, // 1 of 8 (gp2)
    { pct: '25%', label: 'Has a recorded location' }, // 2 of 8 (gp1, gp2)
    { pct: '13%', label: 'Has at least one story' }, // 1 of 8 (c1)
  ];
  if (JSON.stringify(completeness.badges) !== JSON.stringify(expectedBadges)) {
    throw new Error(`Expected ${JSON.stringify(expectedBadges)}, got ${JSON.stringify(completeness.badges)}`);
  }
  console.log('Confirmed: 13% photo, 25% location, 13% story coverage, each its own circular badge.');

  console.log('\n=== Sparse data (no relations, no deaths, no locations) shows honest empty states, not broken charts ===');
  await loadPeopleIntoStats(page, { solo: { id: 'solo', name: 'Solo Person', birthDate: '1970-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] } });
  const sparseCards = await readCards(page);
  if (sparseCards.length !== 7) throw new Error(`Expected 7 cards even with sparse data, got ${sparseCards.length}`);
  // Chinese zodiac breakdown is deliberately excluded here: the solo person
  // still has a birthDate, so the app's own auto-inference migration gives
  // them a zodiac sign too, correctly producing a real (if tiny) 1-person
  // wheel rather than an empty state.
  const noneShouldHaveContent = ['Family size', 'Longevity over time', 'Generational trends', 'Migration distance (km)'];
  for (const title of noneShouldHaveContent) {
    const card = byTitle(sparseCards, title);
    if (!card.emptyMsg) throw new Error(`Expected "${title}" to show an empty-state message with only one unrelated person, got none (note: ${card.note})`);
  }
  console.log('Confirmed: every relation/death/location-dependent card shows an honest "not enough data" message instead of an empty chart.');

  console.log('\n=== Mouse wheel scrolls the dashboard natively instead of being hijacked into canvas zoom ===');
  // Reload the full dataset -- the previous (sparse, single-person) step's
  // dashboard is short enough to fit without overflowing, which would make
  // this assertion pass for the wrong reason (nothing to scroll) rather
  // than actually proving the wheel-passthrough fix.
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
  if (backInStats.length !== 7) throw new Error(`Expected exactly 7 cards on re-entry (no duplicates), got ${backInStats.length}`);
  console.log('Confirmed: clean handoff both directions, no duplicate cards, no leftover canvas.');

  console.log('\nERRORS:', errors);
  if (errors.length) throw new Error('Unexpected page errors: ' + JSON.stringify(errors));
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
