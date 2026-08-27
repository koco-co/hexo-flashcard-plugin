(function exposeFlashcardSync(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HFC_SYNC = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createFlashcardSyncApi() {
  'use strict';

  const SYNC_STORAGE_KEY = 'hexo-flashcard-plugin:sync:v1';
  let sharedClient = null;
  let sharedClientFactory = null;
  let sharedClientSignature = '';

  function emptyProgress() {
    return { version: 3, cards: {}, days: {}, newCardDays: {} };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function finiteNumber(value) {
    return Number.isFinite(value) ? value : null;
  }

  const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function validCardId(value) {
    return typeof value === 'string' && value.length >= 1 && value.length <= 255;
  }

  function normalizeNewCardDays(value) {
    const normalized = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return normalized;

    Object.entries(value).forEach(([key, day]) => {
      if (!DATE_KEY_PATTERN.test(key) || !day || typeof day !== 'object' || Array.isArray(day)) return;
      const source = day.started;
      if (!source || typeof source !== 'object' || Array.isArray(source)) return;
      const started = {};
      Object.entries(source).forEach(([cardId, timestamp]) => {
        const valueMs = finiteNumber(timestamp);
        if (validCardId(cardId) && valueMs !== null && valueMs >= 0) started[cardId] = valueMs;
      });
      if (Object.keys(started).length) normalized[key] = { started };
    });
    return normalized;
  }

  function normalizeProgress(value) {
    if (!value || typeof value !== 'object') return emptyProgress();
    return {
      version: 3,
      cards: value.cards && typeof value.cards === 'object' ? value.cards : {},
      days: value.days && typeof value.days === 'object' ? value.days : {},
      newCardDays: normalizeNewCardDays(value.newCardDays)
    };
  }

  function mergeNewCardDays(localValue, cloudValue) {
    const local = normalizeNewCardDays(localValue);
    const cloud = normalizeNewCardDays(cloudValue);
    const merged = {};
    const dateKeys = new Set([...Object.keys(local), ...Object.keys(cloud)]);

    dateKeys.forEach((key) => {
      const localStarted = local[key]?.started || {};
      const cloudStarted = cloud[key]?.started || {};
      const started = {};
      const cardIds = new Set([...Object.keys(localStarted), ...Object.keys(cloudStarted)]);
      cardIds.forEach((cardId) => {
        const values = [finiteNumber(localStarted[cardId]), finiteNumber(cloudStarted[cardId])].filter((value) => value !== null);
        if (values.length) started[cardId] = Math.min(...values);
      });
      if (Object.keys(started).length) merged[key] = { started };
    });

    return merged;
  }

  function githubAvatarUrl(currentSession) {
    const user = currentSession?.user;
    const metadata = user?.user_metadata || {};
    const identity = user?.identities?.find((item) => item?.provider === 'github');
    const identityData = identity?.identity_data || {};
    const candidate = metadata.avatar_url || metadata.picture || identityData.avatar_url || identityData.picture;
    if (typeof candidate !== 'string' || !candidate.trim()) return '';

    try {
      const url = new URL(candidate);
      return url.protocol === 'https:' && url.hostname === 'avatars.githubusercontent.com' ? url.href : '';
    } catch (error) {
      return '';
    }
  }

  function clientFor(config) {
    const factory = globalThis.supabase?.createClient;
    if (!factory || !config?.url || !config?.publishableKey) return null;
    const signature = `${config.url}\u0000${config.publishableKey}`;
    if (!sharedClient || sharedClientFactory !== factory || sharedClientSignature !== signature) {
      sharedClient = factory(config.url, config.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
      sharedClientFactory = factory;
      sharedClientSignature = signature;
    }
    return sharedClient;
  }

  function redirectToCurrentPage() {
    return `${location.origin}${location.pathname}${location.search}`;
  }

  async function startOAuth(client) {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: redirectToCurrentPage(),
        skipBrowserRedirect: true
      }
    });
    if (error || !data?.url) return false;
    if (typeof window !== 'undefined' && window.location?.assign) window.location.assign(data.url);
    else if (typeof location !== 'undefined') location.href = data.url;
    return true;
  }

  function reviewTime(card) {
    return finiteNumber(card?.last_review) ?? 0;
  }

  function mergeProgress(localValue, cloudValue) {
    const local = normalizeProgress(localValue);
    const cloud = normalizeProgress(cloudValue);
    const merged = emptyProgress();
    const cardIds = new Set([...Object.keys(cloud.cards), ...Object.keys(local.cards)]);

    cardIds.forEach((cardId) => {
      const localCard = local.cards[cardId];
      const cloudCard = cloud.cards[cardId];
      if (!localCard) merged.cards[cardId] = clone(cloudCard);
      else if (!cloudCard) merged.cards[cardId] = clone(localCard);
      else merged.cards[cardId] = clone(reviewTime(localCard) >= reviewTime(cloudCard) ? localCard : cloudCard);
    });

    const dateKeys = new Set([...Object.keys(cloud.days), ...Object.keys(local.days)]);
    dateKeys.forEach((dateKey) => {
      const localTasks = local.days[dateKey]?.cards || {};
      const cloudTasks = cloud.days[dateKey]?.cards || {};
      const taskIds = new Set([...Object.keys(cloudTasks), ...Object.keys(localTasks)]);
      const cards = {};

      taskIds.forEach((cardId) => {
        const localTask = localTasks[cardId];
        const cloudTask = cloudTasks[cardId];
        if (!localTask) cards[cardId] = clone(cloudTask);
        else if (!cloudTask) cards[cardId] = clone(localTask);
        else {
          const dueValues = [finiteNumber(localTask.due), finiteNumber(cloudTask.due)].filter((value) => value !== null);
          const completedValues = [finiteNumber(localTask.completedAt), finiteNumber(cloudTask.completedAt)].filter((value) => value !== null);
          cards[cardId] = {
            due: dueValues.length ? Math.min(...dueValues) : null,
            completedAt: completedValues.length ? Math.max(...completedValues) : null
          };
        }
      });

      if (Object.keys(cards).length) merged.days[dateKey] = { cards };
    });

    merged.newCardDays = mergeNewCardDays(local.newCardDays, cloud.newCardDays);

    return merged;
  }

  function loadMeta(storage) {
    try {
      const value = JSON.parse(storage.getItem(SYNC_STORAGE_KEY) || '{}');
      return {
        version: 1,
        resetVersion: Number.isInteger(value.resetVersion) && value.resetVersion >= 0 ? value.resetVersion : 0,
        dirty: value.dirty === true,
        lastSyncedAt: Number.isFinite(value.lastSyncedAt) ? value.lastSyncedAt : null
      };
    } catch (error) {
      return { version: 1, resetVersion: 0, dirty: false, lastSyncedAt: null };
    }
  }

  function createSyncController(options) {
    const config = options.config || {};
    const storage = options.storage || globalThis.localStorage;
    const getProgress = options.getProgress;
    const applyProgress = options.applyProgress;
    const onState = options.onState || (() => {});
    let meta = loadMeta(storage);
    let client = null;
    let session = null;
    let inFlight = null;
    let timer = null;
    let mutationVersion = 0;
    let disposed = false;
    let authSubscription = null;
    let initPromise = null;

    function saveMeta() {
      try {
        storage.setItem(SYNC_STORAGE_KEY, JSON.stringify(meta));
      } catch (error) {
        // Local progress remains authoritative even when sync metadata cannot be stored.
      }
    }

    function emit(status, detail) {
      if (disposed) return;
      onState({
        status,
        detail: detail || '',
        authenticated: Boolean(session),
        lastSyncedAt: meta.lastSyncedAt,
        avatarUrl: githubAvatarUrl(session)
      });
    }

    function schedule(delay = 350) {
      if (!session || disposed) return;
      clearTimeout(timer);
      timer = setTimeout(() => syncNow(), delay);
    }

    function markDirty() {
      mutationVersion += 1;
      meta.dirty = true;
      saveMeta();
      schedule();
    }

    async function syncNow() {
      if (!client || !session || disposed) return false;
      if (inFlight) {
        meta.dirty = true;
        saveMeta();
        return inFlight;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        emit('offline');
        return false;
      }

      const requestMutationVersion = mutationVersion;
      const requestResetVersion = meta.resetVersion;
      const snapshot = clone(normalizeProgress(getProgress()));
      emit('syncing');

      inFlight = client.rpc('sync_flashcard_progress', {
        p_progress: snapshot,
        p_reset_version: requestResetVersion
      }).then(({ data, error }) => {
        if (error) throw error;
        const serverResetVersion = Number(data?.resetVersion);
        if (!Number.isInteger(serverResetVersion) || serverResetVersion < 0 || !data?.progress) {
          throw new Error('Invalid cloud sync response');
        }

        const resetAdvanced = serverResetVersion > requestResetVersion;
        const serverProgress = normalizeProgress(data.progress);
        const serverSupportsNewCardDays = Object.prototype.hasOwnProperty.call(data.progress, 'newCardDays');
        const nextProgress = resetAdvanced
          ? serverProgress
          : mergeProgress(getProgress(), serverProgress);
        if (!resetAdvanced && serverSupportsNewCardDays) nextProgress.newCardDays = serverProgress.newCardDays;
        meta.resetVersion = serverResetVersion;
        const derivedChange = applyProgress(nextProgress) === true;
        if (derivedChange) mutationVersion += 1;
        meta.dirty = mutationVersion !== requestMutationVersion || derivedChange;
        meta.lastSyncedAt = Date.now();
        saveMeta();
        emit('synced');
        if (meta.dirty) schedule(0);
        return true;
      }).catch(() => {
        meta.dirty = true;
        saveMeta();
        emit(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error');
        return false;
      }).finally(() => {
        inFlight = null;
      });

      return inFlight;
    }

    async function signIn() {
      if (!client) await init();
      if (!client) return false;
      emit('authorizing');
      if (!await startOAuth(client)) {
        emit('error');
        return false;
      }
      return true;
    }

    async function signOut() {
      if (!client) return false;
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) {
        emit('error');
        return false;
      }
      session = null;
      emit('local');
      return true;
    }

    async function resetEverywhere() {
      if (!client || !session || inFlight) return false;
      emit('resetting');
      const { data, error } = await client.rpc('reset_flashcard_progress');
      if (error || !data?.progress || !Number.isInteger(Number(data.resetVersion))) {
        emit('error');
        return false;
      }
      mutationVersion += 1;
      meta.resetVersion = Number(data.resetVersion);
      meta.dirty = false;
      meta.lastSyncedAt = Date.now();
      saveMeta();
      applyProgress(normalizeProgress(data.progress));
      emit('synced');
      return true;
    }

    function resetLocalMetadata() {
      mutationVersion += 1;
      meta.dirty = false;
      saveMeta();
    }

    async function init() {
      if (initPromise) return initPromise;
      initPromise = (async () => {
        if (!config.enabled) {
          emit('disabled');
          return;
        }
        client = clientFor(config);
        if (!client) {
          emit('unavailable');
          return;
        }

        const listener = client.auth.onAuthStateChange((_event, nextSession) => {
          session = nextSession;
          emit(session ? 'ready' : 'local');
          if (session) setTimeout(() => syncNow(), 0);
        });
        authSubscription = listener.data.subscription;

        const { data, error } = await client.auth.getSession();
        if (error) {
          emit('error');
          return;
        }
        session = data.session;
        emit(session ? 'ready' : 'local');
        if (session) await syncNow();
      })();
      return initPromise;
    }

    function handleOnline() {
      if (meta.dirty || session) schedule(0);
    }

    function dispose() {
      disposed = true;
      clearTimeout(timer);
      authSubscription?.unsubscribe();
      if (typeof window !== 'undefined') window.removeEventListener('online', handleOnline);
    }

    if (typeof window !== 'undefined') window.addEventListener('online', handleOnline);

    return {
      init,
      dispose,
      isAuthenticated: () => Boolean(session),
      markDirty,
      resetEverywhere,
      resetLocalMetadata,
      signIn,
      signOut,
      syncNow
    };
  }

  function createAuthController(options) {
    const config = options.config || {};
    const onState = options.onState || (() => {});
    let client = null;
    let session = null;
    let disposed = false;
    let authSubscription = null;
    let initPromise = null;

    function emit(status, detail) {
      if (disposed) return;
      onState({
        status,
        detail: detail || '',
        authenticated: Boolean(session),
        avatarUrl: githubAvatarUrl(session)
      });
    }

    async function signIn() {
      if (!client) await init();
      if (!client) return false;
      emit('authorizing');
      if (!await startOAuth(client)) {
        emit('error');
        return false;
      }
      return true;
    }

    async function signOut() {
      if (!client) return false;
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) {
        emit('error');
        return false;
      }
      session = null;
      emit('local');
      return true;
    }

    async function init() {
      if (initPromise) return initPromise;
      initPromise = (async () => {
        if (!config.enabled) {
          emit('disabled');
          return;
        }
        client = clientFor(config);
        if (!client) {
          emit('unavailable');
          return;
        }

        const listener = client.auth.onAuthStateChange((_event, nextSession) => {
          session = nextSession;
          emit(session ? 'ready' : 'local');
        });
        authSubscription = listener.data.subscription;

        const { data, error } = await client.auth.getSession();
        if (error) {
          emit('error');
          return;
        }
        session = data.session;
        emit(session ? 'ready' : 'local');
      })();
      return initPromise;
    }

    function dispose() {
      disposed = true;
      authSubscription?.unsubscribe();
    }

    return {
      init,
      dispose,
      isAuthenticated: () => Boolean(session),
      signIn,
      signOut
    };
  }

  return {
    SYNC_STORAGE_KEY,
    createAuthController,
    createSyncController,
    emptyProgress,
    mergeNewCardDays,
    mergeProgress,
    normalizeNewCardDays,
    normalizeProgress
  };
});
