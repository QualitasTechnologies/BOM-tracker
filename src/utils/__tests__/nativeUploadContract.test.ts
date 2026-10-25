import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createNativeReceiptPhotoAttempt } from '../nativeUploadOperations';
const require = createRequire(import.meta.url);
const { createNativeUploadOperations } = require('../../../functions/nativeUploadOperations.cjs');

function fixture() {
  const actor = { uid: 'alice', email: 'alice@qualitastech.com', emailVerified: true, customClaims: { role: 'user', status: 'approved' } };
  const docs = new Map<string, any>([
    ['projects/P', { memberIds: ['alice'], projectId: 'P' }],
    ['projects/P/bom/data', { categories: [{ name: 'Parts', items: [{ id: 'bolt' }] }] }],
  ]);
  const ref = (path: string): any => ({ path, doc: (id: string) => ref(`${path}/${id}`), collection: (id: string) => ref(`${path}/${id}`) });
  const db = { collection: ref, runTransaction: async (fn: any) => {
    const writes: any[] = [];
    const result = await fn({ get: async (r: any) => { expect(writes).toHaveLength(0); return { exists: docs.has(r.path), data: () => structuredClone(docs.get(r.path)) }; },
      create: (r: any, data: any) => { expect(docs.has(r.path)).toBe(false); writes.push([r.path, data]); },
      update: (r: any, data: any) => writes.push([r.path, { ...docs.get(r.path), ...data }]),
    });
    for (const [path, data] of writes) docs.set(path, data);
    return result;
  } };
  let stored: Buffer | undefined, published: Buffer | undefined, uploads = 0, loseFinalize = true;
  let publishedMetadata: any, publishedOptions: any;
  const stagingPrefix = 'projects/P/received-photos/native/', finalPrefix = 'projects/P/received-photos/finalized/';
  const bucket = { name: 'visionbomtracker.firebasestorage.app', file: (path: string, options?: any) => path.startsWith(finalPrefix) ? ({
    save: async (bytes: Buffer, saveOptions: any) => {
      expect(saveOptions.preconditionOpts).toEqual({ ifGenerationMatch: 0 });
      expect(saveOptions.metadata.contentType).toBe('image/jpeg');
      expect(saveOptions.metadata.metadata.firebaseStorageDownloadTokens).toBeTruthy();
      if (published) throw Object.assign(Error('exists'), { code: 412 });
      published = Buffer.from(bytes); publishedOptions = saveOptions; publishedMetadata = saveOptions.metadata;
    },
    getMetadata: async () => { if (!published) throw Object.assign(Error('missing'), { code: 404 }); return [{ size: String(published.length), contentType: 'image/jpeg', generation: '9', metadata: publishedMetadata.metadata }]; },
    createReadStream: () => Readable.from([published]),
  }) : ({
    getMetadata: async () => { expect(path.startsWith(stagingPrefix)).toBe(true); if (!stored) throw Object.assign(Error('missing'), { code: 404 }); return [{ size: String(stored.length), contentType: 'image/jpeg', generation: '7' }]; },
    createReadStream: () => { expect(options?.generation).toBe('7'); return Readable.from([stored]); },
    setMetadata: async (_data: any, condition: any) => expect(condition.ifGenerationMatch).toBe('7'),
  }) };
  const auth = { verifyIdToken: async () => ({ uid: actor.uid, email: actor.email }), getUser: async () => actor };
  const server = createNativeUploadOperations({ db, auth, bucket, enabled: true, getServerTimestamp: () => 'server' });
  const jpeg = Buffer.from([255, 216, 255, 1, 255, 217]);
  const blob = new Blob([jpeg], { type: 'image/jpeg' });
  const attempt = createNativeReceiptPhotoAttempt({ projectId: 'P', itemId: 'bolt', expectedActorUid: 'alice', blob, isCurrent: () => true }, {
    currentUid: async () => 'alice', nonce: () => 'photo-1', digest: async () => createHash('sha256').update(jpeg).digest('hex'),
    upload: async () => { uploads++; stored = jpeg; },
    callable: async data => {
      const result = await server({ data, auth: { uid: 'alice' }, rawRequest: { get: () => 'Bearer test' } });
      if (data.operation === 'finalize' && loseFinalize) { loseFinalize = false; throw Error('reply lost'); }
      return { data: result };
    },
  });
  return { attempt, docs, actor, uploads: () => uploads, published: () => published, publishedOptions: () => publishedOptions };
}

it('real photo client recovers a lost real callable acknowledgment without reuploading', async () => {
  const f = fixture();
  await expect(f.attempt.run()).rejects.toThrow('reply lost');
  const url = await f.attempt.run();
  expect(url).toContain('generation=9'); expect(url).toContain('received-photos%2Ffinalized%2F'); expect(url).not.toContain('%2Fnative%2F');
  expect(f.published()).toEqual(Buffer.from([255, 216, 255, 1, 255, 217]));
  expect(f.uploads()).toBe(1);
  expect([...f.docs.keys()].filter(path => path.includes('/audit/'))).toHaveLength(2);
});

it('real photo callable rechecks membership before returning its saved confirmation', async () => {
  const f = fixture(); await expect(f.attempt.run()).rejects.toThrow('reply lost');
  f.docs.get('projects/P').memberIds = [];
  await expect(f.attempt.run()).rejects.toThrow(/could not complete|project_forbidden/); expect(f.uploads()).toBe(1);
});
