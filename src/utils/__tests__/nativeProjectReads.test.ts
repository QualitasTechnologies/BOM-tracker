import { describe, expect, it, vi } from 'vitest';
import { createNativeProjectReadClient } from '../nativeProjectReads';

const opening = { project_id: 'p1', actor_uid: 'u1', project_version: '1:2', bom_version: '1:3', document_version: '1:4' };
const project = { projectId: 'p1', projectName: 'Build', historicalSnapshot: [{ total: 12 }], customAdminField: { retained: true } };
const document = { id: 'd1', projectId: 'p1', type: 'vendor-invoice', url: 'https://example.test/invoice?token=abc', nativeOpening: opening };
const pageReply = { ok: true, project_id: 'p1', actor_uid: 'u1', project_version: '1:2', bom_version: '1:3', documents: [document], next_cursor: null };

function setup(reply: unknown = { ok: true, project_id: 'p1', actor_uid: 'u1', version: '1:2', project }) {
  const callable = vi.fn(async () => ({ data: reply }));
  const client = createNativeProjectReadClient({ currentUid: () => 'u1', callable });
  return { client, callable };
}

describe('native project read client', () => {
  it('sends exact get request and retains supported historical/admin JSON fields', async () => {
    const { client, callable } = setup();
    const result = await client.get('p1', 'u1');
    expect(callable).toHaveBeenCalledWith({ operation: 'get', project_id: 'p1' }, 'u1', undefined);
    expect(result.project).toEqual(project);
  });

  it('sends bounded list and documents requests with only supported keys', async () => {
    const { client, callable } = setup({ ok: true, actor_uid: 'u1', projects: [], next_cursor: 'opaque' });
    expect(await client.list({ limit: 20, cursor: null }, 'u1')).toEqual({ projects: [], next_cursor: 'opaque' });
    expect(callable).toHaveBeenLastCalledWith({ operation: 'list', limit: 20, cursor: null }, 'u1', undefined);
    callable.mockResolvedValueOnce({ data: pageReply });
    expect((await client.documents('p1', { limit: 4 }, 'u1')).documents).toEqual([document]);
    expect(callable).toHaveBeenLastCalledWith({ operation: 'documents', project_id: 'p1', limit: 4 }, 'u1', undefined);
  });

  it('validates gallery invoice reverse-link response and exact request shape', async () => {
    const { client, callable } = setup({ ok: true, project_id: 'p1', actor_uid: 'u1', project_version: '1:2', bom_version: '1:3', document });
    expect((await client.galleryInvoice('p1', 'item1', 'u1')).document).toEqual(document);
    expect(callable).toHaveBeenCalledWith({ operation: 'gallery_invoice', project_id: 'p1', item_id: 'item1' }, 'u1', undefined);
  });

  it.each([
    ['wrong actor', { ok: true, project_id: 'p1', actor_uid: 'u2', version: '1:2', project }],
    ['wrong project', { ok: true, project_id: 'p2', actor_uid: 'u1', version: '1:2', project }],
    ['malformed version', { ok: true, project_id: 'p1', actor_uid: 'u1', version: 'bad', project }],
    ['extra envelope field', { ok: true, project_id: 'p1', actor_uid: 'u1', version: '1:2', project, secret: 'raw' }],
    ['null response', null],
    ['non JSON data', { ok: true, project_id: 'p1', actor_uid: 'u1', version: '1:2', project: { date: new Date() } }],
  ])('rejects %s without exposing response data', async (_name, reply) => {
    const { client } = setup(reply);
    await expect(client.get('p1', 'u1')).rejects.toThrow(/integrity|access|sign in|paused/i);
    await expect(client.get('p1', 'u1')).rejects.not.toThrow('raw');
  });

  it('rejects document URL and mismatched native opening', async () => {
    const { client, callable } = setup({ ok: true, ...opening, documents: [{ ...document, url: 'javascript:alert(1)' }], next_cursor: null });
    await expect(client.documents('p1', {}, 'u1')).rejects.toThrow(/integrity/i);
    callable.mockResolvedValueOnce({ data: { ok: true, ...opening, documents: [{ ...document, nativeOpening: { ...opening, bom_version: '9:9' } }], next_cursor: null } });
    await expect(client.documents('p1', {}, 'u1')).rejects.toThrow(/integrity/i);
  });

  it('accepts filtered empty pages with a non-null opaque cursor', async () => {
    const { client } = setup({ ok: true, project_id: 'p1', actor_uid: 'u1', project_version: '1:2', bom_version: 'missing', documents: [], next_cursor: 'opaque-cursor' });
    expect(await client.documents('p1', {}, 'u1')).toEqual({ documents: [], next_cursor: 'opaque-cursor', project_id: 'p1', actor_uid: 'u1', project_version: '1:2', bom_version: 'missing' });
  });

  it('accepts backend-valid Unicode and dotted IDs above 128 characters', async () => {
    const longId = '项目.' + 'a'.repeat(300);
    const { client, callable } = setup({ ok: true, project_id: longId, actor_uid: 'u1', version: '1:2', project: { projectId: longId, __proto__: 'own json key', constructor: { safe: true }, prototype: null } });
    const reply = await client.get(longId, 'u1');
    expect(reply.project.projectId).toBe(longId);
    expect(callable).toHaveBeenCalledWith({ operation: 'get', project_id: longId }, 'u1', undefined);
  });

  it('rejects IDs outside the callable ID contract and wrong types', async () => {
    const { client, callable } = setup();
    for (const id of ['', '  ', '.', '..', 'a/b', 'x\u0000y', `__${'x'.repeat(510)}__`, 12, null] as unknown[]) {
      await expect(client.get(id as string, 'u1')).rejects.toMatchObject({ code: 'invalid_request' });
    }
    expect(callable).not.toHaveBeenCalled();
  });

  it('uses safe backend revision semantics and allows missing only for BOM/document versions', async () => {
    const { client } = setup({ ok: true, project_id: 'p1', actor_uid: 'u1', project_version: '01:2', bom_version: 'missing', documents: [], next_cursor: null });
    await expect(client.documents('p1', {}, 'u1')).rejects.toMatchObject({ code: 'integrity' });
    const g = setup({ ok: true, project_id: 'p1', actor_uid: 'u1', project_version: '1:1000000000', bom_version: 'missing', documents: [], next_cursor: null });
    await expect(g.client.documents('p1', {}, 'u1')).rejects.toMatchObject({ code: 'integrity' });
    const h = setup({ ok: true, project_id: 'p1', actor_uid: 'u1', project_version: '1:2', bom_version: 'missing', documents: [], next_cursor: null });
    expect((await h.client.documents('p1', {}, 'u1')).bom_version).toBe('missing');
  });

  it('keeps safe prototype-named JSON properties and rejects accessor, symbol, hole and extra array properties', async () => {
    const own = Object.defineProperty({}, '__proto__', { value: { safe: true }, enumerable: true });
    const reply = { ok: true, project_id: 'p1', actor_uid: 'u1', version: '1:2', project: { projectId: 'p1', ...own, constructor: 'safe', prototype: ['safe'] } };
    const returnedProject = (await setup(reply).client.get('p1', 'u1')).project;
    expect(Object.hasOwn(returnedProject, '__proto__')).toBe(true);
    expect((Object.getOwnPropertyDescriptor(returnedProject, '__proto__')?.value as { safe: boolean }).safe).toBe(true);
    const accessor = { projectId: 'p1' };
    Object.defineProperty(accessor, 'private', { enumerable: true, get: () => { throw new Error('getter invoked'); } });
    await expect(setup({ ...reply, project: accessor }).client.get('p1', 'u1')).rejects.toMatchObject({ code: 'integrity' });
    const sparse: unknown[] = []; sparse.length = 1;
    await expect(setup({ ...reply, project: { projectId: 'p1', sparse } }).client.get('p1', 'u1')).rejects.toMatchObject({ code: 'integrity' });
    const symbol = { projectId: 'p1', [Symbol('private')]: true };
    await expect(setup({ ...reply, project: symbol }).client.get('p1', 'u1')).rejects.toMatchObject({ code: 'integrity' });
    const decorated: unknown[] = ['valid']; Object.assign(decorated, { extra: 'not JSON array' });
    await expect(setup({ ...reply, project: { projectId: 'p1', decorated } }).client.get('p1', 'u1')).rejects.toMatchObject({ code: 'integrity' });
    const hidden = { projectId: 'p1' }; Object.defineProperty(hidden, 'secret', { value: 'hidden', enumerable: false });
    await expect(setup({ ...reply, project: hidden }).client.get('p1', 'u1')).rejects.toMatchObject({ code: 'integrity' });
  });

  it('validates HTTPS host credentials and duplicate IDs and page bounds', async () => {
    for (const url of ['https://user:pass@example.test/x', 'https://%/missing-host', 'https://bad host/path']) {
      const invalidUrl = setup({ ok: true, project_id: 'p1', actor_uid: 'u1', project_version: '1:2', bom_version: '1:3', documents: [{ ...document, url }], next_cursor: null });
      await expect(invalidUrl.client.documents('p1', {}, 'u1')).rejects.toMatchObject({ code: 'integrity' });
    }
    const dup = setup({ ok: true, actor_uid: 'u1', projects: [{ project_id: 'p1', version: '1:2', project }, { project_id: 'p1', version: '1:3', project }], next_cursor: null });
    await expect(dup.client.list({}, 'u1')).rejects.toMatchObject({ code: 'integrity' });
    const many = setup({ ok: true, actor_uid: 'u1', projects: Array.from({ length: 51 }, (_, i) => ({ project_id: `p${i}`, version: '1:2', project: { projectId: `p${i}` } })), next_cursor: null });
    await expect(many.client.list({}, 'u1')).rejects.toMatchObject({ code: 'integrity' });
    const dupeDocs = setup({ ok: true, project_id: 'p1', actor_uid: 'u1', project_version: '1:2', bom_version: '1:3', documents: [document, document], next_cursor: null });
    await expect(dupeDocs.client.documents('p1', {}, 'u1')).rejects.toMatchObject({ code: 'integrity' });
    const tooManyDocs = setup({ ok: true, project_id: 'p1', actor_uid: 'u1', project_version: '1:2', bom_version: '1:3', documents: Array.from({ length: 51 }, (_, i) => ({ ...document, id: `d${i}` })), next_cursor: null });
    await expect(tooManyDocs.client.documents('p1', {}, 'u1')).rejects.toMatchObject({ code: 'integrity' });
    const blankCursor = setup({ ok: true, actor_uid: 'u1', projects: [], next_cursor: '  ' });
    await expect(blankCursor.client.list({}, 'u1')).rejects.toMatchObject({ code: 'integrity' });
  });

  it('exposes stable sanitized error codes for identity, access, unavailable and malformed replies', async () => {
    const denied = setup({ ok: false, error: 'project_forbidden', status: 403 });
    await expect(denied.client.get('p1', 'u1')).rejects.toMatchObject({ code: 'access' });
    const paused = setup({ ok: false, error: 'project_reads_disabled', status: 503 });
    await expect(paused.client.get('p1', 'u1')).rejects.toMatchObject({ code: 'paused' });
    const missing = setup({ ok: false, error: 'project_not_found', status: 404 });
    await expect(missing.client.get('p1', 'u1')).rejects.toMatchObject({ code: 'not_found' });
    const bad = setup(null);
    await expect(bad.client.get('p1', 'u1')).rejects.toMatchObject({ code: 'integrity' });
  });

  it('never inspects raw callable errors and checks context after an identity lookup failure', async () => {
    let context = 0;
    const callable = vi.fn(async () => { throw new Error('project context credential diagnostic'); });
    const uid = vi.fn().mockResolvedValueOnce('u1').mockRejectedValueOnce(new Error('identity changed password=secret'));
    const client = createNativeProjectReadClient({ currentUid: uid, callable });
    await expect(client.get('p1', 'u1', () => { context++; })).rejects.toMatchObject({ code: 'request_failed' });
    expect(context).toBe(4);
    expect(callable).toHaveBeenCalledTimes(1);
  });

  it('checks caller context after current UID lookup rejects before a request', async () => {
    let checks = 0;
    const client = createNativeProjectReadClient({ currentUid: async () => { throw new Error('private auth diagnostic'); }, callable: vi.fn() });
    await expect(client.get('p1', 'u1', () => { checks++; })).rejects.toMatchObject({ code: 'sign_in_required' });
    expect(checks).toBe(2);
  });

  it('rejects bad input and denied responses without raw fallback', async () => {
    const { client, callable } = setup({ ok: false, error: 'project_forbidden', status: 403 });
    await expect(client.list({ limit: 101 }, 'u1')).rejects.toMatchObject({ code: 'invalid_request' });
    expect(callable).not.toHaveBeenCalled();
    await expect(client.get('p1', 'u1')).rejects.toThrow(/access/i);
    expect(callable).toHaveBeenCalledTimes(1);
  });

  it('checks auth and caller context before and after successful or failed awaits', async () => {
    let uid: string | null = 'u1'; let epoch = 0;
    const callable = vi.fn(async () => ({ data: { ok: true, project_id: 'p1', actor_uid: 'u1', version: '1:2', project } }));
    const guard = () => { if (epoch !== 0) throw new Error('context changed'); };
    const client = createNativeProjectReadClient({ currentUid: () => uid, callable });
    callable.mockImplementationOnce(async () => { uid = 'u2'; return { data: { ok: true, project_id: 'p1', actor_uid: 'u1', version: '1:2', project } }; });
    await expect(client.get('p1', 'u1')).rejects.toThrow(/changed/i);
    uid = 'u1'; callable.mockImplementationOnce(async () => { epoch = 1; throw new Error('network private detail'); });
    await expect(client.get('p1', 'u1', guard)).rejects.toThrow(/changed/i);
    expect((await Promise.resolve(uid))).toBe('u1');
  });

  it('checks context before invoking callable and hides callable error details', async () => {
    const { client, callable } = setup();
    await expect(client.get('p1', 'u2')).rejects.toThrow(/changed/i);
    expect(callable).not.toHaveBeenCalled();
    callable.mockRejectedValueOnce(new Error('private backend text'));
    const error = await client.get('p1', 'u1').catch(value => value as Error);
    expect(error.message).toMatch(/unavailable|try again/i);
    expect(error.message).not.toContain('private backend text');
  });
});
