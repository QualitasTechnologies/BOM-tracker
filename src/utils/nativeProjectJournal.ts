export type PendingNativeProjectJournalProbe = { kind: 'absent' | 'pending' } | { kind: 'error'; message: string };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 512
  && !value.includes('/') && !Array.from(value).some(character => character.charCodeAt(0) < 32) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);
const validRevision = (value: unknown) => typeof value === 'string' && /^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value)
  && Number.isSafeInteger(Number(value.split(':')[0])) && Number(value.split(':')[1]) < 1e9;
const validMemberCommand = (value: unknown) => {
  if (!object(value) || typeof value.kind !== 'string') return false;
  const keys = Object.keys(value).sort().join(',');
  const userId = (candidate: unknown) => validId(candidate) && (candidate as string).length <= 128;
  const scope = (candidate: unknown) => Array.isArray(candidate) && candidate.length <= 200
    && candidate.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 500)
    && new Set(candidate).size === candidate.length;
  const email = (candidate: unknown) => typeof candidate === 'string' && candidate.length <= 254 && /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(candidate);
  if (value.kind === 'member_add') return (keys === 'kind,user_id' || keys === 'category_scope,kind,user_id') && userId(value.user_id)
    && (value.category_scope === undefined || scope(value.category_scope));
  if (value.kind === 'member_remove') return keys === 'kind,user_id' && userId(value.user_id);
  if (value.kind === 'member_scope') return keys === 'category_scope,kind,user_id' && userId(value.user_id) && scope(value.category_scope);
  if (value.kind === 'member_notifications') return keys === 'enabled,kind,user_id' && userId(value.user_id) && typeof value.enabled === 'boolean';
  if (value.kind === 'recipient_add') return keys === 'email,kind,name' && email(value.email) && typeof value.name === 'string'
    && value.name.trim().length > 0 && value.name.length <= 500;
  if (value.kind === 'recipient_remove') return keys === 'email,kind' && email(value.email);
  if (value.kind === 'recipient_notifications') return keys === 'email,enabled,kind' && email(value.email) && typeof value.enabled === 'boolean';
  return false;
};
const probe = (projectId: string, uid: string, namespace: 'archive' | 'members'): PendingNativeProjectJournalProbe => {
  const unreadable = (): PendingNativeProjectJournalProbe => ({
    kind: 'error', message: namespace === 'archive'
      ? 'A saved archive request could not be read. Restore browser session storage before continuing.'
      : 'A saved access change could not be read. Restore browser session storage before editing.',
  });
  if (!validId(projectId) || typeof uid !== 'string' || !uid) return { kind: 'absent' };
  try {
    const raw = sessionStorage.getItem(`pulse.project-${namespace}.v1:${JSON.stringify([uid, projectId])}`);
    if (raw === null) return { kind: 'absent' };
    if (raw.length > 270000) return unreadable();
    const value: unknown = JSON.parse(raw);
    const envelope = object(value) && Object.keys(value).sort().join(',') === 'command,expected_version,operation_id'
      && validRevision(value.expected_version) && typeof value.operation_id === 'string' && /^[-\w]{1,128}$/.test(value.operation_id);
    const command = envelope && object(value.command) && (namespace === 'archive'
      ? value.command.kind === 'archive' && Object.keys(value.command).length === 1
      : validMemberCommand(value.command));
    return command ? { kind: 'pending' } : unreadable();
  } catch {
    return unreadable();
  }
};

export const hasPendingNativeProjectArchive = (projectId: string, uid: string) => probe(projectId, uid, 'archive');
export const hasPendingNativeProjectMembers = (projectId: string, uid: string) => probe(projectId, uid, 'members');
