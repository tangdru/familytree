import { chromium } from 'playwright-core';

// Real jsdelivr CDN is unreachable from this sandbox, so we stub
// window.libphonenumber to capture which defaultCountry app.js actually
// passes through, per the documented AsYouType(defaultCountry) /
// parsePhoneNumberFromString(value, defaultCountry) signatures.
async function installStub(page) {
  await page.addInitScript(() => {
    window.libphonenumber = {
      AsYouType: function (defaultCountry) {
        window.__lastAsYouTypeCountry = defaultCountry;
        this.input = (text) => {
          const digits = text.replace(/[^\d]/g, '');
          const dashed = digits.split('').join('-');
          return text.startsWith('+') ? `+${dashed}` : dashed;
        };
      },
      parsePhoneNumberFromString: (value, defaultCountry) => {
        window.__lastParseCountry = defaultCountry;
        const digits = value.replace(/\D/g, '');
        return { number: `+1${digits}`, country: defaultCountry };
      },
    };
  });
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  // ---- Person with a UK current location: typing a plain number should guess GB ----
  {
    const uk = 'uk';
    const people = {
      [uk]: { id: uk, name: 'Nigel Doe', birthDate: '1970-01-01', deathDate: '', photo: '', notes: '', locations: ['London, United Kingdom'], parents: [], spouses: [] },
    };
    const page = await browser.newPage({ viewport: { width: 480, height: 1000 } });
    const errors = [];
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
    await installStub(page);
    await page.addInitScript((data) => {
      window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
    }, people);
    await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    console.log('=== Person with a UK current location: typing a plain (no +) number should guess GB ===');
    await page.click('.person-card:has-text("Nigel Doe")');
    await page.waitForTimeout(200);
    await page.click('#viewEditBtn');
    await page.waitForTimeout(200);
    await page.click('.contact-row-input');
    await page.keyboard.type('2079460958');
    await page.waitForTimeout(100);
    const country = await page.evaluate(() => window.__lastAsYouTypeCountry);
    console.log('defaultCountry passed to AsYouType:', country);
    if (country !== 'GB') throw new Error('Expected the UK location to guess GB, got: ' + country);

    console.log('\n=== Saving and viewing: contactHref should also guess GB from the saved location ===');
    await page.click('#personForm button[type="submit"]');
    await page.waitForTimeout(200);
    const parseCountry = await page.evaluate(() => window.__lastParseCountry);
    console.log('defaultCountry passed to parsePhoneNumberFromString on view render:', parseCountry);
    if (parseCountry !== 'GB') throw new Error('Expected the view card to also guess GB, got: ' + parseCountry);

    if (errors.length) throw new Error('Page errors: ' + JSON.stringify(errors));
    await page.close();
  }

  // ---- Person with a US current location (state-only, per shortenLocationText): should guess US ----
  {
    const us = 'us';
    const people = {
      [us]: { id: us, name: 'Sam Doe', birthDate: '1970-01-01', deathDate: '', photo: '', notes: '', locations: ['Austin, Texas'], parents: [], spouses: [] },
    };
    const page = await browser.newPage({ viewport: { width: 480, height: 1000 } });
    await installStub(page);
    await page.addInitScript((data) => {
      window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
    }, people);
    await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    console.log('\n=== Person with a US (state-only) current location: should still guess US ===');
    await page.click('.person-card:has-text("Sam Doe")');
    await page.waitForTimeout(200);
    await page.click('#viewEditBtn');
    await page.waitForTimeout(200);
    await page.click('.contact-row-input');
    await page.keyboard.type('5125551234');
    await page.waitForTimeout(100);
    const country = await page.evaluate(() => window.__lastAsYouTypeCountry);
    console.log('defaultCountry passed to AsYouType:', country);
    if (country !== 'US') throw new Error('Expected a Texas location to guess US, got: ' + country);
    await page.close();
  }

  // ---- Person with no current location but a French birth location: should fall back to FR ----
  {
    const fr = 'fr';
    const people = {
      [fr]: { id: fr, name: 'Marie Doe', birthDate: '1970-01-01', deathDate: '', photo: '', notes: '', birthLocation: 'Paris, France', parents: [], spouses: [] },
    };
    const page = await browser.newPage({ viewport: { width: 480, height: 1000 } });
    await installStub(page);
    await page.addInitScript((data) => {
      window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
    }, people);
    await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    console.log('\n=== Person with no current location but a French birth location: should fall back to FR ===');
    await page.click('.person-card:has-text("Marie Doe")');
    await page.waitForTimeout(200);
    await page.click('#viewEditBtn');
    await page.waitForTimeout(200);
    await page.click('.contact-row-input');
    await page.keyboard.type('612345678');
    await page.waitForTimeout(100);
    const country = await page.evaluate(() => window.__lastAsYouTypeCountry);
    console.log('defaultCountry passed to AsYouType:', country);
    if (country !== 'FR') throw new Error('Expected the birth location fallback to guess FR, got: ' + country);
    await page.close();
  }

  // ---- Person with no location info at all: should default to US, unchanged from before ----
  {
    const none = 'none';
    const people = {
      [none]: { id: none, name: 'Unknown Doe', birthDate: '1970-01-01', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
    };
    const page = await browser.newPage({ viewport: { width: 480, height: 1000 } });
    await installStub(page);
    await page.addInitScript((data) => {
      window.localStorage.setItem('familytree.data.v1', JSON.stringify({ people: data }));
    }, people);
    await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    console.log('\n=== Person with no location info at all: should default to US ===');
    await page.click('.person-card:has-text("Unknown Doe")');
    await page.waitForTimeout(200);
    await page.click('#viewEditBtn');
    await page.waitForTimeout(200);
    await page.click('.contact-row-input');
    await page.keyboard.type('2025551234');
    await page.waitForTimeout(100);
    const country = await page.evaluate(() => window.__lastAsYouTypeCountry);
    console.log('defaultCountry passed to AsYouType:', country);
    if (country !== 'US') throw new Error('Expected no-location to default to US, got: ' + country);
    await page.close();
  }

  console.log('\nALL PASSED');
} finally {
  await browser.close();
}
