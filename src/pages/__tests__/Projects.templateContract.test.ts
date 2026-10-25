import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createNativeMaterialOperationsClient } from '@/utils/nativeMaterialOperations';
import { createProjectTemplateInitialization } from '@/utils/projectTemplateInitialization';

vi.stubGlobal('crypto', webcrypto);
const require = createRequire(import.meta.url);
const { createNativeMaterialOperations } = require('../../../functions/nativeMaterialOperations.cjs');

function fixture(initial?: unknown) {
  let revision = 1;
  let loseResponse = false;
  let loseCreationResponse = false;
  const requests: any[] = [];
  const docs = new Map<string, any>([
    ['settings/bom', { categories: [{ name: 'Parts', isActive: true }] }],
  ]);
  if (initial !== undefined) docs.set('projects/p1/bom/data', initial);
  const ref = (path: string): any => ({ path, collection: (name: string) => ref(`${path}/${name}`), doc: (name: string) => ref(`${path}/${name}`) });
  const actor = { uid: 'alice', email: 'alice@qualitastech.com', emailVerified: true, customClaims: { role: 'viewer', status: 'approved' } };
  const native = createNativeMaterialOperations({ auth: { verifyIdToken: async () => ({ uid: actor.uid, email: actor.email }), getUser: async () => actor }, mutationsEnabled: true, getServerTimestamp: () => 'fixture-time',
    db: { collection: (name: string) => ref(name), runTransaction: async (fn: any) => {
      const writes: any[] = [];
      const result = await fn({ get: async (r: any) => {
        if (writes.length) throw new Error('read after write');
        return { exists: docs.has(r.path), data: () => structuredClone(docs.get(r.path)), updateTime: { seconds: 10, nanoseconds: revision } };
      }, update: (r: any, data: any) => {
        if (!docs.has(r.path)) throw new Error('update missing document');
        writes.push([r.path, { ...docs.get(r.path), ...data }]);
      }, create: (r: any, data: any) => {
        if (docs.has(r.path)) throw new Error('immutable collision'); writes.push([r.path, data]);
      } });
      writes.forEach(([path, data]) => docs.set(path, data)); if (writes.length) revision++; return result;
    } } });
  const client = createNativeMaterialOperationsClient({ getCurrentUser: () => ({ uid: actor.uid }), callable: async data => {
    requests.push(structuredClone(data));
    if (data.operation === 'create_project') addProject();
    const response = await native({ data, auth: { uid: actor.uid }, rawRequest: { get: () => 'Bearer fixture' } });
    if (data.operation === 'create_project' && loseCreationResponse) { loseCreationResponse = false; throw new Error('Creation confirmation lost'); }
    if (data.operation === 'command' && loseResponse) { loseResponse = false; throw new Error('Response lost after commit'); }
    return { data: response };
  } });
  const addProject = vi.fn();
  const getTemplate = vi.fn(async () => ({ id: 't1', items: [{ id: 'source', itemType: 'component' as const, name: 'Motor', description: '', category: 'Parts', quantity: 1 }] }));
  const flow = createProjectTemplateInitialization({ projectId: 'p1', templateId: 't1', client, project: { projectName: 'One', clientName: 'Acme', description: '', status: 'Planning', deadline: '2026-10-14', poValue: 0 }, cachedUid: 'alice', getTemplate });
  return { flow, docs, requests, addProject, getTemplate, loseResponse: () => { loseResponse = true; }, loseCreationResponse: () => { loseCreationResponse = true; }, invalidate: () => { revision++; } };
}

describe('project template flow with the actual native engine', () => {
  it.each([undefined, { categories: [] }])('initializes absent or empty BOM and records a single audit', async initial => {
    const f = fixture(initial); await f.flow.start();
    expect(f.docs.get('projects/p1/bom/data').categories[0].items).toHaveLength(1);
    expect([...f.docs.keys()].filter(key => key.includes('/materialAudit/'))).toHaveLength(2);
  });
  it('replays a committed initialization when its acknowledgment was lost without duplicating items or audit', async () => {
    const f = fixture(); f.loseResponse();
    await expect(f.flow.start()).rejects.toThrow('Response lost');
    const afterCommit = structuredClone(f.docs.get('projects/p1/bom/data'));
    await f.flow.retry();
    expect(f.docs.get('projects/p1/bom/data')).toEqual(afterCommit);
    expect(f.requests[3]).toEqual(f.requests[2]);
    expect(f.addProject).toHaveBeenCalledOnce();
    expect([...f.docs.keys()].filter(key => key.includes('/materialAudit/'))).toHaveLength(2);
  });
  it('retains stale revision on recovery rather than applying the template over a changed BOM', async () => {
    const f = fixture({ categories: [] });
    const original = f.getTemplate.getMockImplementation()!;
    f.getTemplate.mockImplementation(async () => { f.invalidate(); return original(); });
    await expect(f.flow.start()).rejects.toMatchObject({ code: 'material_version_conflict' });
    await expect(f.flow.retry()).rejects.toMatchObject({ code: 'material_version_conflict' });
    expect(f.requests[3]).toEqual(f.requests[2]);
    expect(f.docs.get('projects/p1/bom/data')).toEqual({ categories: [] });
  });
  it('rejects nonempty initialization without overwriting existing receipts', async () => {
    const initial = { categories: [{ name: 'Parts', items: [{ id: 'old', itemType: 'component', name: 'Existing', quantity: 1, status: 'received', fulfillmentTranches: [{ quantity: 1 }] }] }] };
    const f = fixture(initial);
    await expect(f.flow.start()).rejects.toMatchObject({ code: 'material_initialization_conflict' });
    await expect(f.flow.retry()).rejects.toMatchObject({ code: 'material_initialization_conflict' });
    expect(f.docs.get('projects/p1/bom/data')).toEqual(initial);
  });
  it.each([{ categories: null }, { categories: [{ name: 'Parts', items: null }] }])('rejects malformed initial BOM without writing materials', async initial => {
    const f = fixture(initial);
    await expect(f.flow.start()).rejects.toThrow();
    expect(f.flow.projectCreated).toBe(true);
    expect(f.docs.get('projects/p1/bom/data')).toEqual(initial);
    expect([...f.docs.keys()].filter(key => key.includes('/materialAudit/'))).toHaveLength(1);
  });
  it('recovers a committed creation with lost confirmation without another project or creation audit', async () => {
    const f = fixture(); f.loseCreationResponse();
    await expect(f.flow.start()).rejects.toThrow('Creation confirmation lost');
    expect(f.flow.creationAttempted).toBe(true);
    await f.flow.retry();
    expect(f.requests[1]).toEqual(f.requests[0]);
    expect([...f.docs.keys()].filter(key => /^projects\/[^/]+$/.test(key))).toEqual(['projects/p1']);
    expect([...f.docs.values()].filter(value => value.operation === 'create_project' && value.before === null)).toHaveLength(1);
  });
});
