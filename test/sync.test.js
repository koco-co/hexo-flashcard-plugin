'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthController, createSyncController, mergeNewCardDays, mergeProgress } = require('../assets/flashcard-sync');

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

test('merges cards by latest review and unions daily completion history', () => {
  const merged = mergeProgress(
    {
      version: 3,
      cards: {
        shared: { last_review: 200, due: 500 },
        local: { last_review: 100, due: 300 }
      },
      days: {
        '2026-08-24': { cards: { shared: { due: 100, completedAt: null } } }
      }
    },
    {
      version: 3,
      cards: {
        shared: { last_review: 150, due: 400 },
        cloud: { last_review: 120, due: 350 }
      },
      days: {
        '2026-08-24': { cards: { shared: { due: 120, completedAt: 220 } } },
        '2026-08-25': { cards: { cloud: { due: 300, completedAt: null } } }
      }
    }
  );

  assert.equal(merged.cards.shared.due, 500);
  assert.equal(merged.cards.local.due, 300);
  assert.equal(merged.cards.cloud.due, 350);
  assert.deepEqual(merged.days['2026-08-24'].cards.shared, { due: 100, completedAt: 220 });
  assert.deepEqual(merged.days['2026-08-25'].cards.cloud, { due: 300, completedAt: null });
});

test('merges new-card starts by date and preserves the earliest start timestamp', () => {
  const merged = mergeNewCardDays(
    {
      '2026-08-27': { started: { high: 300, localOnly: 500 } }
    },
    {
      '2026-08-27': { started: { high: 200, cloudOnly: 400 } },
      '2026-08-28': { started: { nextDay: 600 } }
    }
  );

  assert.deepEqual(merged, {
    '2026-08-27': { started: { high: 200, localOnly: 500, cloudOnly: 400 } },
    '2026-08-28': { started: { nextDay: 600 } }
  });
});

test('a newer server reset discards stale local progress instead of resurrecting it', async (t) => {
  const originalSupabase = globalThis.supabase;
  t.after(() => { globalThis.supabase = originalSupabase; });

  const cloudProgress = { version: 3, cards: {}, days: {}, newCardDays: {} };
  globalThis.supabase = {
    createClient() {
      return {
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'reader' } } }, error: null }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
        },
        rpc: async () => ({ data: { progress: cloudProgress, resetVersion: 2 }, error: null })
      };
    }
  };

  let progress = {
    version: 3,
    cards: { stale: { last_review: 100, due: 200 } },
    days: {}
  };
  const controller = createSyncController({
    config: { enabled: true, url: 'https://example.supabase.co', publishableKey: 'publishable-test-key' },
    storage: memoryStorage(),
    getProgress: () => progress,
    applyProgress: (next) => { progress = next; }
  });
  t.after(() => controller.dispose());

  await controller.init();
  assert.deepEqual(progress, cloudProgress);
});

test('keeps local new-card starts when syncing with an older server response', async (t) => {
  const originalSupabase = globalThis.supabase;
  t.after(() => { globalThis.supabase = originalSupabase; });

  const localStarts = { '2026-08-27': { started: { local: 100 } } };
  let progress = { version: 3, cards: {}, days: {}, newCardDays: localStarts };
  globalThis.supabase = {
    createClient() {
      return {
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'reader' } } }, error: null }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
        },
        rpc: async () => ({ data: { progress: { version: 3, cards: {}, days: {} }, resetVersion: 0 }, error: null })
      };
    }
  };

  const controller = createSyncController({
    config: { enabled: true, url: 'https://legacy.example.supabase.co', publishableKey: 'publishable-test-key' },
    storage: memoryStorage(),
    getProgress: () => progress,
    applyProgress: (next) => { progress = next; }
  });
  t.after(() => controller.dispose());

  await controller.init();
  assert.deepEqual(progress.newCardDays, localStarts);
});

test('emits the signed-in GitHub avatar for presentation without trusting arbitrary metadata URLs', async (t) => {
  const originalSupabase = globalThis.supabase;
  t.after(() => { globalThis.supabase = originalSupabase; });

  const states = [];
  let currentSession = {
    user: {
      id: 'reader',
      user_metadata: { avatar_url: 'https://avatars.githubusercontent.com/u/123?v=4' }
    }
  };
  globalThis.supabase = {
    createClient() {
      return {
        auth: {
          getSession: async () => ({ data: { session: currentSession }, error: null }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
        },
        rpc: async () => ({ data: { progress: { version: 3, cards: {}, days: {} }, resetVersion: 0 }, error: null })
      };
    }
  };

  const controller = createSyncController({
    config: { enabled: true, url: 'https://example.supabase.co', publishableKey: 'publishable-test-key' },
    storage: memoryStorage(),
    getProgress: () => ({ version: 3, cards: {}, days: {} }),
    applyProgress: () => false,
    onState: (state) => states.push(state)
  });
  t.after(() => controller.dispose());

  await controller.init();
  assert.equal(states.at(-1).authenticated, true);
  assert.equal(states.at(-1).avatarUrl, 'https://avatars.githubusercontent.com/u/123?v=4');

  currentSession = {
    user: {
      id: 'reader',
      user_metadata: { avatar_url: 'https://tracker.example/avatar.png' }
    }
  };
  const rejectedStates = [];
  const rejectedController = createSyncController({
    config: { enabled: true, url: 'https://example.supabase.co', publishableKey: 'publishable-test-key' },
    storage: memoryStorage(),
    getProgress: () => ({ version: 3, cards: {}, days: {} }),
    applyProgress: () => false,
    onState: (state) => rejectedStates.push(state)
  });
  t.after(() => rejectedController.dispose());

  await rejectedController.init();
  assert.equal(rejectedStates.at(-1).avatarUrl, '');
});

test('reuses one Supabase client for the global auth observer and review sync controller', async (t) => {
  const originalSupabase = globalThis.supabase;
  t.after(() => { globalThis.supabase = originalSupabase; });

  let createCount = 0;
  const session = {
    user: {
      id: 'reader',
      user_metadata: { avatar_url: 'https://avatars.githubusercontent.com/u/123?v=4' }
    }
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    },
    rpc: async () => ({ data: { progress: { version: 3, cards: {}, days: {} }, resetVersion: 0 }, error: null })
  };
  globalThis.supabase = {
    createClient() {
      createCount += 1;
      return client;
    }
  };

  const authStates = [];
  const config = { enabled: true, url: 'https://shared.supabase.co', publishableKey: 'publishable-shared-key' };
  const authController = createAuthController({ config, onState: (state) => authStates.push(state) });
  const syncController = createSyncController({
    config,
    storage: memoryStorage(),
    getProgress: () => ({ version: 3, cards: {}, days: {} }),
    applyProgress: () => false
  });
  t.after(() => authController.dispose());
  t.after(() => syncController.dispose());

  await authController.init();
  await syncController.init();

  assert.equal(createCount, 1);
  assert.equal(authStates.at(-1).authenticated, true);
  assert.equal(authStates.at(-1).avatarUrl, 'https://avatars.githubusercontent.com/u/123?v=4');
});

test('waits for auth initialization and redirects to the returned GitHub OAuth URL', async (t) => {
  const originalSupabase = globalThis.supabase;
  const originalLocation = globalThis.location;
  const originalWindow = globalThis.window;
  t.after(() => {
    globalThis.supabase = originalSupabase;
    if (originalLocation === undefined) delete globalThis.location;
    else globalThis.location = originalLocation;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });

  const redirects = [];
  let resolveSession;
  const sessionReady = new Promise((resolve) => { resolveSession = resolve; });
  let oauthOptions = null;
  globalThis.location = { origin: 'http://127.0.0.1:4000', pathname: '/', search: '' };
  globalThis.window = { location: { assign: (url) => redirects.push(url) } };
  globalThis.supabase = {
    createClient() {
      return {
        auth: {
          getSession: () => sessionReady,
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signInWithOAuth: async (options) => {
            oauthOptions = options;
            return { data: { url: 'https://github.com/login/oauth/authorize?state=test' }, error: null };
          }
        }
      };
    }
  };

  const controller = createAuthController({
    config: { enabled: true, url: 'https://example.supabase.co', publishableKey: 'publishable-test-key' }
  });
  t.after(() => controller.dispose());

  const signIn = controller.signIn();
  resolveSession({ data: { session: null }, error: null });
  assert.equal(await signIn, true);
  assert.deepEqual(redirects, ['https://github.com/login/oauth/authorize?state=test']);
  assert.deepEqual(oauthOptions, {
    provider: 'github',
    options: {
      redirectTo: 'http://127.0.0.1:4000/',
      skipBrowserRedirect: true
    }
  });
});
