import { nativeMaterialOperations, type NativeMaterialCommand, type NativeMaterialOperationsClient } from './nativeMaterialOperations';

export type DocumentLinkDeltaCommand = Extract<NativeMaterialCommand, { kind: 'link_document_delta' }>;

interface Input {
  projectId: string;
  uid: string;
  // The BOM revision that was displayed when the link dialog opened. It is never reloaded or advanced.
  version: string;
  isCurrent: () => boolean;
  client?: Pick<NativeMaterialOperationsClient, 'command' | 'currentUid'>;
}

const failure = (code: string, message: string) => Object.assign(new Error(message), { code });
const stale = () => failure('native-material/context-changed', 'The project context changed. Close this dialog and try again.');
const accountChanged = () => failure('native-material/identity-changed', 'The signed-in account changed. Close this dialog and try again.');

const copy = (command: DocumentLinkDeltaCommand): DocumentLinkDeltaCommand => {
  if (!command || command.kind !== 'link_document_delta') throw failure('native-material/invalid-input', 'Only a document link change can be saved here.');
  return Object.freeze({
    kind: 'link_document_delta' as const, document_id: command.document_id,
    add_item_ids: Object.freeze([...command.add_item_ids]) as string[], remove_item_ids: Object.freeze([...command.remove_item_ids]) as string[],
  });
};
const keyOf = (command: DocumentLinkDeltaCommand) => JSON.stringify([command.document_id, command.add_item_ids, command.remove_item_ids]);

// Server decisions that prove the request was not applied. Anything else (a lost reply, a transport error,
// an unreadable response) is uncertain and keeps the same request identity for a retry.
export const isDefinitiveDocumentLinkFailure = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && (/^(material|project|actor)_/.test(code) || code === 'native-material/invalid-input' || code === 'functions/permission-denied' || code === 'functions/unauthenticated');
};

// One captured document-link action: the displayed revision and account are frozen when the dialog opens,
// a retry of the same delta reuses its operation id, and the request is never rebased on a newer revision.
export function createDocumentLinkAction({ projectId, uid, version, isCurrent, client = nativeMaterialOperations }: Input) {
  if (!uid) throw failure('native-material/unauthenticated', 'Sign in again before changing document links.');
  if (!version) throw failure('native-material/snapshot-required', 'BOM revision is still loading. Refresh the page before changing document links.');
  const ids = new Map<string, string>();
  let pending = false;
  const verify = async () => {
    if (!isCurrent()) throw stale();
    if (!client.currentUid || await client.currentUid() !== uid) throw accountChanged();
    if (!isCurrent()) throw stale();
  };
  return {
    projectId, uid, version,
    async submit(command: DocumentLinkDeltaCommand) {
      if (pending) throw failure('native-material/pending', 'A document link update is already pending.');
      pending = true;
      try {
        const frozen = copy(command);
        await verify();
        const key = keyOf(frozen);
        if (!ids.has(key)) ids.set(key, globalThis.crypto.randomUUID());
        const result = await client.command(projectId, { expected_version: version, operation_id: ids.get(key)!, command: frozen }, uid);
        await verify();
        return result;
      } finally { pending = false; }
    },
  };
}
export type DocumentLinkAction = ReturnType<typeof createDocumentLinkAction>;
