'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSyncController, mergeProgress } = require('../assets/flashcard-sync');

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

test('a newer server reset discards stale local progress instead of resurrecting it', async (t) => {
  const originalSupabase = globalThis.supabase;
  t.after(() => { globalThis.supabase = originalSupabase; });

  const cloudProgress = { version: 3, cards: {}, days: {} };
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
