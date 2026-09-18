import { chromium } from 'playwright-core';

// Exercises voiceRecordingReady's actual Supabase-connected branch (see
// init() in app.js): a bucket probe via a real (tiny, upserted-in-place)
// storage.from(bucket).upload() right after connecting, which the record
// button's presence depends on. Deliberately NOT list(): storage.objects.
// bucket_id has no real existence check behind a list() query -- it's
// just a SELECT filtered by bucket_id, and the RLS read policy this
// schema installs matches that filter whether or not any such bucket
// actually exists, so a missing bucket and an existing-but-empty one both
// come back as `{ data: [], error: null }` (confirmed directly against
// the real project's database). An upload can't have that ambiguity:
// storage.objects.bucket_id is a hard foreign key into storage.buckets
// (id), so inserting into a bucket that was never created fails at the
// database level regardless of any RLS policy. Real network access to
// Supabase/its CDN is blocked in this sandbox, so both are faked via
// request interception -- config.js is replaced with fake (but
// well-formed) credentials, and the supabase-js CDN script is replaced
// with a minimal fake client exercising the exact same call shapes
// app.js makes (loadRemote/saveRemote/subscribeRealtime/the bucket
// probe), just resolving locally instead of over the network.
function fakeSupabaseScript(bucketMissing) {
  return `window.supabase = {
    createClient: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        upsert: async () => ({ error: null }),
      }),
      channel: () => ({ on: () => ({ subscribe: () => {} }) }),
      storage: {
        from: () => ({
          upload: async () => ({ error: ${bucketMissing ? `{ message: 'insert or update on table "objects" violates foreign key constraint "objects_bucketId_fkey"' }` : 'null'} }),
        }),
      },
    }),
  };`;
}

async function runOnce(bucketMissing) {
  const p1 = 'p1';
  const people = {
    [p1]: { id: p1, name: 'Jane Doe', birthDate: '1985-03-02', deathDate: '', photo: '', notes: '', parents: [], spouses: [] },
  };

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try {
    const page = await browser.newPage({ viewport: { width: 480, height: 950 } });
    const errors = [];
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

    await page.route('**/config.js*', route => route.fulfill({
      contentType: 'application/javascript',
      body: `window.SUPABASE_CONFIG = { url: 'https://fake.test', anonKey: 'fake-key' };`,
    }));
    await page.route('**/@supabase/supabase-js@2*', route => route.fulfill({
      contentType: 'application/javascript',
      body: fakeSupabaseScript(bucketMissing),
    }));

    // No localStorage seeding needed/relevant here -- the fake client's
    // maybeSingle() always returns no existing row, so init() seeds
    // sample data through the normal (fake) Supabase save path.
    await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    const syncState = await page.evaluate(() => document.getElementById('syncStatus')?.className);
    await page.click('.person-card:has-text("Eleanor Hart"), .person-card:has-text("Alex Doe"), .tree-content .person-card >> nth=0');
    await page.waitForTimeout(200);
    await page.click('#addStoryBtn');
    await page.waitForTimeout(150);
    const recordBtnVisible = await page.locator('.story-record-btn').isVisible().catch(() => false);

    return { syncState, recordBtnVisible, errors };
  } finally {
    await browser.close();
  }
}

try {
  console.log('=== Supabase-connected, bucket MISSING (schema not run yet): record button hides ===');
  const missing = await runOnce(true);
  console.log(JSON.stringify(missing));
  if (!missing.syncState.includes('connected')) throw new Error(`Expected the fake Supabase connection to report connected, got: ${missing.syncState}`);
  if (missing.recordBtnVisible) throw new Error('Expected the record button to be hidden when the voice-recordings bucket is missing');
  if (missing.errors.length) throw new Error('Unexpected page errors: ' + JSON.stringify(missing.errors));
  console.log('Confirmed: record button hides when the bucket probe fails.');

  console.log('\n=== Supabase-connected, bucket EXISTS (schema already run): record button shows ===');
  const ready = await runOnce(false);
  console.log(JSON.stringify(ready));
  if (!ready.syncState.includes('connected')) throw new Error(`Expected the fake Supabase connection to report connected, got: ${ready.syncState}`);
  if (!ready.recordBtnVisible) throw new Error('Expected the record button to show once the voice-recordings bucket exists');
  if (ready.errors.length) throw new Error('Unexpected page errors: ' + JSON.stringify(ready.errors));
  console.log('Confirmed: record button shows once the bucket probe succeeds.');

  console.log('\nALL PASSED');
} catch (e) {
  console.error(e);
  process.exit(1);
}
