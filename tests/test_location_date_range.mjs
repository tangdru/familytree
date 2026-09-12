import { chromium } from 'playwright-core';

// The calendar-icon date-range picker on each location row: outline
// (muted) while no date is set, filled (accent) once one is; a plain
// year <select> per Start/End (each independently nullable via "yyyy"),
// deliberately year-only -- family history rarely knows more precision
// than that, and it's what makes this a genuinely different field from
// Born/Died (a full, native date input) rather than an arbitrary second
// UI for the same kind of value.
const p1 = 'p1';
const people = {
  [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', locations: [], parents: [], spouses: [] },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 1100 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== A fresh location row: calendar button starts outline (no dates) ===');
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  // Jane starts with zero locations, so the form already shows one empty
  // row (setLocationRows's own fallback) -- fill THAT as the current
  // location, then +Add a second row for the dated one, so it lands at
  // index 1 ("previous", not current) and shows up in the history list
  // further down rather than the meta row.
  const firstRow = page.locator('.location-row').first();
  await firstRow.locator('.location-row-input').click();
  await page.keyboard.type('Current City, Somewhere');
  await page.click('#addLocationBtn');
  await page.waitForTimeout(100);
  const row = page.locator('.location-row').last();
  await row.locator('.location-row-input').click();
  await page.keyboard.type('Testville, Testland');
  const hasDatesBefore = await row.locator('.location-dates-btn').evaluate(el => el.classList.contains('has-dates'));
  if (hasDatesBefore) throw new Error('Expected the calendar button to start outline (no dates)');
  console.log('Confirmed: outline before any date is set.');

  console.log('\n=== Opening the popover: exactly one year <select> per Start/End (no month/day) ===');
  await row.locator('.location-dates-btn').click();
  await page.waitForTimeout(100);
  const popover = row.locator('.location-date-popover');
  if (await popover.isHidden()) throw new Error('Expected the date popover to open on click');
  const groups = popover.locator('.location-date-group');
  if (await groups.count() !== 2) throw new Error(`Expected exactly 2 groups (Start/End), got ${await groups.count()}`);
  const startYearSelect = groups.nth(0).locator('.location-date-part');
  if (await startYearSelect.count() !== 1) throw new Error(`Expected exactly one year select per group, got ${await startYearSelect.count()}`);
  await startYearSelect.selectOption('1992');
  await page.waitForTimeout(50);

  const hasDatesAfter = await row.locator('.location-dates-btn').evaluate(el => el.classList.contains('has-dates'));
  if (!hasDatesAfter) throw new Error('Expected the calendar button to become filled once a date is set');
  console.log('Confirmed: exactly one year select per Start/End, filled once a start year is set.');

  console.log('\n=== Setting an end year ===');
  const endYearSelect = groups.nth(1).locator('.location-date-part');
  await endYearSelect.selectOption('2005');
  await page.waitForTimeout(50);

  console.log('\n=== The close button explicitly closes the popover ===');
  await row.locator('.location-date-close').click();
  await page.waitForTimeout(100);
  if (await popover.isVisible()) throw new Error('Expected the close button to close the date popover');
  console.log('Confirmed: close button closes the popover.');
  await row.locator('.location-dates-btn').click();
  await page.waitForTimeout(100);
  if (await popover.isHidden()) throw new Error('Expected the date popover to reopen on click');

  console.log('\n=== Clicking outside closes the popover ===');
  await page.click('#notesInput');
  await page.waitForTimeout(100);
  if (await popover.isVisible()) throw new Error('Expected clicking outside to close the date popover');
  console.log('Confirmed: outside click closes the popover.');

  console.log('\n=== Save, then verify the saved year-only date strings ===');
  await page.click('#personForm button[type="submit"]');
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('familytree.data.v1')).people.p1);
  console.log('saved locations:', JSON.stringify(saved.locations));
  const loc = saved.locations.find(l => l.text === 'Testville, Testland');
  if (!loc) throw new Error('Expected the new location to be saved');
  if (loc.startDate !== '1992') throw new Error(`Expected a year-only start date "1992", got: ${JSON.stringify(loc.startDate)}`);
  if (loc.endDate !== '2005') throw new Error(`Expected a year-only end date "2005", got: ${JSON.stringify(loc.endDate)}`);

  console.log('\n=== Re-edit: the popover preloads the same years, calendar button still filled ===');
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  const reRow = page.locator('.location-row').filter({ hasText: 'Testville' });
  const reHasDates = await reRow.locator('.location-dates-btn').evaluate(el => el.classList.contains('has-dates'));
  if (!reHasDates) throw new Error('Expected the calendar button to stay filled after reload');
  await reRow.locator('.location-dates-btn').click();
  await page.waitForTimeout(100);
  const reGroups = reRow.locator('.location-date-popover .location-date-group');
  const reStartYear = await reGroups.nth(0).locator('.location-date-part').inputValue();
  const reEndYear = await reGroups.nth(1).locator('.location-date-part').inputValue();
  console.log('reloaded years:', JSON.stringify({ reStartYear, reEndYear }));
  if (reStartYear !== '1992') throw new Error(`Expected start to reload as 1992, got: ${reStartYear}`);
  if (reEndYear !== '2005') throw new Error(`Expected end to reload as 2005, got: ${reEndYear}`);
  await page.click('#cancelBtn');
  await page.waitForTimeout(200);

  console.log('\n=== Person View: Previous location(s) shows the year range next to the text ===');
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  const historyText = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('#viewLocationsList li'));
    return items.map(li => ({
      text: li.querySelector('.view-location-text')?.textContent,
      dates: li.querySelector('.view-location-dates')?.textContent,
    }));
  });
  console.log('history rows:', JSON.stringify(historyText));
  const testvilleRow = historyText.find(r => r.text === 'Testville, Testland');
  if (!testvilleRow || testvilleRow.dates !== '1992 – 2005') {
    throw new Error(`Expected a "1992 – 2005" year range shown, got: ${JSON.stringify(testvilleRow)}`);
  }
  console.log('Confirmed: year range shown in Previous location(s).');

  console.log('\n=== A non-last row\'s popover is still visible and interactive (not painted underneath later rows) ===');
  // Regression: each .location-row sets z-index: 1, making it its own
  // stacking context -- without bumping that row above its siblings while
  // its popover is open (see .location-row.dates-open in style.css), the
  // popover was silently painted UNDER every row below it, so only the
  // very last row's calendar button ever visibly worked.
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  await page.click('#addLocationBtn');
  await page.waitForTimeout(100);
  const occlusionRows = page.locator('.location-row');
  const rowCount = await occlusionRows.count();
  if (rowCount < 3) throw new Error(`Expected at least 3 rows to test occlusion, got ${rowCount}`);
  const occlusionFirstRow = occlusionRows.nth(0);
  await occlusionFirstRow.locator('.location-dates-btn').click();
  await page.waitForTimeout(150);
  const firstPopover = occlusionFirstRow.locator('.location-date-popover');
  if (await firstPopover.isHidden()) throw new Error('Expected the first row\'s popover to open');
  const firstStartSelect = firstPopover.locator('.location-date-group').nth(0).locator('.location-date-part');
  await firstStartSelect.selectOption('1970');
  await page.waitForTimeout(100);
  const firstStartValue = await firstStartSelect.inputValue();
  console.log('Selected a year on the first (non-last) row\'s popover:', firstStartValue);
  if (firstStartValue !== '1970') throw new Error(`Expected to interact with the first row's popover, got: ${firstStartValue}`);

  console.log('\n=== The current row\'s field is the same width as other rows\' (its "Current" tag reserves space even hidden) ===');
  // Regression: the "Current" tag only shows (non-hidden) on row 0, and
  // the native [hidden]{display:none} let it collapse to zero width on
  // every OTHER row -- making the current row's own .location-field
  // narrower than the rest, so its date popover (sized to match its own
  // field, see .location-date-popover) ended up narrower than the row
  // below it and visually misaligned once opened (see
  // .location-current-tag[hidden] in style.css).
  const currentFieldWidth = (await occlusionFirstRow.locator('.location-field').boundingBox()).width;
  const otherFieldWidth = (await occlusionRows.nth(1).locator('.location-field').boundingBox()).width;
  console.log('current row field width:', currentFieldWidth, 'vs other row:', otherFieldWidth);
  if (Math.abs(currentFieldWidth - otherFieldWidth) > 1) {
    throw new Error(`Expected every row's field to be the same width, got ${currentFieldWidth} vs ${otherFieldWidth}`);
  }

  await page.click('#cancelBtn');
  await page.waitForTimeout(200);

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
