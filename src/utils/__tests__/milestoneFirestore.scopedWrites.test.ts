import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  collection: vi.fn(() => ({})), doc: vi.fn(() => ({ id: 'new' })), getDoc: vi.fn(), getDocs: vi.fn(), onSnapshot: vi.fn(() => () => {}),
  setDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(), query: vi.fn(() => ({})), orderBy: vi.fn(), where: vi.fn(),
  batch: { set: vi.fn(), update: vi.fn(), commit: vi.fn() }, writeBatch: vi.fn(),
  getProject: vi.fn(),
}));

vi.mock('@/firebase', () => ({ db: {}, auth: {} }));
vi.mock('firebase/firestore', () => ({
  collection: sdk.collection, doc: sdk.doc, getDoc: sdk.getDoc, getDocs: sdk.getDocs, onSnapshot: sdk.onSnapshot, setDoc: sdk.setDoc,
  updateDoc: sdk.updateDoc, deleteDoc: sdk.deleteDoc, query: sdk.query, orderBy: sdk.orderBy, where: sdk.where, writeBatch: sdk.writeBatch,
}));
vi.mock('../projectFirestore', () => ({ getProject: sdk.getProject }));

import * as milestones from '../milestoneFirestore';
import * as delayLogs from '../delayLogFirestore';

const input = { name: 'Plan', currentPlannedEndDate: '2099-01-01' };
const delay = { entityType: 'milestone', entityId: 'one', entityName: 'Plan', previousDate: '2099-01-01', newDate: '2099-01-09', reason: 'Customer approved the new schedule', attribution: 'external-client' } as const;
const writers: Array<[string, () => Promise<unknown>]> = [
  ['addMilestone', () => milestones.addMilestone('P', input, 'u1')],
  ['updateMilestone', () => milestones.updateMilestone('P', 'one', { name: 'x' })],
  ['updateMilestoneStatus', () => milestones.updateMilestoneStatus('P', 'one', 'completed', 'done')],
  ['updateMilestoneDate', () => milestones.updateMilestoneDate('P', 'one', '2099-02-01')],
  ['deleteMilestone', () => milestones.deleteMilestone('P', 'one')],
  ['reorderMilestones', () => milestones.reorderMilestones('P', ['one', 'two'])],
  ['lockMilestonesBaseline', () => milestones.lockMilestonesBaseline('P')],
  ['applyMilestoneTemplate', () => milestones.applyMilestoneTemplate('P', '2099-12-31', 'u1')],
  ['addDelayLog', () => delayLogs.addDelayLog('P', delay as any, 'u1', 'User', '2099-01-09')],
];

beforeEach(() => {
  vi.clearAllMocks();
  sdk.writeBatch.mockReturnValue(sdk.batch);
  sdk.doc.mockReturnValue({ id: 'new' });
  sdk.getDocs.mockResolvedValue({ docs: [], size: 0 });
  sdk.getProject.mockResolvedValue({ originalDeadline: '2099-01-01' });
});
afterEach(() => vi.unstubAllEnvs());

describe('scoped reads never enable legacy schedule writes', () => {
  it.each(writers)('%s refuses before any SDK source access', async (_name, run) => {
    vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');
    await expect(run()).rejects.toThrow(/temporarily unavailable/);
    for (const fn of [sdk.collection, sdk.doc, sdk.getDoc, sdk.getDocs, sdk.setDoc, sdk.updateDoc, sdk.deleteDoc, sdk.writeBatch, sdk.batch.set, sdk.batch.update, sdk.batch.commit, sdk.getProject]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('keeps the legacy writers working when scoped reads are off', async () => {
    vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'false');
    await milestones.updateMilestoneStatus('P', 'one', 'completed');
    await milestones.deleteMilestone('P', 'one');
    await delayLogs.addDelayLog('P', delay as any, 'u1', 'User', '2099-01-09');
    expect(sdk.updateDoc).toHaveBeenCalledOnce();
    expect(sdk.deleteDoc).toHaveBeenCalledOnce();
    expect(sdk.setDoc).toHaveBeenCalledOnce();
  });

  it('still lets scoped mode read milestones and delay history', () => {
    vi.stubEnv('VITE_BOM_SCOPED_READS_ENABLED', 'true');
    milestones.subscribeToMilestones('P', () => {});
    delayLogs.subscribeToDelayLogs('P', () => {});
    expect(sdk.onSnapshot).toHaveBeenCalledTimes(2);
  });
});
