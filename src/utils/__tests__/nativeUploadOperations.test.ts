import { describe, expect, it, vi } from 'vitest';
import { createNativeReceiptPhotoAttempt } from '../nativeUploadOperations';

const setup = () => {
  let uid = 'u1';
  let current = true;
  const path = `projects/P1/received-photos/native/${'b'.repeat(64)}.jpg`;
  const finalPath = path.replace('/native/', '/finalized/');
  const urlFor = (objectPath: string, query = 'alt=media&token=server-token&generation=12') => `https://firebasestorage.googleapis.com/v0/b/visionbomtracker.firebasestorage.app/o/${encodeURIComponent(objectPath)}?${query}`;
  const photoUrl = urlFor(finalPath);
  const callable = vi.fn(async (request: any) => ({ data: request.operation === 'reserve'
    ? { ok: true, operation_id: request.operation_id, path, expires_at: '2026-10-15T00:00:00.000Z' }
    : { ok: true, photo_url: photoUrl, path, generation: '12' } }));
  const upload = vi.fn(async (_path: string) => {});
  const digest = vi.fn(async () => 'a'.repeat(64));
  const attempt = createNativeReceiptPhotoAttempt({ projectId: 'P1', itemId: 'motor', expectedActorUid: 'u1', blob: new Blob(['jpeg'], { type: 'image/jpeg' }), isCurrent: () => current }, {
    currentUid: async () => uid, callable, upload, digest, nonce: () => 'operation-1',
  });
  return { attempt, callable, upload, digest, path, finalPath, urlFor, photoUrl, changeUid: () => { uid = 'u2'; }, invalidate: () => { current = false; } };
};

describe('native receipt photo attempts', () => {
  it('reserves frozen JPEG intent before uploading and finalizing', async () => {
    const s = setup();
    expect(await s.attempt.run()).toBe(s.photoUrl);
    expect(s.callable.mock.calls.map(([r]) => r.operation)).toEqual(['reserve', 'finalize']);
    expect(s.callable.mock.calls[0][0]).toEqual({ operation: 'reserve', project_id: 'P1', item_id: 'motor', expected_actor_uid: 'u1', operation_id: 'operation-1', content_type: 'image/jpeg', byte_size: 4, sha256: 'a'.repeat(64) });
    expect(s.upload).toHaveBeenCalledTimes(1);
  });
  it('does not upload under a switched account after reservation', async () => {
    const s = setup();
    s.callable.mockImplementationOnce(async (r: any) => { s.changeUid(); return { data: { ok: true, operation_id: r.operation_id, path: s.path, expires_at: '2026-10-15T00:00:00.000Z' } }; });
    await expect(s.attempt.run()).rejects.toThrow(/account changed/i);
    expect(s.upload).not.toHaveBeenCalled();
  });
  it('recovers an uncertain upload only by finalizing, never overwriting', async () => {
    const s = setup(); s.upload.mockRejectedValueOnce(new Error('ack lost'));
    await expect(s.attempt.run()).rejects.toThrow('ack lost');
    await s.attempt.run();
    expect(s.upload).toHaveBeenCalledTimes(1); expect(s.digest).toHaveBeenCalledTimes(1);
    expect(s.callable.mock.calls.map(([r]) => r.operation)).toEqual(['reserve', 'finalize']);
  });
  it('retains reservation nonce and hash across uncertain reserve retries', async () => {
    const s = setup(); s.callable.mockRejectedValueOnce(new Error('reserve ack lost'));
    await expect(s.attempt.run()).rejects.toThrow('reserve ack lost'); await s.attempt.run();
    expect(s.callable.mock.calls[0][0]).toEqual(s.callable.mock.calls[1][0]); expect(s.digest).toHaveBeenCalledTimes(1);
  });
  it('drops changed project context before storage writes', async () => {
    const s = setup(); s.invalidate(); await expect(s.attempt.run()).rejects.toThrow(/context changed/i);
    expect(s.callable).not.toHaveBeenCalled(); expect(s.upload).not.toHaveBeenCalled();
  });
  it('rejects a capability path for a different project', async () => {
    const s = setup(); s.callable.mockResolvedValueOnce({ data: { ok: true, operation_id: 'operation-1', path: s.path.replace('P1', 'P2'), expires_at: '2026-10-15T00:00:00.000Z' } } as any);
    await expect(s.attempt.run()).rejects.toThrow(/unexpected/i); expect(s.upload).not.toHaveBeenCalled();
  });
  it('stops before reserve when the account changes during JPEG hashing', async () => {
    const s = setup(); s.digest.mockImplementationOnce(async () => { s.changeUid(); return 'a'.repeat(64); });
    await expect(s.attempt.run()).rejects.toThrow(/account changed/i);
    expect(s.callable).not.toHaveBeenCalled(); expect(s.upload).not.toHaveBeenCalled();
  });
  it('drops a changed context after reserve without writing storage', async () => {
    const s = setup();
    s.callable.mockImplementationOnce(async (r: any) => { s.invalidate(); return { data: { ok: true, operation_id: r.operation_id, path: s.path, expires_at: '2026-10-15T00:00:00.000Z' } }; });
    await expect(s.attempt.run()).rejects.toThrow(/context changed/i); expect(s.upload).not.toHaveBeenCalled();
  });
  it('does not finalize under a changed account after SDK upload', async () => {
    const s = setup(); s.upload.mockImplementationOnce(async () => { s.changeUid(); });
    await expect(s.attempt.run()).rejects.toThrow(/account changed/i);
    expect(s.callable.mock.calls.map(([r]) => r.operation)).toEqual(['reserve']);
  });
  it('retries uncertain finalize with the same IDs and never repeats upload', async () => {
    const s = setup(); const normal = s.callable.getMockImplementation()!;
    s.callable.mockImplementationOnce(normal).mockRejectedValueOnce(new Error('finalize ack lost'));
    await expect(s.attempt.run()).rejects.toThrow('finalize ack lost'); await s.attempt.run();
    expect(s.callable.mock.calls[1][0]).toEqual(s.callable.mock.calls[2][0]); expect(s.upload).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed finalization and retains the same recovery path', async () => {
    const s = setup(); const normal = s.callable.getMockImplementation()!;
    s.callable.mockImplementationOnce(normal).mockResolvedValueOnce({ data: { ok: true, photo_url: 'https://example.com/photo.jpg', path: 'wrong', generation: '12' } });
    await expect(s.attempt.run()).rejects.toThrow(/unexpected/i); await s.attempt.run(); expect(s.upload).toHaveBeenCalledTimes(1);
  });
  it('never issues another request for a successfully finalized attempt', async () => {
    const s = setup(); await s.attempt.run(); await s.attempt.run();
    expect(s.callable).toHaveBeenCalledTimes(2); expect(s.upload).toHaveBeenCalledTimes(1);
  });

  it.each([
    'https://example.com/photo.jpg',
    `https://firebasestorage.googleapis.com/v0/b/other.appspot.com/o/${encodeURIComponent(`projects/P1/received-photos/finalized/${'b'.repeat(64)}.jpg`)}?alt=media&token=server-token&generation=12`,
  ])('rejects a receipt URL outside the reserved hosted bucket: %s', async photoUrl => {
    const s = setup(); const normal = s.callable.getMockImplementation()!;
    s.callable.mockImplementationOnce(normal).mockResolvedValueOnce({ data: { ok: true, photo_url: photoUrl, path: s.path, generation: '12' } });
    await expect(s.attempt.run()).rejects.toThrow(/unexpected/i);
  });
  it('requires the URL generation to match finalized metadata', async () => {
    const s = setup(); const normal = s.callable.getMockImplementation()!;
    s.callable.mockImplementationOnce(normal).mockResolvedValueOnce({ data: { ok: true, photo_url: s.photoUrl, path: s.path, generation: '13' } });
    await expect(s.attempt.run()).rejects.toThrow(/unexpected/i);
  });

  it('accepts a separate finalized destination while the staging path stays unchanged', async () => {
    const s = setup();
    expect(await s.attempt.run()).toBe(s.urlFor(s.finalPath));
    expect(s.upload.mock.calls[0][0]).toBe(s.path);
  });
  it.each([
    ['the staging URL', (s: any) => s.urlFor(s.path)],
    ['another project', (s: any) => s.urlFor(s.finalPath.replace('P1', 'P2'))],
    ['another filename', (s: any) => s.urlFor(s.finalPath.replace('b'.repeat(64), 'c'.repeat(64)))],
    ['a nested finalized path', (s: any) => s.urlFor(s.finalPath.replace('/finalized/', '/finalized/x/'))],
    ['a duplicate generation', (s: any) => s.urlFor(s.finalPath, 'alt=media&token=server-token&generation=12&generation=12')],
    ['a conflicting generation', (s: any) => s.urlFor(s.finalPath, 'alt=media&token=server-token&generation=12&generation=13')],
    ['a duplicate token', (s: any) => s.urlFor(s.finalPath, 'alt=media&token=server-token&token=other&generation=12')],
    ['a duplicate alt', (s: any) => s.urlFor(s.finalPath, 'alt=media&alt=media&token=server-token&generation=12')],
    ['an extra parameter', (s: any) => s.urlFor(s.finalPath, 'alt=media&token=server-token&generation=12&download=1')],
    ['a missing token', (s: any) => s.urlFor(s.finalPath, 'alt=media&generation=12')],
    ['an empty token', (s: any) => s.urlFor(s.finalPath, 'alt=media&token=&generation=12')],
  ])('rejects a finalized URL with %s', async (_name, build) => {
    const s = setup(); const normal = s.callable.getMockImplementation()!;
    s.callable.mockImplementationOnce(normal).mockResolvedValueOnce({ data: { ok: true, photo_url: build(s), path: s.path, generation: '12' } });
    await expect(s.attempt.run()).rejects.toThrow(/unexpected/i);
  });
});
