import { chromium } from 'playwright-core';

// focusOnCard() (see app.js) centers a specific person's card in the
// viewport AND zooms so their circle is CARD_FOCUS_WIDTH_FRACTION (20%) of
// the viewport's width, regardless of whatever zoom level was already in
// effect -- used after adding a person, after editing one, and from a
// search match, so the user's attention always lands on the right card at
// a legible, consistent size instead of wherever/whatever the camera
// happened to be at before.
const p1 = 'p1', p2 = 'p2', p3 = 'p3';
const people = {
  [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
  [p2]: { id: p2, name: 'Someone Else', birthDate: '1960-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
  [p3]: { id: p3, name: 'A Third Person', birthDate: '1990-06-15', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
};

const VIEWPORT = { width: 480, height: 950 };
const EXPECTED_SCALE = (VIEWPORT.width * 0.2) / 150; // CARD_FOCUS_WIDTH_FRACTION * vw / CARD_WIDTH
const EXPECTED_CARD_WIDTH = 150 * EXPECTED_SCALE;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.addInitScript((data) => {
    window.localStorage.setItem('familytree.tourSeen.v1', '1');
    window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
  }, people);
  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  // Checks two different elements: the whole card's box (its width is what
  // "zoomed to 20% of viewport width" means -- CARD_WIDTH, 150px, scaled)
  // and the photo circle within it specifically (what should actually be
  // CENTERED -- the card's own box also includes the name/dates caption
  // below the photo, which would pull a whole-box center down off the
  // circle if that's what got centered instead).
  async function cardAndPhotoRectByName(name) {
    return page.evaluate((n) => {
      const card = Array.from(document.querySelectorAll('.person-card')).find(c => c.querySelector('.person-name').textContent === n);
      if (!card) return null;
      const photo = card.querySelector('.person-photo');
      const cardRect = card.getBoundingClientRect();
      const photoRect = photo.getBoundingClientRect();
      return {
        cardWidth: cardRect.width,
        photoCenterX: photoRect.x + photoRect.width / 2,
        photoCenterY: photoRect.y + photoRect.height / 2,
      };
    }, name);
  }

  // The tree lives in #treeViewport, below the sticky toolbar -- its
  // center (what focusOnCard actually centers on) sits lower on the page
  // than the raw page viewport's center would.
  async function treeViewportCenter() {
    return page.evaluate(() => {
      const r = document.getElementById('treeViewport').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
  }

  function assertFocused(rect, center, label) {
    if (!rect) throw new Error(`${label}: card not found`);
    console.log(label, JSON.stringify(rect));
    if (Math.abs(rect.cardWidth - EXPECTED_CARD_WIDTH) > 3) {
      throw new Error(`${label}: expected card width ~${EXPECTED_CARD_WIDTH.toFixed(1)}px (20% of viewport width), got ${rect.cardWidth.toFixed(1)}px`);
    }
    if (Math.abs(rect.photoCenterX - center.x) > 3) {
      throw new Error(`${label}: expected the photo circle horizontally centered (~${center.x}), got centerX ${rect.photoCenterX.toFixed(1)}`);
    }
    if (Math.abs(rect.photoCenterY - center.y) > 3) {
      throw new Error(`${label}: expected the photo circle vertically centered (~${center.y}), got centerY ${rect.photoCenterY.toFixed(1)}`);
    }
  }

  console.log('=== Adding a new person centers + zooms the tree on their new card ===');
  await page.click('#addPersonBtn');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    document.getElementById('nameInput').textContent = 'Zoe Focus';
    document.getElementById('nameInput').dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('button[type="submit"]');
  await page.waitForTimeout(500); // outlasts FIT_VIEW_MS (380ms)
  assertFocused(await cardAndPhotoRectByName('Zoe Focus'), await treeViewportCenter(), 'After adding Zoe Focus');
  console.log('Confirmed: newly-added person ends up centered at 20% viewport width.');

  console.log('\n=== Editing an existing person centers + zooms the tree behind the Person View card ===');
  await page.click('.person-card:has-text("Jane Doe")');
  await page.waitForTimeout(200);
  await page.click('#viewEditBtn');
  await page.waitForTimeout(200);
  await page.click('button[type="submit"]'); // no changes, just re-save
  await page.waitForTimeout(500);
  const viewModalHiddenAfterEdit = await page.evaluate(() => document.getElementById('personViewModal').hidden);
  if (viewModalHiddenAfterEdit) throw new Error('Expected saving an edit to return to the Person View, not the bare tree');
  await page.click('#viewCloseBtn');
  await page.waitForTimeout(100);
  assertFocused(await cardAndPhotoRectByName('Jane Doe'), await treeViewportCenter(), 'After editing Jane Doe (tree revealed after closing the card)');
  console.log('Confirmed: the tree was already framed on the edited person by the time their card closed.');

  console.log('\n=== Searching for a person uses the same centering + zoom ===');
  await page.click('#searchToggleBtn');
  await page.waitForTimeout(150);
  await page.fill('#searchInput', 'Someone Else');
  await page.waitForTimeout(500);
  assertFocused(await cardAndPhotoRectByName('Someone Else'), await treeViewportCenter(), 'After searching for Someone Else');
  console.log('Confirmed: a search match is centered + zoomed the same way.');

  console.log('\nERRORS:', errors);
  if (errors.length) process.exit(1);
  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
