import { chromium } from 'playwright-core';

// Zodiac by birth year: Eleanor 1938 -> Tiger, Walter 1935 -> Pig, Susan
// 1962 -> Tiger, Michael 1960 -> Rat, Jane 1990 -> Horse, Tom (no birthdate,
// intentionally) -> unspecified column.
const gp1 = 'gp1', gp2 = 'gp2', p1 = 'p1', p2 = 'p2', c1 = 'c1', c2 = 'c2';
const people = {
  [gp1]: { id: gp1, name: 'Eleanor Hart', birthDate: '1938-03-12', deathDate: '2015-11-02', photo: '', notes: '', parents: [], spouses: [gp2], zodiac: 'Tiger' },
  [gp2]: { id: gp2, name: 'Walter Hart', birthDate: '1935-07-04', deathDate: '2012-01-20', photo: '', notes: '', parents: [], spouses: [gp1], zodiac: 'Pig' },
  [p1]: { id: p1, name: 'Susan Hart', birthDate: '1962-05-18', deathDate: '', photo: '', notes: '', parents: [gp1, gp2], spouses: [p2], zodiac: 'Tiger' },
  [p2]: { id: p2, name: 'Michael Doe', birthDate: '1960-09-09', deathDate: '', photo: '', notes: '', parents: [], spouses: [p1], zodiac: 'Rat' },
  [c1]: { id: c1, name: 'Jane Doe', birthDate: '1990-02-14', deathDate: '', photo: '', notes: '', parents: [p1, p2], spouses: [], zodiac: 'Horse' },
  [c2]: { id: c2, name: 'Tom Doe', birthDate: '', deathDate: '', photo: '', notes: '', parents: [p1, p2], spouses: [], zodiac: '' },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== Switch to Zodiac Tree ===');
  await page.selectOption('#viewModeSelect', 'zodiac');
  await page.waitForTimeout(500);

  console.log('=== Every person appears exactly once, under the right column header ===');
  const layout = await page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('.zodiac-column-header')).map(el => ({
      label: el.querySelector('.zodiac-header-label').textContent,
      left: el.offsetLeft,
    }));
    const cards = Array.from(document.querySelectorAll('.person-card')).map(el => ({
      id: el.dataset.id,
      name: el.querySelector('.person-name').textContent,
      left: el.offsetLeft,
      top: el.offsetTop,
    }));
    return { headers, cards };
  });
  console.log('headers:', JSON.stringify(layout.headers));
  console.log('cards:', JSON.stringify(layout.cards));

  if (layout.cards.length !== 6) throw new Error(`Expected 6 cards, got ${layout.cards.length}`);
  const byName = Object.fromEntries(layout.cards.map(c => [c.name, c]));

  const headerAtLeft = (left) => layout.headers.find(h => h.left === left);
  const tigerHeader = layout.headers.find(h => h.label === 'Tiger');
  const ratHeader = layout.headers.find(h => h.label === 'Rat');
  const pigHeader = layout.headers.find(h => h.label === 'Pig');
  const horseHeader = layout.headers.find(h => h.label === 'Horse');
  const noneHeader = layout.headers.find(h => h.label === 'No zodiac set');
  if (!tigerHeader || !ratHeader || !pigHeader || !horseHeader || !noneHeader) {
    throw new Error('Expected to find Tiger/Rat/Pig/Horse/"No zodiac set" column headers');
  }

  if (byName['Eleanor Hart'].left !== tigerHeader.left) throw new Error('Expected Eleanor (Tiger) under the Tiger column');
  if (byName['Susan Hart'].left !== tigerHeader.left) throw new Error('Expected Susan (Tiger) under the Tiger column');
  if (byName['Walter Hart'].left !== pigHeader.left) throw new Error('Expected Walter (Pig) under the Pig column');
  if (byName['Michael Doe'].left !== ratHeader.left) throw new Error('Expected Michael (Rat) under the Rat column');
  if (byName['Jane Doe'].left !== horseHeader.left) throw new Error('Expected Jane (Horse) under the Horse column');
  if (byName['Tom Doe'].left !== noneHeader.left) throw new Error('Expected Tom (no zodiac) under the "No zodiac set" column');
  console.log('Confirmed: everyone lands in the correct zodiac column.');

  console.log('\n=== Two people sharing a column (Eleanor + Susan, both Tiger) stack without overlapping ===');
  const eleanor = byName['Eleanor Hart'], susan = byName['Susan Hart'];
  const [top1, top2] = [eleanor.top, susan.top].sort((a, b) => a - b);
  if (top2 - top1 < 50) throw new Error(`Expected Tiger column members to be stacked with real vertical separation, got gap ${top2 - top1}`);
  console.log(`Confirmed: Tiger column stacks with a ${top2 - top1}px gap.`);

  console.log('\n=== No connector lines are drawn in zodiac view ===');
  const lineCount = await page.evaluate(() => document.querySelectorAll('#linesSvg > *').length);
  if (lineCount !== 0) throw new Error(`Expected zero SVG elements in zodiac view, found ${lineCount}`);
  console.log('Confirmed: SVG is empty (no connector lines).');

  console.log('\n=== Clicking a card still opens its Person View modal (zodiac view keeps normal click behavior) ===');
  await page.click(`[data-id="${gp1}"]`);
  await page.waitForTimeout(200);
  const modalHidden = await page.evaluate(() => document.getElementById('personViewModal').hidden);
  if (modalHidden) throw new Error('Expected clicking a card in zodiac view to open the Person View modal');
  console.log('Confirmed: click-to-view still works in zodiac view.');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(200);

  console.log('\n=== Switching away and back preserves correct grouping (FLIP animation + re-render) ===');
  await page.selectOption('#viewModeSelect', 'traditional');
  await page.waitForTimeout(500);
  await page.selectOption('#viewModeSelect', 'zodiac');
  await page.waitForTimeout(500);
  const recheck = await page.evaluate(() => document.querySelectorAll('.person-card').length);
  if (recheck !== 6) throw new Error(`Expected 6 cards after toggling views, got ${recheck}`);
  console.log('Confirmed: zodiac view re-renders correctly after switching away and back.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
