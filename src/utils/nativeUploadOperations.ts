interface ReceiptPhotoInput {
  projectId: string;
  itemId: string;
  expectedActorUid: string;
  blob: Blob;
  isCurrent: () => boolean;
}
interface UploadDependencies {
  currentUid: () => Promise<string>;
  callable: (request: Record<string, unknown>, actorUid: string, isCurrent: () => boolean) => Promise<{ data: unknown }>;
  upload: (path: string, blob: Blob, actorUid: string, isCurrent: () => boolean) => Promise<unknown>;
  digest: (blob: Blob) => Promise<string>;
  nonce: () => string;
}
const fail = (message: string) => new Error(message);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const prefix = (projectId: string, folder: 'native' | 'finalized') => `projects/${projectId}/received-photos/${folder}/`;
const serviceMessage = (code: string) => ({
  upload_not_found: 'The photo upload is not available yet. Retry Photo to check again, or cancel and reopen to start a new upload.',
  upload_intent_expired: 'The photo reservation expired. Cancel and reopen to start a new upload.',
  upload_integrity_failed: 'The stored photo could not be verified. Cancel and reopen to start a new upload.',
  native_uploads_disabled: 'Receipt photo upload is not enabled here yet.',
  native_uploads_read_only: 'Receipt photo upload is read-only here.',
}[code] || 'The photo service could not complete the request. Retry Photo to recover, or cancel and reopen.');
const defaultDependencies: UploadDependencies = {
  currentUid: async () => { const { auth } = await import('@/firebase'); return auth.currentUser?.uid || ''; },
  callable: async (request, actorUid, isCurrent) => {
    const [{ functions, auth }, { httpsCallable }] = await Promise.all([import('@/firebase'), import('firebase/functions')]);
    if (!isCurrent()) throw fail('The photo context changed. Reopen before continuing.');
    if (auth.currentUser?.uid !== actorUid) throw fail('The signed-in account changed. Reopen before continuing.');
    return httpsCallable(functions, 'nativeUploadOperations')(request);
  },
  upload: async (path, blob, actorUid, isCurrent) => {
    const [{ storage, auth }, { ref, uploadBytes }] = await Promise.all([import('@/firebase'), import('firebase/storage')]);
    // No await between this SDK identity/context check and starting the Storage request.
    if (!isCurrent()) throw fail('The photo context changed. Reopen before continuing.');
    if (auth.currentUser?.uid !== actorUid) throw fail('The signed-in account changed. Reopen before continuing.');
    return uploadBytes(ref(storage, path), blob, { contentType: 'image/jpeg' });
  },
  digest: async blob => {
    const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
  },
  nonce: () => crypto.randomUUID(),
};

// Keep this attempt for retries: bytes, actor, hash and nonce never change. Once an SDK write
// starts, its acknowledgement can be uncertain; retries only finalize, never overwrite the path.
export const createNativeReceiptPhotoAttempt = (input: ReceiptPhotoInput, deps = defaultDependencies) => {
  const { projectId, itemId, expectedActorUid, blob, isCurrent } = input;
  const ids = Object.freeze({ project_id: projectId, item_id: itemId, operation_id: deps.nonce(), expected_actor_uid: expectedActorUid });
  let intent: Readonly<Record<string, unknown>> | undefined;
  let path: string | undefined;
  let writeStarted = false;
  let result: string | undefined;
  let pending = false;
  const guard = async () => {
    if (!isCurrent()) throw fail('The photo context changed. Reopen before continuing.');
    if (!expectedActorUid || await deps.currentUid() !== expectedActorUid) throw fail('The signed-in account changed. Reopen before continuing.');
    if (!isCurrent()) throw fail('The photo context changed. Reopen before continuing.');
  };
  const call = async (request: Record<string, unknown>) => {
    await guard();
    let response: unknown, failure: unknown;
    try { response = (await deps.callable(request, expectedActorUid, isCurrent)).data; } catch (error) { failure = error; }
    await guard();
    if (failure) throw failure;
    if (record(response) && response.ok === false && typeof response.error === 'string') throw fail(serviceMessage(response.error));
    if (!record(response) || response.ok !== true) throw fail('The photo service returned an unexpected result.');
    return response;
  };
  return {
    async run(): Promise<string> {
      if (pending) throw fail('A photo request is already pending.');
      pending = true;
      try {
        await guard();
        if (result) return result;
        if (!intent) {
          if (!projectId || !itemId || blob.type !== 'image/jpeg' || blob.size < 1 || blob.size >= 10485760) throw fail('A valid compressed receipt JPEG and item are required.');
          const sha256 = await deps.digest(blob);
          await guard();
          if (!/^[a-f0-9]{64}$/.test(sha256)) throw fail('Could not fingerprint the receipt photo.');
          intent = Object.freeze({ operation: 'reserve', ...ids, content_type: 'image/jpeg', byte_size: blob.size, sha256 });
        }
        if (!path) {
          const reservation = await call(intent);
          const staging = prefix(projectId, 'native');
          if (reservation.operation_id !== ids.operation_id || typeof reservation.path !== 'string' || !reservation.path.startsWith(staging)
            || !/^[a-f0-9]{64}\.jpg$/.test(reservation.path.slice(staging.length)) || typeof reservation.expires_at !== 'string' || !Number.isFinite(Date.parse(reservation.expires_at))) {
            throw fail('The photo service returned an unexpected reservation.');
          }
          path = reservation.path;
        }
        if (!writeStarted) {
          await guard();
          writeStarted = true;
          let failure: unknown;
          try { await deps.upload(path, blob, expectedActorUid, isCurrent); } catch (error) { failure = error; }
          await guard();
          if (failure) throw failure;
        }
        const finalized = await call({ operation: 'finalize', ...ids });
        if (finalized.path !== path || typeof finalized.generation !== 'string' || !/^[1-9]\d*$/.test(finalized.generation)
          || typeof finalized.photo_url !== 'string') throw fail('The photo service returned an unexpected result.');
        let photo: URL;
        try { photo = new URL(finalized.photo_url); } catch { throw fail('The photo service returned an unexpected result.'); }
        // The URL names the server-published final object, never the upload staging path.
        const finalPath = `${prefix(projectId, 'finalized')}${path.slice(prefix(projectId, 'native').length)}`;
        const params = [...photo.searchParams.keys()].sort().join(',');
        if (photo.origin !== 'https://firebasestorage.googleapis.com' || photo.username || photo.password || photo.hash
          || photo.pathname !== `/v0/b/visionbomtracker.firebasestorage.app/o/${encodeURIComponent(finalPath)}`
          || params !== 'alt,generation,token' || photo.searchParams.get('alt') !== 'media' || !photo.searchParams.get('token')
          || photo.searchParams.get('generation') !== finalized.generation) throw fail('The photo service returned an unexpected result.');
        result = finalized.photo_url;
        return result;
      } finally { pending = false; }
    },
  };
};
export type NativeReceiptPhotoAttempt = ReturnType<typeof createNativeReceiptPhotoAttempt>;
