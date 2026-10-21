export type ProjectReadNotice = { version: 1; nonce: string };
type Unsubscribe = () => void;
type NoticeListener = (notice: unknown, initial?: boolean) => void;

export interface ProjectReadSubscriptionOptions<T> {
  expectedUid: string;
  currentUid: () => string | null | undefined;
  read: (assertContext: () => void) => Promise<T>;
  onValue: (value: T) => void;
  onError: (error: Error) => void;
  subscribeNotices: (onNotice: NoticeListener, onError: (error: Error) => void) => Unsubscribe;
  subscribeIdentity: (onIdentityChange: () => void) => Unsubscribe;
  subscribeFocus: (onFocus: () => void) => Unsubscribe;
  subscribeVisibility: (onVisibilityChange: (visible: boolean) => void) => Unsubscribe;
  subscribeReconnect: (onReconnect: () => void) => Unsubscribe;
  setInterval: (callback: () => void, milliseconds: number) => unknown;
  clearInterval: (handle: unknown) => void;
  isVisible: () => boolean;
}

const BACKSTOP_MS = 60_000;

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function safePathSegment(value: unknown, maxLength: number): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) return false;
  if (new TextEncoder().encode(value).length > 1500) return false;
  return !/[\/\u0000-\u001f\u007f]/.test(value)
    && value !== '.' && value !== '..' && !/^__.*__$/.test(value);
}

function isValidNotice(value: unknown): value is ProjectReadNotice {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const record = value as Record<string, unknown>;
    const prototype = Object.getPrototypeOf(record);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(record);
    if (keys.length !== 2 || !keys.includes('version') || !keys.includes('nonce')) return false;
    const descriptors = Object.getOwnPropertyDescriptors(record);
    const version = descriptors.version;
    const nonce = descriptors.nonce;
    return !!version && !!nonce
      && version.enumerable && nonce.enumerable
      && Object.prototype.hasOwnProperty.call(version, 'value') && Object.prototype.hasOwnProperty.call(nonce, 'value')
      && version.value === 1
      && typeof nonce.value === 'string'
      && /^[A-Za-z0-9_-]{21}[AQgw]$/.test(nonce.value);
  } catch {
    return false;
  }
}

/** Pure subscription lifecycle coordinator. Adapters own only registration and transport. */
export function createProjectReadSubscription<T>(options: ProjectReadSubscriptionOptions<T>): Unsubscribe {
  let stopped = false;
  let identityInvalid = false;
  let generation = 0;
  let readSequence = 0;
  let inFlight = false;
  let dirty = false;
  const cleanup: Unsubscribe[] = [];

  const publishError = (error: unknown) => {
    if (!stopped) options.onError(asError(error));
  };
  const contextIsCurrent = () => !stopped && !identityInvalid && options.currentUid() === options.expectedUid;
  const assertContext = () => {
    if (!contextIsCurrent()) throw new Error('Project read context is no longer current');
  };

  const refresh = () => {
    if (stopped || identityInvalid || !options.isVisible()) return;
    if (!contextIsCurrent()) {
      identityInvalid = true;
      generation++;
      publishError(new Error('Signed-in account changed during project read'));
      return;
    }
    if (inFlight) {
      dirty = true;
      generation++;
      return;
    }
    inFlight = true;
    const requestGeneration = ++generation;
    const requestSequence = ++readSequence;
    const assertRequestContext = () => {
      assertContext();
      if (requestGeneration !== generation || requestSequence !== readSequence) {
        throw new Error('Project read request was superseded');
      }
    };
    void (async () => {
      try {
        assertRequestContext();
        const value = await options.read(assertRequestContext);
        assertRequestContext();
        if (!stopped && !identityInvalid && requestGeneration === generation && requestSequence === readSequence) {
          options.onValue(value);
        }
      } catch (error) {
        if (!stopped && !identityInvalid && requestGeneration === generation && requestSequence === readSequence) {
          publishError(error);
        }
      } finally {
        inFlight = false;
        if (!stopped && dirty) {
          dirty = false;
          refresh();
        }
      }
    })();
  };

  const noticeChanged: NoticeListener = (notice, initial = false) => {
    if (initial) return;
    if (!isValidNotice(notice)) return;
    refresh();
  };

  cleanup.push(options.subscribeNotices(noticeChanged, error => {
    // A denied signal listener must not block reads or the periodic revocation check.
    publishError(error);
    refresh();
  }));
  cleanup.push(options.subscribeIdentity(() => {
    generation++;
    dirty = false;
    if (options.currentUid() !== options.expectedUid) {
      identityInvalid = true;
      publishError(new Error('Signed-in account changed during project read'));
      return;
    }
    identityInvalid = false;
    refresh();
  }));
  cleanup.push(options.subscribeFocus(() => refresh()));
  cleanup.push(options.subscribeVisibility(visible => { if (visible) refresh(); }));
  cleanup.push(options.subscribeReconnect(() => refresh()));
  const timer = options.setInterval(() => refresh(), BACKSTOP_MS);
  cleanup.push(() => options.clearInterval(timer));
  refresh();

  return () => {
    if (stopped) return;
    stopped = true;
    generation++;
    dirty = false;
    for (const unsubscribe of cleanup.splice(0).reverse()) {
      try { unsubscribe(); } catch { /* Best-effort cleanup of independent registrations. */ }
    }
  };
}

export interface SubscribeProjectReadOptions<T> {
  projectId?: string;
  uid: string;
  isAdmin?: boolean;
  read: (assertContext: () => void) => Promise<T>;
  onValue: (value: T) => void;
  onError: (error: Error) => void;
}

/** Firebase/browser adapter. Firebase modules are imported only when a subscription starts. */
export function subscribeProjectRead<T>(options: SubscribeProjectReadOptions<T>): Unsubscribe {
  if (!safePathSegment(options.uid, 128) || options.projectId !== undefined && !safePathSegment(options.projectId, 512)) {
    options.onError(new Error('Invalid project read subscription context'));
    return () => {};
  }
  let stopped = false;
  const pendingCleanup: Unsubscribe[] = [];
  const register = (promise: Promise<Unsubscribe>, failureMessage: string, onFailure?: (error: Error) => void) => {
    void promise.then(unsubscribe => {
      if (stopped) unsubscribe();
      else pendingCleanup.push(unsubscribe);
    }).catch(() => {
      if (!stopped) {
        const error = new Error(failureMessage);
        onFailure?.(error);
        options.onError(error);
      }
    });
  };

  const subscribeNotices: ProjectReadSubscriptionOptions<T>['subscribeNotices'] = (onNotice, onError) => {
    let active = true;
    register((async () => {
      const [{ db }, firestore] = await Promise.all([import('@/firebase'), import('firebase/firestore')]);
      if (!active || stopped) return () => {};
      const paths = options.projectId
        ? [`pulseReadSignals/${options.projectId}`, `pulseUserReadSignals/${options.uid}`]
        : [`pulseUserReadSignals/${options.uid}`, ...(options.isAdmin ? ['pulseReadCatalog/admin'] : [])];
      const unsubs: Unsubscribe[] = [];
      try {
        for (const path of paths) {
          let first = true;
          const ref = firestore.doc(db, path);
          unsubs.push(firestore.onSnapshot(ref, snapshot => {
            const initial = first;
            first = false;
            onNotice(snapshot.exists() ? snapshot.data() : undefined, initial);
          }, () => onError(new Error('Project read notice listener unavailable'))));
        }
      } catch (error) {
        unsubs.forEach(unsubscribe => unsubscribe());
        throw error;
      }
      return () => { active = false; unsubs.forEach(unsubscribe => unsubscribe()); };
    })(), 'Project read notice listener unavailable');
    return () => { active = false; };
  };

  const listenWindow = (event: string, callback: () => void): Unsubscribe => {
    if (typeof window === 'undefined') return () => {};
    window.addEventListener(event, callback);
    return () => window.removeEventListener(event, callback);
  };
  let observedUid: string | null | undefined = options.uid;
  let resolveIdentityReady!: () => void;
  const identityReady = new Promise<void>(resolve => { resolveIdentityReady = resolve; });
  let identityReadyError: Error | undefined;
  let identityInitialized = false;
  const unsubscribe = createProjectReadSubscription({
    expectedUid: options.uid,
    currentUid: () => {
      // Avoid loading Firebase synchronously; auth-change events invalidate the generation,
      // and the async identity registration below reports the current UID on each event.
      return observedUid;
    },
    read: async assertContext => {
      await identityReady;
      if (identityReadyError) throw identityReadyError;
      assertContext();
      return options.read(assertContext);
    },
    onValue: options.onValue,
    onError: options.onError,
    subscribeNotices,
    subscribeIdentity: callback => {
      register((async () => {
        const [{ auth }, authModule] = await Promise.all([import('@/firebase'), import('firebase/auth')]);
        if (!activeIdentity || stopped) return () => {};
        observedUid = auth.currentUser?.uid ?? observedUid;
        return authModule.onIdTokenChanged(auth, user => {
          observedUid = user?.uid;
          if (!identityInitialized) {
            identityInitialized = true;
            resolveIdentityReady();
            if (observedUid !== options.uid) callback();
            return;
          }
          callback();
        }, () => {
          const error = new Error('Project read identity listener unavailable');
          identityReadyError = error;
          resolveIdentityReady();
          if (!stopped) options.onError(error);
        });
      })().catch(() => {
        identityReadyError = new Error('Project read identity listener unavailable');
        resolveIdentityReady();
        throw identityReadyError;
      }), 'Project read identity listener unavailable', error => {
        identityReadyError = error;
        resolveIdentityReady();
      });
      let activeIdentity = true;
      return () => { activeIdentity = false; };
    },
    subscribeFocus: callback => listenWindow('focus', callback),
    subscribeVisibility: callback => {
      if (typeof document === 'undefined') return () => {};
      const listener = () => callback(document.visibilityState === 'visible');
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
    subscribeReconnect: callback => listenWindow('online', callback),
    setInterval: (callback, milliseconds) => globalThis.setInterval(callback, milliseconds),
    clearInterval: handle => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
    isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
  });
  return () => {
    stopped = true;
    resolveIdentityReady();
    unsubscribe();
    pendingCleanup.splice(0).forEach(clean => clean());
  };
}
