import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Project, ProjectMember } from '../projectFirestore';

const sdk = vi.hoisted(() => ({
  doc: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(), getDoc: vi.fn(),
}));
vi.mock('@/firebase', () => ({ db: {}, auth: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: sdk.doc, setDoc: sdk.setDoc, updateDoc: sdk.updateDoc,
  deleteDoc: sdk.deleteDoc, getDoc: sdk.getDoc, getDocFromServer: vi.fn(),
  addDoc: vi.fn(), getDocs: vi.fn(), onSnapshot: vi.fn(), query: vi.fn(), where: vi.fn(),
}));
import {
  addProject, updateProject, archiveProject, restoreProject, lockProjectBaseline, deleteProject,
  addProjectMember, removeProjectMember, updateProjectMemberScope,
  addExternalRecipient, removeExternalRecipient, toggleExternalRecipientNotifications,
} from '../projectFirestore';

const project: Project = {
  projectId: 'P', projectName: 'Project', clientName: 'Client', description: '',
  status: 'Planning', deadline: '', memberIds: ['alice'],
  // A scoped roster intentionally lacks other members and their management fields.
  members: [{ userId: 'alice', email: 'alice@example.com', displayName: 'Alice' } as ProjectMember],
};
const member: ProjectMember = {
  userId: 'bob', email: 'bob@example.com', displayName: 'Bob', addedAt: '2026-10-21', addedBy: 'admin',
};
const writes = [
  ['create', () => addProject(project)],
  ['metadata', () => updateProject('P', { description: 'Changed' })],
  ['whole roster', () => updateProject('P', { members: project.members })],
  ['archive', () => archiveProject('P')],
  ['restore', () => restoreProject('P')],
  ['baseline', () => lockProjectBaseline('P', 'alice')],
  ['delete', () => deleteProject('P')],
  ['member add', () => addProjectMember('P', project, member)],
  ['member remove', () => removeProjectMember('P', project, 'alice')],
  ['member scope', () => updateProjectMemberScope('P', project, 'alice', ['Parts'])],
  ['recipient add', () => addExternalRecipient('P', project, { name: 'Contact', email: 'contact@example.com' })],
  ['recipient remove', () => removeExternalRecipient('P', project, 'contact@example.com')],
  ['recipient preference', () => toggleExternalRecipientNotifications('P', project, 'contact@example.com', false)],
] as const;

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => vi.unstubAllEnvs());

it.each(writes)('blocks legacy %s before any source read or write in scoped mode', async (_name, write) => {
  for (const edits of ['false', 'true']) {
    vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');
    vi.stubEnv('VITE_BOM_SAFE_MATERIAL_EDITS_ENABLED', edits);
    vi.stubEnv('VITE_BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED', edits);
    const original = structuredClone(project);
    await expect(write()).rejects.toThrow(/project.*(edit|action|save)|versioned|scoped/i);
    expect(sdk.doc).not.toHaveBeenCalled();
    expect(sdk.getDoc).not.toHaveBeenCalled();
    expect(sdk.setDoc).not.toHaveBeenCalled();
    expect(sdk.updateDoc).not.toHaveBeenCalled();
    expect(sdk.deleteDoc).not.toHaveBeenCalled();
    expect(project).toEqual(original);
  }
});

it.each([undefined, 'false', 'TRUE'])('preserves legacy metadata edits unless reads are exactly enabled (%s)', async flag => {
  vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', flag);
  sdk.updateDoc.mockResolvedValue(undefined);
  await updateProject('P', { description: 'Changed' });
  expect(sdk.updateDoc).toHaveBeenCalledWith(undefined, { description: 'Changed' });
});
