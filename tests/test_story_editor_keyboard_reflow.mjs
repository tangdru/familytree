import { chromium } from 'playwright-core';

// Reported from a real phone: opening the Add Story editor and focusing the
// textarea brings up the keyboard, which shrinks the visible (visual)
// viewport -- but the browser's own "scroll focused input into view" only
// keeps the *textarea* visible, not the record/cancel/save buttons that sit
// below it in the same scrollable .view-modal-body. Those ended up clipped
// behind the keyboard, unreachable. Simulates the keyboard by shrinking the
// viewport height (which shrinks visualViewport the same way a real
// keyboard does) and checks the footer is both scrolled into view AND
// actually hit-testable at its own coordinates (not just "in view" per an
// unclipped bounding rect -- see elementFromPoint use below).
const alice = 'alice';
const people = {
  [alice]: { id: alice, name: 'Alice Doe', birthDate: '1950-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  await page.click('.person-card:has-text("Alice Doe")');
  await page.waitForTimeout(200);
  await page.click('#addStoryBtn');
  await page.waitForTimeout(150);

  console.log('=== Simulating the keyboard opening (shrinking the visible viewport) ===');
  // A real keyboard shrinks window.visualViewport without changing
  // window.innerHeight; shrinking the actual viewport is the closest a
  // headless browser can get, and it drives the same visualViewport
  // 'resize' listeners the real keyboard would.
  await page.setViewportSize({ width: 390, height: 380 });
  await page.waitForTimeout(300);

  const check = await page.evaluate(() => {
    const footer = document.querySelector('.story-editor-footer');
    const card = document.getElementById('personViewCard');
    const fr = footer.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const cx = fr.left + fr.width / 2;
    const cy = fr.top + fr.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return {
      footerRect: { top: fr.top, bottom: fr.bottom },
      cardRect: { top: cr.top, bottom: cr.bottom },
      hitIsInsideFooter: !!(hit && footer.contains(hit)),
    };
  });
  console.log(JSON.stringify(check));
  if (check.footerRect.bottom > check.cardRect.bottom + 1 || check.footerRect.top < check.cardRect.top - 1) {
    throw new Error(`Expected the footer to be scrolled within the modal card's own (now keyboard-shrunk) bounds, got ${JSON.stringify(check)}`);
  }
  if (!check.hitIsInsideFooter) {
    throw new Error('Expected the footer to actually be hit-testable at its own coordinates, not covered by something else');
  }
  console.log('Confirmed: the Save/Cancel/Record footer stays visible and tappable once the keyboard shrinks the viewport.');

  console.log('\nERRORS:', errors);
  if (errors.length) throw new Error('Unexpected page errors: ' + JSON.stringify(errors));
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
