import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { createNativeSupportProfileClient, createNativeSupportProfileDiff, createNativeSupportProfileWorkspace } from '../nativeSupportProfile';
const { fixture } = createRequire(import.meta.url)('../../../functions/nativeProjectFixture.cjs');
const storage = () => { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; };

it('actual Support client and backend preserve hidden profile fields through lost-reply recovery after reload', async () => {
  const server = fixture({ uid: 'partner', supportProfileEnabled: true }); let drop = true;
  server.docs.get('projects/P').supportProfile = { internalNotes: 'Old', unknown: { keep: true }, supportContacts: [{ name: 'Old' }], machines: [] };
  const client = createNativeSupportProfileClient({ currentUid: () => 'partner', callable: async payload => {
    const data = await server.call(payload);
    if (payload.operation === 'command' && !payload.resolve_only && drop) { drop = false; throw Error('Lost acknowledgment'); }
    return { data };
  } });
  const saved = storage(), first = createNativeSupportProfileWorkspace('P', client, 'partner', { storage: saved, operationId: () => 'one' });
  const opening = await first.load(); expect(opening.support_profile).not.toHaveProperty('unknown');
  const command = createNativeSupportProfileDiff(opening.support_profile, { ...opening.support_profile, internalNotes: 'Inspected' })!;
  await expect(first.capture().submit(command)).rejects.toThrow(/Lost acknowledgment/);
  const reloaded = createNativeSupportProfileWorkspace('P', client, 'partner', { storage: saved, operationId: () => 'must-not-use' });
  await reloaded.load(); await expect(reloaded.capture().resolve()).resolves.toMatchObject({ resolution: 'committed' });
  expect(saved.values.size).toBe(0); expect(server.docs.get('projects/P').supportProfile).toMatchObject({ internalNotes: 'Inspected', unknown: { keep: true }, supportContacts: [{ name: 'Old' }] });
  expect([...server.docs.keys()].filter(path => path.includes('/audit/'))).toHaveLength(1);
});

it('actual stale Support drafts stay frozen and resolve without rebasing or changing data', async () => {
  const server = fixture({ uid: 'partner', supportProfileEnabled: true });
  const client = createNativeSupportProfileClient({ currentUid: () => 'partner', callable: async payload => ({ data: await server.call(payload) }) });
  const saved = storage(), workspace = createNativeSupportProfileWorkspace('P', client, 'partner', { storage: saved, operationId: () => 'stale' });
  await workspace.load(); const draft = workspace.capture(); server.change({ description: 'Concurrent update' });
  await expect(draft.submit({ kind: 'support_profile', patch: { internalNotes: 'Stale' } })).rejects.toMatchObject({ code: 'native-support/project_version_conflict' });
  expect(server.docs.get('projects/P').supportProfile.internalNotes).toBeUndefined();
  await expect(draft.resolve()).resolves.toMatchObject({ resolution: 'cancelled' }); expect(saved.values.size).toBe(0);
});
