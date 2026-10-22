import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectReadSubscription, subscribeProjectRead } from '../projectReadSubscriptions';
import { doc, onSnapshot } from 'firebase/firestore';
import { onIdTokenChanged } from 'firebase/auth';

vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }));
vi.mock('firebase/analytics', () => ({ getAnalytics: () => ({}) }));
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}), connectFunctionsEmulator: vi.fn() }));
vi.mock('firebase/storage', () => ({ getStorage: () => ({}), connectStorageEmulator: vi.fn() }));
vi.mock('firebase/firestore', () => ({ initializeFirestore: () => ({}), connectFirestoreEmulator: vi.fn(), doc: vi.fn((_db, path) => ({ path })), onSnapshot: vi.fn(() => vi.fn()) }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'u1' } }), GoogleAuthProvider: class { setCustomParameters() {} }, onIdTokenChanged: vi.fn((_auth, callback) => { callback({ uid: 'u1' }); return () => {}; }) }));

const VALID_NONCE = 'AAAAAAAAAAAAAAAAAAAAAA';
type Notice = { version: number; nonce: string } | unknown;
function setup(read: (assertContext: () => void) => Promise<string> = async () => 'fresh') {
  let notice: ((value: Notice, initial?: boolean) => void) | undefined;
  let noticeError: ((error: Error) => void) | undefined;
  let identity: (() => void) | undefined;
  let focus: (() => void) | undefined;
  let reconnect: (() => void) | undefined;
  let visibility: ((visible: boolean) => void) | undefined;
  let visible = true;
  const values: string[] = [];
  const errors: Error[] = [];
  const unsubs = vi.fn();
  let intervalMs = 0;
  const sub = createProjectReadSubscription<string>({
    expectedUid: 'u1', currentUid: () => 'u1', read,
    onValue: value => values.push(value), onError: error => errors.push(error),
    subscribeNotices: (onNotice, onError) => { notice = onNotice; noticeError = onError; return unsubs; },
    subscribeIdentity: callback => { identity = callback; return () => {}; },
    subscribeFocus: callback => { focus = callback; return () => {}; },
    subscribeVisibility: callback => { visibility = callback; return () => {}; },
    subscribeReconnect: callback => { reconnect = callback; return () => {}; },
    setInterval: (callback, milliseconds) => { (setup as any).interval = callback; intervalMs = milliseconds; return 1; },
    clearInterval: () => {}, isVisible: () => visible,
  });
  return { sub, values, errors, fireNotice: (value: Notice, initial = false) => notice?.(value, initial), fireNoticeError: (e: Error) => noticeError?.(e), fireIdentity: () => identity?.(), fireFocus: () => focus?.(), fireReconnect: () => reconnect?.(), fireVisibility: (value: boolean) => { visible = value; visibility?.(value); }, fireBackstop: () => (setup as any).interval?.(), intervalMs: () => intervalMs, unsubs };
}

afterEach(() => vi.useRealTimers());

describe('project read subscription coordinator', () => {
  it('starts with one authorized read and coalesces a notice burst', async () => {
    const read = vi.fn(async () => 'fresh');
    const h = setup(read);
    await vi.waitFor(() => expect(h.values).toEqual(['fresh']));
    h.fireNotice({ version: 1, nonce: VALID_NONCE });
    h.fireNotice({ version: 1, nonce: VALID_NONCE });
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(h.values).toEqual(['fresh', 'fresh']));
    h.sub();
  });

  it('ignores missing, malformed, and initial notice snapshots', async () => {
    const read = vi.fn(async () => 'fresh');
    const h = setup(read);
    await vi.waitFor(() => expect(h.values.length).toBe(1));
    h.fireNotice(undefined, true);
    h.fireNotice({ version: 2, nonce: VALID_NONCE });
    h.fireNotice({ version: 1, nonce: '' });
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    h.sub();
  });

  it('reports authorized read failures and retries on a later notice', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce('recovered');
    const h = setup(read);
    await vi.waitFor(() => expect(h.errors).toHaveLength(1));
    h.fireNotice({ version: 1, nonce: VALID_NONCE });
    await vi.waitFor(() => expect(h.values).toEqual(['recovered']));
    h.sub();
  });

  it('does not overlap reads and runs one dirty refresh after the current read', async () => {
    let finish!: (value: string) => void;
    const read = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const h = setup(read);
    await Promise.resolve();
    h.fireNotice({ version: 1, nonce: VALID_NONCE });
    h.fireNotice({ version: 1, nonce: VALID_NONCE });
    expect(read).toHaveBeenCalledTimes(1);
    finish('stale');
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    finish('fresh');
    await vi.waitFor(() => expect(h.values).toEqual(['fresh']));
    h.sub();
  });

  it('binds each read guard to its request generation and sequence', async () => {
    let continueFirst!: () => void;
    let startedFirst!: () => void;
    const firstStarted = new Promise<void>(resolve => { startedFirst = resolve; });
    const calls: string[] = [];
    const read = vi.fn(async (assertContext: () => void) => {
      const attempt = read.mock.calls.length;
      assertContext();
      calls.push(`page-${attempt}-first`);
      if (attempt === 1) {
        startedFirst();
        await new Promise<void>(resolve => { continueFirst = resolve; });
        assertContext();
        calls.push('page-1-second');
        return 'old';
      }
      return 'fresh';
    });
    const h = setup(read);
    await firstStarted;
    const oldGuard = read.mock.calls[0][0];
    h.fireNotice({ version: 1, nonce: VALID_NONCE });
    expect(oldGuard).toThrow();
    continueFirst();
    await vi.waitFor(() => expect(h.values).toEqual(['fresh']));
    expect(calls).not.toContain('page-1-second');
    expect(h.values).toHaveLength(1);
    h.sub();
  });

  it('does not publish a response invalidated during the request', async () => {
    let finish!: (value: string) => void;
    const read = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const h = setup(read);
    await Promise.resolve();
    h.fireIdentity();
    finish('obsolete');
    await Promise.resolve();
    expect(h.values).toEqual([]);
    h.sub();
  });

  it('reports identity mismatch promptly and never publishes old-identity results', async () => {
    let uid = 'u1';
    let finish!: (value: string) => void;
    const values: string[] = [];
    const errors: Error[] = [];
    let identityChange: (() => void) | undefined;
    const sub = createProjectReadSubscription({
      expectedUid: 'u1', currentUid: () => uid, read: () => new Promise<string>(resolve => { finish = resolve; }),
      onValue: value => values.push(value), onError: error => errors.push(error),
      subscribeNotices: () => () => {}, subscribeIdentity: callback => { identityChange = callback; return () => {}; }, subscribeFocus: () => () => {},
      subscribeVisibility: () => () => {}, subscribeReconnect: () => () => {}, setInterval: () => 1,
      clearInterval: () => {}, isVisible: () => true,
    });
    await Promise.resolve();
    uid = 'u2';
    identityChange?.();
    expect(errors).toHaveLength(1);
    finish('old');
    await Promise.resolve();
    expect(values).toEqual([]);
    sub();
  });

  it('drops an old A subscription across an A-to-B-to-A context switch', async () => {
    let finishOld!: (value: string) => void;
    const old = setup(() => new Promise<string>(resolve => { finishOld = resolve; }));
    const middle = setup();
    const latest = setup(async () => 'new A');
    await vi.waitFor(() => expect(middle.values).toEqual(['fresh']));
    await vi.waitFor(() => expect(latest.values).toEqual(['new A']));
    old.sub();
    finishOld('old A');
    await Promise.resolve();
    expect(old.values).toEqual([]);
    old.fireNotice({ version: 1, nonce: VALID_NONCE });
    expect(old.values).toEqual([]);
    middle.sub();
    latest.sub();
  });

  it('uses a visible-only 60 second backstop and refreshes on focus and reconnect', async () => {
    const read = vi.fn(async () => 'fresh');
    const h = setup(read);
    await vi.waitFor(() => expect(h.values.length).toBe(1));
    expect(h.intervalMs()).toBe(60_000);
    h.fireVisibility(false);
    h.fireBackstop();
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    h.fireFocus();
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    h.fireVisibility(true);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    h.fireBackstop();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    h.fireFocus();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(4));
    h.fireReconnect();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(5));
    h.sub();
  });

  it('keeps a denied notice listener from blocking authorized read attempts', async () => {
    const read = vi.fn(async () => 'fresh');
    const h = setup(read);
    await vi.waitFor(() => expect(h.values.length).toBe(1));
    h.fireNoticeError(new Error('notice denied'));
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(h.errors).toHaveLength(1);
    h.sub();
  });

  it('tears down every registration and blocks callbacks after unsubscribe', async () => {
    const h = setup();
    await vi.waitFor(() => expect(h.values.length).toBe(1));
    h.sub();
    h.fireNotice({ version: 1, nonce: VALID_NONCE });
    expect(h.unsubs).toHaveBeenCalledTimes(1);
    expect(h.values).toEqual(['fresh']);
  });

  it('rejects malformed notice objects and nonce encodings without invoking accessors', async () => {
    const read = vi.fn(async () => 'fresh');
    const h = setup(read);
    await vi.waitFor(() => expect(h.values.length).toBe(1));
    const getter = vi.fn(() => VALID_NONCE);
    const accessor = { version: 1, get nonce() { return getter(); } };
    const symbolKey = Symbol('extra');
    const symbolNotice = { version: 1, nonce: VALID_NONCE, [symbolKey]: true };
    const inherited = Object.assign(Object.create({ extra: true }), { version: 1, nonce: VALID_NONCE });
    const invalid = [
      { version: 1, nonce: 'short' },
      { version: 1, nonce: 'A'.repeat(23) },
      { version: 1, nonce: 'A'.repeat(21) + '/' },
      { version: 1, nonce: 'A'.repeat(21) + 'B' },
      { version: 1, nonce: 'A'.repeat(21) + ' ' },
      { version: 1, nonce: VALID_NONCE, extra: true }, symbolNotice, inherited, accessor,
    ];
    invalid.forEach(notice => h.fireNotice(notice));
    await Promise.resolve();
    expect(getter).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
    h.sub();
  });

  it('rejects unsafe path IDs before Firebase registration and sanitizes SDK listener errors', async () => {
    vi.mocked(doc).mockClear();
    const invalidErrors: Error[] = [];
    const invalidStop = subscribeProjectRead({
      projectId: '../private', uid: 'u1', read: async () => 'unused', onValue: () => {}, onError: e => invalidErrors.push(e),
    });
    invalidStop();
    expect(doc).not.toHaveBeenCalled();
    expect(invalidErrors).toHaveLength(1);
    expect(invalidErrors[0].message).not.toContain('private');
    for (const invalidOptions of [
      { uid: 'u'.repeat(129) },
      { uid: 'u1', projectId: 'p'.repeat(513) },
      { uid: 'u1', projectId: '__reserved__' },
    ]) {
      const errors: Error[] = [];
      subscribeProjectRead({ ...invalidOptions, read: async () => 'unused', onValue: () => {}, onError: error => errors.push(error) });
      expect(errors).toHaveLength(1);
    }
    expect(doc).not.toHaveBeenCalled();

    const onSnapshotMock = vi.mocked(onSnapshot);
    onSnapshotMock.mockImplementation(((...args: unknown[]) => {
      const fail = args[2] as ((error: Error) => void) | undefined;
      fail?.(new Error('sensitive SDK details'));
      return vi.fn();
    }) as unknown as typeof onSnapshot);
    const sdkErrors: Error[] = [];
    const stop = subscribeProjectRead({
      projectId: 'valid-project', uid: 'u1', read: async () => 'fresh', onValue: () => {}, onError: e => sdkErrors.push(e),
    });
    await vi.waitFor(() => expect(sdkErrors.length).toBeGreaterThan(0));
    expect(sdkErrors.every(error => !error.message.includes('sensitive SDK details'))).toBe(true);
    stop();
    onSnapshotMock.mockImplementation(() => { throw new Error('sensitive SDK registration details'); });
    const registrationErrors: Error[] = [];
    const stopFailedRegistration = subscribeProjectRead({
      projectId: 'valid-project', uid: 'u1', read: async () => 'fresh', onValue: () => {}, onError: error => registrationErrors.push(error),
    });
    await vi.waitFor(() => expect(registrationErrors.length).toBeGreaterThan(0));
    expect(registrationErrors.every(error => !error.message.includes('sensitive SDK registration details'))).toBe(true);
    stopFailedRegistration();

    vi.mocked(onIdTokenChanged).mockImplementation(((...args: unknown[]) => {
      const fail = args[2] as ((error: Error) => void) | undefined;
      fail?.(new Error('sensitive auth SDK details'));
      return vi.fn();
    }) as unknown as typeof onIdTokenChanged);
    const authErrors: Error[] = [];
    const stopFailedAuth = subscribeProjectRead({
      projectId: 'valid-project', uid: 'u1', read: async () => 'fresh', onValue: () => {}, onError: error => authErrors.push(error),
    });
    await vi.waitFor(() => expect(authErrors.length).toBeGreaterThan(0));
    expect(authErrors.every(error => !error.message.includes('sensitive auth SDK details'))).toBe(true);
    stopFailedAuth();
    vi.mocked(onIdTokenChanged).mockImplementation(((...args: unknown[]) => {
      const callback = args[1] as (user: { uid: string } | null) => void;
      callback({ uid: 'u1' });
      return () => {};
    }) as unknown as typeof onIdTokenChanged);
    onSnapshotMock.mockReset();
    onSnapshotMock.mockImplementation(() => vi.fn());
  });

  it('does not call read when initial auth never resolves and unsubscribe happens first', async () => {
    vi.mocked(onIdTokenChanged).mockImplementation(() => vi.fn());
    const read = vi.fn(async () => 'must-not-read');
    const values: string[] = [];
    const stop = subscribeProjectRead({ uid: 'u1', read, onValue: value => values.push(value), onError: () => {} });
    stop();
    await Promise.resolve();
    await Promise.resolve();
    expect(read).not.toHaveBeenCalled();
    expect(values).toEqual([]);
    vi.mocked(onIdTokenChanged).mockImplementation(((...args: unknown[]) => {
      const callback = args[1] as (user: { uid: string } | null) => void;
      callback({ uid: 'u1' });
      return () => {};
    }) as unknown as typeof onIdTokenChanged);
  });

  it('subscribes to the catalog notice only for an admin catalog read', async () => {
    vi.mocked(doc).mockClear();
    const stop = subscribeProjectRead({
      uid: 'u1', isAdmin: true, read: async () => 'catalog', onValue: () => {}, onError: () => {},
    });
    await vi.waitFor(() => expect(vi.mocked(doc)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(doc).mock.calls.map(call => call[1])).toEqual([
      'pulseUserReadSignals/u1', 'pulseReadCatalog/admin',
    ]);
    stop();
  });

  it('registers only the known project notice and own user notice in the Firebase adapter', async () => {
    vi.mocked(doc).mockClear();
    const onSnapshotMock = vi.mocked(onSnapshot);
    onSnapshotMock.mockClear();
    vi.mocked(onIdTokenChanged).mockClear();
    const received: string[] = [];
    const adapterErrors: Error[] = [];
    const unsubscribe = subscribeProjectRead({
      projectId: 'p1', uid: 'u1', read: async () => 'server', onValue: value => received.push(value), onError: error => adapterErrors.push(error),
    });
    await vi.waitFor(() => expect(received).toEqual(['server']));
    expect(adapterErrors).toEqual([]);
    expect(vi.mocked(doc).mock.calls.map(call => call[1])).toEqual([
      'pulseReadSignals/p1', 'pulseUserReadSignals/u1',
    ]);
    expect(onSnapshotMock).toHaveBeenCalledTimes(2);
    const listenerUnsubs = onSnapshotMock.mock.results.map(result => result.value);
    unsubscribe();
    expect(listenerUnsubs.every(stop => stop.mock.calls.length === 1)).toBe(true);
  });
  it('does not register late lazy imports after unsubscribe', async () => {
    let releaseImports!: () => void;
    const importsBlocked = new Promise<void>(resolve => { releaseImports = resolve; });
    vi.resetModules();
    const lateDoc = vi.fn((_db: unknown, path: string) => ({ path }));
    const lateSnapshot = vi.fn(() => vi.fn());
    const lateAuthListener = vi.fn((_auth: unknown, callback: (user: { uid: string }) => void) => { callback({ uid: 'u1' }); return vi.fn(); });
    vi.doMock('@/firebase', async () => {
      await importsBlocked;
      return { db: {}, auth: { currentUser: { uid: 'u1' } } };
    });
    vi.doMock('firebase/firestore', () => ({ doc: lateDoc, onSnapshot: lateSnapshot }));
    vi.doMock('firebase/auth', () => ({ onIdTokenChanged: lateAuthListener }));
    const adapter = await import('../projectReadSubscriptions');
    const read = vi.fn(async () => 'too-late');
    const values: string[] = [];
    const errors: Error[] = [];
    const stop = adapter.subscribeProjectRead({ uid: 'u1', projectId: 'p1', read, onValue: value => values.push(value), onError: error => errors.push(error) });
    stop();
    releaseImports();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(read).not.toHaveBeenCalled();
    expect(values).toEqual([]);
    expect(errors).toEqual([]);
    expect(lateDoc).not.toHaveBeenCalled();
    expect(lateAuthListener).not.toHaveBeenCalled();
    vi.doUnmock('@/firebase');
    vi.doUnmock('firebase/firestore');
    vi.doUnmock('firebase/auth');
    vi.resetModules();
  });

});
