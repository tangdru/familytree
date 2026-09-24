import { chromium } from 'playwright-core';

// The reported bug: tapping the Location field (or any other field) in the
// Add/Edit form opens the on-screen keyboard, but the focused field itself
// ends up hidden behind it. #personForm scrolls its own contents
// internally (.modal-body's overflow-y: auto -- see style.css), and the
// keyboard's native "keep the focused input in view" behavior is
// unreliable against a nested scroll container like that, on top of racing
// fitModalOverlaysToVisualViewport's own async resize (see
// test_modal_visualviewport_pin.mjs). scrollFocusedFieldIntoView fixes it
// generally, for every field (including dynamically-added Location(s)/
// Contact(s) rows), not just the one that was reported -- see its comment
// in app.js. A real page.setViewportSize() shrink (not a synthetic event
// with no real dimension change) is what actually exercises this, same
// technique as test_modal_visualviewport_pin.mjs.
const p1 = 'p1';
const people = {
  [p1]: {
    id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', parents: [], spouses: [],
    birthLocation: { text: 'Seattle, Washington', lat: 47.6062, lon: -122.3321 },
  },
};

function withinViewport(rect, vvHeight) {
  return rect.top >= -1 && rect.bottom <= vvHeight + 1;
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.tourSeen.v1', '1');
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  console.log('=== The reported field: Birth location ends up visible above the shrunk keyboard viewport ===');
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  await page.click('#birthLocationInput');
  await page.waitForTimeout(100);
  await page.setViewportSize({ width: 400, height: 320 }); // stand-in for the keyboard opening
  await page.waitForTimeout(250);
  const birthLocState = await page.evaluate(() => ({
    rect: document.getElementById('birthLocationInput').getBoundingClientRect().toJSON(),
    vvHeight: window.visualViewport.height,
    isActive: document.activeElement === document.getElementById('birthLocationInput'),
  }));
  console.log(JSON.stringify(birthLocState));
  if (!birthLocState.isActive) throw new Error('Expected #birthLocationInput to still be focused after the shrink');
  if (!withinViewport(birthLocState.rect, birthLocState.vvHeight)) {
    throw new Error(`Expected the focused Birth location field to fit within the ${birthLocState.vvHeight}px shrunk viewport, got rect ${JSON.stringify(birthLocState.rect)}`);
  }
  console.log('Confirmed: Birth location stays visible above the simulated keyboard.');

  console.log('\n=== Grow back, then a NATIVE input (Death date) gets the same treatment ===');
  await page.setViewportSize({ width: 400, height: 800 });
  await page.waitForTimeout(200);
  await page.locator('#deathInput').focus();
  await page.waitForTimeout(100);
  await page.setViewportSize({ width: 400, height: 320 });
  await page.waitForTimeout(250);
  const deathState = await page.evaluate(() => ({
    rect: document.getElementById('deathInput').getBoundingClientRect().toJSON(),
    vvHeight: window.visualViewport.height,
  }));
  console.log(JSON.stringify(deathState));
  if (!withinViewport(deathState.rect, deathState.vvHeight)) {
    throw new Error(`Expected the focused native Death date input to fit within the shrunk viewport, got rect ${JSON.stringify(deathState.rect)}`);
  }
  console.log('Confirmed: a plain native <input> gets the same fix, not just contenteditable fields.');

  console.log('\n=== Grow back, then a dynamically-added Location(s) row (deep in the form) also stays reachable ===');
  await page.setViewportSize({ width: 400, height: 800 });
  await page.waitForTimeout(200);
  await page.click('#addLocationBtn');
  await page.waitForTimeout(150);
  const rowInput = page.locator('.location-row-input').last();
  await rowInput.click();
  await page.waitForTimeout(100);
  await page.setViewportSize({ width: 400, height: 320 });
  await page.waitForTimeout(250);
  const rowState = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.location-row-input')].pop();
    return { rect: el.getBoundingClientRect().toJSON(), vvHeight: window.visualViewport.height, isActive: document.activeElement === el };
  });
  console.log(JSON.stringify(rowState));
  if (!rowState.isActive) throw new Error('Expected the new Location(s) row input to still be focused after the shrink');
  if (!withinViewport(rowState.rect, rowState.vvHeight)) {
    throw new Error(`Expected a dynamically-added Location(s) row input to fit within the shrunk viewport, got rect ${JSON.stringify(rowState.rect)}`);
  }
  console.log('Confirmed: even a row added at runtime (not present when the listener was attached) is covered, since focusin bubbles up to #personForm.');

  console.log('\n=== Restoring full height leaves the form usable (no crash, no leftover scroll lock) ===');
  await page.setViewportSize({ width: 400, height: 800 });
  await page.waitForTimeout(200);
  const finalScrollable = await page.evaluate(() => {
    const form = document.getElementById('personForm');
    return { overflowY: getComputedStyle(form).overflowY, scrollTop: form.scrollTop };
  });
  console.log(JSON.stringify(finalScrollable));
  if (finalScrollable.overflowY !== 'auto' && finalScrollable.overflowY !== 'scroll') {
    throw new Error(`Expected #personForm to remain internally scrollable, got overflow-y: ${finalScrollable.overflowY}`);
  }

  console.log('\nERRORS:', errors);
  if (errors.length) throw new Error('Unexpected page errors: ' + JSON.stringify(errors));
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
