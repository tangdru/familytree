import { chromium } from 'playwright-core';

// The real jsdelivr CDN is unreachable from this sandbox, so we can't
// exercise the actual libphonenumber-js bundle end-to-end here. This test
// does two things instead:
//   1. Confirms the app correctly detects the CDN didn't load and falls
//      back gracefully (no crash, still usable, old US-only grouping).
//   2. Injects a *minimal stand-in* for window.libphonenumber before app.js
//      runs, implementing just enough of the real AsYouType/
//      parsePhoneNumberFromString contract (per libphonenumber-js's
//      documented API) to prove app.js's integration calls it correctly
//      and uses its output -- i.e. that formatPhoneLive/contactHref really
//      do delegate to window.libphonenumber when it's present, rather than
//      always silently using the fallback.

const p1 = 'p1';
const people = {
  [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  // ---- Part 1: confirm the CDN is in fact unreachable here, and the field still works (fallback path) ----
  {
    const page = await browser.newPage({ viewport: { width: 480, height: 1000 } });
    const errors = [];
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
    await page.addInitScript((data) => {
      window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
    }, people);
    await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const libAvailable = await page.evaluate(() => typeof window.libphonenumber !== 'undefined');
    console.log('=== window.libphonenumber available in this sandbox (expect false -- CDN blocked) ===');
    console.log(libAvailable);
    if (libAvailable) console.log('(CDN reachable after all -- real library path exercised naturally by the other test.)');

    await page.click('.person-card:has-text("Jane Doe")');
    await page.waitForTimeout(200);
    await page.click('#viewEditBtn');
    await page.waitForTimeout(200);
    await page.click('.contact-row-input');
    await page.keyboard.type('6175551234');
    await page.waitForTimeout(100);
    const value = await page.$eval('.contact-row-input', el => el.textContent);
    console.log('fallback-path formatted value:', value);
    if (value !== '617-555-1234') throw new Error('Expected the fallback grouping to still work: ' + value);
    if (errors.length) throw new Error('Page errors: ' + JSON.stringify(errors));
    await page.close();
  }

  // ---- Part 2: stub window.libphonenumber to prove app.js's integration shape is correct ----
  {
    const page = await browser.newPage({ viewport: { width: 480, height: 1000 } });
    const errors = [];
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
    await page.addInitScript((data) => {
      window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
    }, people);
    // Installed before app.js runs (addInitScript order = registration order,
    // and this is registered first in this block, then the data-seed one
    // above already ran for a different page -- each page gets its own
    // addInitScript queue, so order within *this* page's queue is what matters).
    await page.addInitScript(() => {
      window.libphonenumber = {
        AsYouType: function (defaultCountry) {
          this.defaultCountry = defaultCountry;
          this.input = (text) => {
            // Minimal stand-in: real AsYouType groups by country. We just
            // prove app.js *called this* with the right raw text, and that
            // whatever it returns ends up in the field verbatim. Must stay
            // digit-count-invariant like the real library (only inserts
            // separators, never adds/removes digits) since app.js re-feeds
            // this function's own previous output (stripped of separators)
            // back in on every keystroke -- a stub that *grows* the digit
            // count each call would compound forever, which isn't a real
            // bug, just an unrealistic stub. Dashing every single digit is
            // an obviously-fake, unmistakably-not-real-formatting marker.
            const digits = text.replace(/[^\d]/g, '');
            const dashed = digits.split('').join('-');
            return text.startsWith('+') ? `+${dashed}` : dashed;
          };
        },
        parsePhoneNumberFromString: (value, defaultCountry) => {
          const digits = value.replace(/\D/g, '');
          return { number: `+1${digits}`, country: defaultCountry };
        },
      };
    });
    await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const libAvailable = await page.evaluate(() => typeof window.libphonenumber !== 'undefined' && typeof window.libphonenumber.AsYouType === 'function');
    console.log('\n=== Stub window.libphonenumber installed before app.js loaded ===');
    console.log('available:', libAvailable);
    if (!libAvailable) throw new Error('Expected the stub to be present for app.js to pick up');

    console.log('\n=== Typing a domestic number: app.js should call AsYouType and use its output verbatim ===');
    await page.click('.person-card:has-text("Jane Doe")');
    await page.waitForTimeout(200);
    await page.click('#viewEditBtn');
    await page.waitForTimeout(200);
    await page.click('.contact-row-input');
    await page.keyboard.type('6175551234');
    await page.waitForTimeout(100);
    let value = await page.$eval('.contact-row-input', el => el.textContent);
    console.log('value:', value);
    if (value !== '6-1-7-5-5-5-1-2-3-4') throw new Error('Expected app.js to delegate to the stub AsYouType for a domestic number, got: ' + value);

    console.log('\n=== Typing an international number (leading +): the "+" must survive into what gets passed to AsYouType ===');
    await page.click('.contact-row-input');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('+442079460958');
    await page.waitForTimeout(100);
    value = await page.$eval('.contact-row-input', el => el.textContent);
    console.log('value:', value);
    if (value !== '+4-4-2-0-7-9-4-6-0-9-5-8') throw new Error('Expected the leading + to survive and reach the stub, got: ' + value);

    console.log('\n=== Saving and viewing: contactHref should use parsePhoneNumberFromString\'s E.164 .number ===');
    await page.click('#personForm button[type="submit"]');
    await page.waitForTimeout(200);
    const href = await page.$eval('#viewContact a', el => el.getAttribute('href'));
    console.log('tel: href:', href);
    if (!href.startsWith('tel:+1')) throw new Error('Expected contactHref to use the stubbed E.164 .number, got: ' + href);

    if (errors.length) throw new Error('Page errors: ' + JSON.stringify(errors));
    await page.close();
  }

  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
