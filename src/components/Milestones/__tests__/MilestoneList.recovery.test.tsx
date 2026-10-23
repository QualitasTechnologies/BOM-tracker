import React from 'react';
import { createRequire } from 'node:module';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MilestoneList from '../MilestoneList';

const { fixture } = createRequire(import.meta.url)('../../../../functions/nativeMilestoneFixture.cjs');
const mocks = vi.hoisted(() => ({ uid: 'alice', backend: null as any }));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: mocks.uid } }) }));
vi.mock('@/firebase', () => ({ db: {}, functions: {}, auth: { get currentUser() { return { uid: mocks.uid }; } } }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => async (payload: any) => ({ data: await mocks.backend.call(payload) }) }));
vi.mock('@/utils/nativeMaterialCommands', () => ({ isNativeMaterialCommandEnabled: () => true }));
vi.mock('@/utils/nativeMaterialOperations', async () => {
  const actual = await vi.importActual<any>('@/utils/nativeMaterialOperations');
  return { ...actual, nativeMaterialOperations: { ...actual.nativeMaterialOperations, currentUid: async () => mocks.uid } };
});
vi.mock('@/utils/milestoneFirestore', () => ({ DEFAULT_MILESTONE_TEMPLATE: [], subscribeToMilestones: () => () => {} }));
vi.mock('@/utils/projectFirestore', () => ({ getProject: vi.fn(), lockProjectBaseline: vi.fn() }));
vi.mock('@/utils/delayLogFirestore', () => ({
  subscribeToDelayLogs: () => () => {},
  getDelayStats: async () => ({ totalDelayDays: 0, internalDays: 0, externalDays: 0 }),
  addDelayLog: vi.fn(),
}));
vi.mock('../AddEditMilestoneDialog', () => ({ default: () => null }));
vi.mock('../MilestoneTableView', () => ({ default: () => null }));
vi.mock('../DelayHistoryView', () => ({ default: () => null }));

const settle = async () => { await act(async () => { for (let i = 0; i < 10; i += 1) await new Promise(r => setTimeout(r, 0)); }); };
const lockBaseline = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Lock Baseline' }));
  const dialog = screen.getByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Lock Baseline' }));
  await settle();
};
const receipts = () => [...mocks.backend.docs.keys()].filter((path: string) => path.includes('/receipts/'));

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  mocks.uid = 'alice';
});

it('the original lock-baseline control recovers a lost reply across reload through the real session and backend', async () => {
  const settings = { loseCommitReply: true, enabled: true as boolean };
  mocks.backend = fixture({ uid: 'alice', ...settings });
  const first = render(<MilestoneList projectId="P" />);
  await lockBaseline();
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  expect(mocks.backend.docs.get('projects/P').isBaselined).toBe(true);
  first.unmount();

  mocks.backend.options.enabled = false;
  render(<MilestoneList projectId="P" />);
  await settle();
  expect(await screen.findByText(/Resolve the pending schedule request/)).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Add Milestone' }).every(b => (b as HTMLButtonElement).disabled)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Resolve pending schedule request' }));
  await waitFor(() => expect(screen.queryByText(/Resolve the pending schedule request/)).toBeNull());
  expect(receipts()).toHaveLength(1);
  expect(mocks.backend.docs.get('projects/P').isBaselined).toBe(true);
  expect(mocks.backend.docs.get('projects/P/milestones/one').originalPlannedEndDate).toBe('2026-11-01');
  expect(sessionStorage.length).toBe(0);
});

it('a pending request saved by one account is never shown or resolved for another account', async () => {
  mocks.backend = fixture({ uid: 'alice', loseCommitReply: true });
  const first = render(<MilestoneList projectId="P" />);
  await lockBaseline();
  first.unmount();
  const before = receipts().length;

  mocks.uid = 'admin';
  render(<MilestoneList projectId="P" />);
  await settle();
  expect(screen.queryByText(/Resolve the pending schedule request/)).toBeNull();
  expect(receipts()).toHaveLength(before);
});

it('a pending request for one project is not shown when another project opens', async () => {
  mocks.backend = fixture({ uid: 'alice', loseCommitReply: true });
  const first = render(<MilestoneList projectId="P" />);
  await lockBaseline();
  first.unmount();

  render(<MilestoneList projectId="Q" />);
  await settle();
  expect(screen.queryByText(/Resolve the pending schedule request/)).toBeNull();
});
