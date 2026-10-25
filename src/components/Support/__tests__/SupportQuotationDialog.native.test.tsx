import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SupportQuotationDialog } from '../SupportQuotationDialog';

const mocks = vi.hoisted(() => ({
  native: true, scoped: true,
  load: vi.fn(), capture: vi.fn(), submit: vi.fn(), invalidate: vi.fn(), factory: vi.fn(),
  update: vi.fn(), prepare: vi.fn(), toast: vi.fn(), close: vi.fn(), deferEntities: false, entityCallback: null as any,
  journal: undefined as any, acknowledge: vi.fn(), resolve: vi.fn(), actions: [] as any[],
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/utils/projectFirestore', () => ({ updateProject: mocks.update }));
vi.mock('@/utils/supportFirestore', () => ({ prepareSupportQuotation: mocks.prepare }));
vi.mock('@/utils/projectReadMode', () => ({ isScopedProjectReadEnabled: () => mocks.scoped }));
vi.mock('@/utils/nativeProjectOperations', () => ({ createNativeProjectWorkspace: mocks.factory }));
vi.mock('@/utils/nativeSupportProfile', () => ({ isNativeSupportProfileEnabled: () => mocks.native }));
vi.mock('@/utils/settingsFirestore', () => ({
  getDefaultBillingEntity: (entities: any[]) => entities[0],
  subscribeToBillingEntities: (callback: (entities: any[]) => void) => { mocks.entityCallback = callback; if (!mocks.deferEntities) callback([
    { id: 'company', displayName: 'Company', gstin: 'A' },
    { id: 'B', displayName: 'Branch', gstin: 'B' },
    { id: 'Q', displayName: 'Quoted', gstin: 'Q' },
  ]); return () => {}; },
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children, disabled }: any) => <select aria-label="Billing entity" disabled={disabled} value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null, SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: any) => <div>{children}</div>, DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>, DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>, DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

const project: any = { projectId: 'P', projectName: 'Project', billingEntityId: 'company', clientName: 'Acme' };
const ticket: any = { id: 'T', ticketNumber: 'T-1', commercialStatus: 'quotation-required' };
const props = (extra = {}) => ({ open: true, onOpenChange: mocks.close, project, ticket, client: null, ...extra });
beforeEach(() => {
  vi.clearAllMocks(); mocks.native = true; mocks.scoped = true; mocks.deferEntities = false; mocks.entityCallback = null; mocks.journal = undefined; mocks.actions = [];
  mocks.load.mockResolvedValue({ ok: true, project_id: 'P', version: '10:1', project: { projectId: 'P', billingEntityId: 'company' } });
  mocks.submit.mockResolvedValue({ ok: true }); mocks.prepare.mockResolvedValue({ quotation: { quotationNumber: 'SVC/26/0001', total: 118 } });
  // The action journals its command before sending, like the real session-storage backed action.
  mocks.capture.mockImplementation(() => {
    const sent: any[] = [];
    const action = {
      sent,
      submit: (command: any) => { sent.push(command); mocks.journal = command; return mocks.submit(command); },
      acknowledge: (...args: any[]) => { const result = mocks.acknowledge(...args); mocks.journal = undefined; return result; },
      resolve: mocks.resolve, get pendingCommand() { return mocks.journal; },
    };
    mocks.actions.push(action);
    return action;
  });
  mocks.factory.mockReturnValue({ load: mocks.load, capture: mocks.capture, recover: vi.fn(() => null), invalidate: mocks.invalidate });
});

it('routes a changed Support billing entity through the frozen versioned project request before preparing the quote', async () => {
  render(<SupportQuotationDialog {...props()} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
  mocks.load.mockResolvedValueOnce({ ok: true, project_id: 'P', version: '10:2', project: { projectId: 'P', billingEntityId: 'B' } });
  fireEvent.change(screen.getAllByLabelText('Billing entity')[0], { target: { value: 'B' } });
  fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Site visit' } });
  fireEvent.change(screen.getAllByRole('spinbutton')[2], { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate quotation PDF' }));
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
  expect(mocks.factory).toHaveBeenCalledWith('P');
  expect(mocks.capture).toHaveBeenCalledWith('support-billing');
  expect(mocks.submit).toHaveBeenCalledWith({ kind: 'support_billing_entity', billing_entity_id: 'B' });
  expect(mocks.submit.mock.invocationCallOrder[0]).toBeLessThan(mocks.prepare.mock.invocationCallOrder[0]);
  expect(mocks.prepare.mock.calls[0][0]).toMatchObject({ projectId: 'P', ticketId: 'T', billingEntityId: 'B' });
  expect(mocks.update).not.toHaveBeenCalled();
});

it('keeps the legacy Support project update path when native writes and scoped reads are both off', async () => {
  mocks.native = false; mocks.scoped = false;
  render(<SupportQuotationDialog {...props()} />);
  fireEvent.change(screen.getAllByLabelText('Billing entity')[0], { target: { value: 'B' } });
  fireEvent.change(screen.getAllByRole('spinbutton')[2], { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate quotation PDF' }));
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
  expect(mocks.update).toHaveBeenCalledWith('P', { billingEntityId: 'B' });
  expect(mocks.factory).not.toHaveBeenCalled();
});

it('does not fall back to project replacement when scoped reads are on and the Support writer is off', async () => {
  mocks.native = false; mocks.scoped = true;
  render(<SupportQuotationDialog {...props()} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
  fireEvent.change(screen.getAllByLabelText('Billing entity')[0], { target: { value: 'B' } });
  fireEvent.change(screen.getAllByRole('spinbutton')[2], { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate quotation PDF' }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not prepare quotation' })));
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.prepare).not.toHaveBeenCalled();
});

it('does not start quote generation while the versioned billing route has an uncertain outcome', async () => {
  mocks.submit.mockRejectedValueOnce(new Error('Billing route outcome is unconfirmed'));
  render(<SupportQuotationDialog {...props()} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
  fireEvent.change(screen.getAllByLabelText('Billing entity')[0], { target: { value: 'B' } });
  fireEvent.change(screen.getAllByRole('spinbutton')[2], { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate quotation PDF' }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not prepare quotation', description: 'Billing route outcome is unconfirmed' })));
  expect(mocks.submit).toHaveBeenCalledOnce();
  expect(await screen.findByRole('button', { name: 'Check saved billing change' })).toBeInTheDocument();
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
});

it('resolves a saved billing request after the Support writer gate closes', async () => {
  mocks.native = false; mocks.scoped = true;
  const pending = { kind: 'support_billing_entity', billing_entity_id: 'B' };
  const action = { submit: mocks.submit, resolve: vi.fn().mockResolvedValue({ resolution: 'committed' }), acknowledge: vi.fn(), pendingCommand: pending };
  mocks.factory.mockReturnValue({ load: mocks.load, capture: mocks.capture, recover: vi.fn(() => action), invalidate: mocks.invalidate });
  render(<SupportQuotationDialog {...props()} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
  fireEvent.click(await screen.findByRole('button', { name: 'Check saved billing change' }));
  await waitFor(() => expect(action.resolve).toHaveBeenCalledOnce());
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
});

it('writes the selected route when the native opening has no route despite a stale project prop', async () => {
  mocks.load.mockResolvedValueOnce({ ok: true, project_id: 'P', version: '10:1', project: { projectId: 'P' } })
    .mockResolvedValueOnce({ ok: true, project_id: 'P', version: '10:2', project: { projectId: 'P', billingEntityId: 'B' } });
  render(<SupportQuotationDialog {...props({ project: { ...project, billingEntityId: 'B' } })} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
  // The stale prop is not preselected; the user explicitly chooses B and that choice is persisted.
  await waitFor(() => expect(screen.getAllByLabelText('Billing entity')[0]).toHaveValue('company'));
  fireEvent.change(screen.getAllByLabelText('Billing entity')[0], { target: { value: 'B' } });
  fireEvent.change(screen.getAllByRole('spinbutton')[2], { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate quotation PDF' }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith({ kind: 'support_billing_entity', billing_entity_id: 'B' }));
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
  expect(mocks.submit.mock.invocationCallOrder[0]).toBeLessThan(mocks.prepare.mock.invocationCallOrder[0]);
});

it('keeps the billing request pending when the confirming route read fails', async () => {
  mocks.submit.mockResolvedValue({ ok: true });
  mocks.load.mockResolvedValueOnce({ ok: true, project_id: 'P', version: '10:1', project: { projectId: 'P', billingEntityId: 'company' } });
  render(<SupportQuotationDialog {...props()} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
  mocks.load.mockRejectedValueOnce(new Error('Fresh route read failed'));
  fireEvent.change(screen.getAllByLabelText('Billing entity')[0], { target: { value: 'B' } });
  fireEvent.change(screen.getAllByRole('spinbutton')[2], { target: { value: '100' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate quotation PDF' }));
  expect(await screen.findByRole('button', { name: 'Check saved billing change' })).toBeInTheDocument();
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
});

it('applies the legacy billing fallback when settings arrive after the native opening', async () => {
  mocks.deferEntities = true;
  mocks.load.mockResolvedValueOnce({ ok: true, project_id: 'P', version: '10:1', project: { projectId: 'P' } });
  render(<SupportQuotationDialog {...props({ project: { ...project, billingEntityId: undefined }, ticket: { ...ticket, quotation: undefined } })} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getAllByLabelText('Billing entity')[0]).not.toBeDisabled());
  mocks.entityCallback([{ id: 'B', displayName: 'Branch', gstin: 'B' }]);
  await waitFor(() => expect(screen.getAllByLabelText('Billing entity')[0]).toHaveValue('B'));
});

it('ignores an opening response from the previous project after switching projects', async () => {
  let releaseOld: ((value: any) => void) | undefined;
  mocks.factory.mockImplementation((projectId: string) => ({
    load: projectId === 'P' ? () => new Promise(resolve => { releaseOld = resolve; }) : async () => ({ ok: true, project_id: 'Q', version: '4:0', project: { projectId: 'Q', billingEntityId: 'company' } }),
    capture: mocks.capture, recover: () => null, invalidate: mocks.invalidate,
  }));
  const view = render(<SupportQuotationDialog {...props()} />);
  await waitFor(() => expect(releaseOld).toBeDefined());
  view.rerender(<SupportQuotationDialog {...props({ project: { ...project, projectId: 'Q', billingEntityId: 'company' } })} />);
  await waitFor(() => expect(mocks.factory).toHaveBeenCalledWith('Q'));
  await act(async () => { releaseOld?.({ ok: true, project_id: 'P', version: '10:1', project: { projectId: 'P', billingEntityId: 'B' } }); });
  await waitFor(() => expect(screen.getAllByLabelText('Billing entity')[0]).toHaveValue('company'));
});

const fillQuote = () => {
  fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Site visit' } });
  fireEvent.change(screen.getAllByRole('spinbutton')[2], { target: { value: '100' } });
};
const routeSelect = () => screen.getAllByLabelText('Billing entity')[0];

it('shows the recovery control before the first billing request settles and keeps it after a transport failure', async () => {
  let fail!: (error: Error) => void;
  mocks.submit.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  render(<SupportQuotationDialog {...props()} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
  fireEvent.change(routeSelect(), { target: { value: 'B' } });
  fillQuote();
  fireEvent.click(screen.getByRole('button', { name: 'Generate quotation PDF' }));
  expect(await screen.findByRole('button', { name: 'Check saved billing change' })).toBeInTheDocument();
  await act(async () => { fail(new Error('network down')); });
  expect(screen.getByRole('button', { name: 'Check saved billing change' })).toBeInTheDocument();
  expect(routeSelect()).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Generate quotation PDF' })).toBeDisabled();
  expect(mocks.prepare).not.toHaveBeenCalled();
});

it('does not release the saved billing request when the confirming read fails after the commit', async () => {
  render(<SupportQuotationDialog {...props()} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
  mocks.load.mockRejectedValueOnce(new Error('Fresh route read failed'));
  fireEvent.change(routeSelect(), { target: { value: 'B' } });
  fillQuote();
  fireEvent.click(screen.getByRole('button', { name: 'Generate quotation PDF' }));
  expect(await screen.findByRole('button', { name: 'Check saved billing change' })).toBeInTheDocument();
  expect(mocks.acknowledge).not.toHaveBeenCalled();
  expect(mocks.journal).toEqual({ kind: 'support_billing_entity', billing_entity_id: 'B' });
  expect(mocks.prepare).not.toHaveBeenCalled();
});

it('drops back to an editable form when the billing request never reached the saved journal', async () => {
  mocks.submit.mockImplementationOnce(async () => { mocks.journal = undefined; throw new Error('Unable to save this project request in browser session storage.'); });
  render(<SupportQuotationDialog {...props()} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
  fireEvent.change(routeSelect(), { target: { value: 'B' } });
  fillQuote();
  fireEvent.click(screen.getByRole('button', { name: 'Generate quotation PDF' }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not prepare quotation' })));
  expect(screen.queryByRole('button', { name: 'Check saved billing change' })).not.toBeInTheDocument();
  expect(mocks.prepare).not.toHaveBeenCalled();
});

it('shows the saved route of a recovered request, blocks edits and releases it only after a fresh read', async () => {
  mocks.native = false; mocks.scoped = true;
  mocks.journal = { kind: 'support_billing_entity', billing_entity_id: 'B' };
  mocks.resolve.mockResolvedValue({ resolution: 'committed' });
  const action = { submit: mocks.submit, resolve: mocks.resolve, acknowledge: (...args: any[]) => { const result = mocks.acknowledge(...args); mocks.journal = undefined; return result; }, get pendingCommand() { return mocks.journal; } };
  mocks.factory.mockReturnValue({ load: mocks.load, capture: mocks.capture, recover: vi.fn(() => action), invalidate: mocks.invalidate });
  render(<SupportQuotationDialog {...props()} />);
  await waitFor(() => expect(routeSelect()).toHaveValue('B'));
  expect(routeSelect()).toBeDisabled();
  mocks.load.mockRejectedValueOnce(new Error('Fresh read failed'));
  fireEvent.click(await screen.findByRole('button', { name: 'Check saved billing change' }));
  expect(await screen.findByText('Fresh read failed')).toBeInTheDocument();
  expect(mocks.acknowledge).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Check saved billing change' })).toBeInTheDocument();
  mocks.load.mockResolvedValueOnce({ ok: true, project_id: 'P', version: '10:3', project: { projectId: 'P', billingEntityId: 'B' } });
  fireEvent.click(screen.getByRole('button', { name: 'Check saved billing change' }));
  await waitFor(() => expect(mocks.acknowledge).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Check saved billing change' })).not.toBeInTheDocument());
  expect(mocks.resolve).toHaveBeenCalledTimes(2);
  expect(mocks.prepare).not.toHaveBeenCalled();
});

it('lets delayed billing settings fill the fallback but never override a user choice or an authoritative route', async () => {
  mocks.deferEntities = true;
  mocks.load.mockResolvedValueOnce({ ok: true, project_id: 'P', version: '10:1', project: { projectId: 'P' } });
  const view = render(<SupportQuotationDialog {...props({ project: { ...project, billingEntityId: undefined }, ticket: { ...ticket, quotation: undefined } })} />);
  await waitFor(() => expect(routeSelect()).not.toBeDisabled());
  act(() => mocks.entityCallback([{ id: 'company', displayName: 'Company', gstin: 'A' }, { id: 'B', displayName: 'Branch', gstin: 'B' }]));
  await waitFor(() => expect(routeSelect()).toHaveValue('company'));
  fireEvent.change(routeSelect(), { target: { value: 'B' } });
  act(() => mocks.entityCallback([{ id: 'X', displayName: 'Other', gstin: 'X' }, { id: 'company', displayName: 'Company', gstin: 'A' }, { id: 'B', displayName: 'Branch', gstin: 'B' }]));
  expect(routeSelect()).toHaveValue('B');
  view.unmount();

  mocks.load.mockResolvedValueOnce({ ok: true, project_id: 'P', version: '10:1', project: { projectId: 'P', billingEntityId: 'B' } });
  render(<SupportQuotationDialog {...props({ project: { ...project, billingEntityId: undefined }, ticket: { ...ticket, quotation: undefined } })} />);
  act(() => mocks.entityCallback([{ id: 'company', displayName: 'Company', gstin: 'A' }, { id: 'B', displayName: 'Branch', gstin: 'B' }]));
  await waitFor(() => expect(routeSelect()).not.toBeDisabled());
  act(() => mocks.entityCallback([{ id: 'X', displayName: 'Other', gstin: 'X' }, { id: 'company', displayName: 'Company', gstin: 'A' }, { id: 'B', displayName: 'Branch', gstin: 'B' }]));
  expect(routeSelect()).toHaveValue('B');
});

it('keeps the scoped-read authoritative route when the Support writer is off and the project prop is stale', async () => {
  mocks.native = false; mocks.scoped = true;
  mocks.load.mockResolvedValueOnce({ ok: true, project_id: 'P', version: '10:1', project: { projectId: 'P', billingEntityId: 'B' } });
  render(<SupportQuotationDialog {...props({ project: { ...project, billingEntityId: 'company' } })} />);
  await waitFor(() => expect(routeSelect()).toHaveValue('B'));
  expect(mocks.update).not.toHaveBeenCalled();
});

it('does not let a billing submit from a previous project (A-B-A) update, release or prepare for the visible form', async () => {
  let release!: (value: any) => void;
  mocks.submit.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const view = render(<SupportQuotationDialog {...props()} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
  fireEvent.change(routeSelect(), { target: { value: 'B' } });
  fillQuote();
  fireEvent.click(screen.getByRole('button', { name: 'Generate quotation PDF' }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
  view.rerender(<SupportQuotationDialog {...props({ project: { ...project, projectId: 'Q' } })} />);
  view.rerender(<SupportQuotationDialog {...props()} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(3));
  await act(async () => { release({ ok: true }); });
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.close).not.toHaveBeenCalled();
  expect(mocks.acknowledge).not.toHaveBeenCalled();
});

it('falls back from an absent native route to the prior quotation route, never to a stale project prop, and writes it', async () => {
  mocks.load.mockResolvedValueOnce({ ok: true, project_id: 'P', version: '10:1', project: { projectId: 'P' } })
    .mockResolvedValueOnce({ ok: true, project_id: 'P', version: '10:2', project: { projectId: 'P', billingEntityId: 'Q' } });
  render(<SupportQuotationDialog {...props({ project: { ...project, billingEntityId: 'B' }, ticket: { ...ticket, quotation: { billingEntityId: 'Q', lines: [], taxType: 'igst', taxPercent: 18 } } })} />);
  await waitFor(() => expect(routeSelect()).toHaveValue('Q'));
  fillQuote();
  fireEvent.click(screen.getByRole('button', { name: 'Generate quotation PDF' }));
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
  expect(mocks.submit).toHaveBeenCalledOnce();
  expect(mocks.submit).toHaveBeenCalledWith({ kind: 'support_billing_entity', billing_entity_id: 'Q' });
  expect(mocks.prepare.mock.calls[0][0]).toMatchObject({ billingEntityId: 'Q' });
});

it('falls back from an absent native route with no prior quotation to the company route, ignoring a stale project prop', async () => {
  mocks.load.mockResolvedValueOnce({ ok: true, project_id: 'P', version: '10:1', project: { projectId: 'P' } })
    .mockResolvedValueOnce({ ok: true, project_id: 'P', version: '10:2', project: { projectId: 'P', billingEntityId: 'company' } });
  render(<SupportQuotationDialog {...props({ project: { ...project, billingEntityId: 'B' } })} />);
  await waitFor(() => expect(routeSelect()).toHaveValue('company'));
  fillQuote();
  fireEvent.click(screen.getByRole('button', { name: 'Generate quotation PDF' }));
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
  expect(mocks.submit).toHaveBeenCalledWith({ kind: 'support_billing_entity', billing_entity_id: 'company' });
  expect(mocks.submit).not.toHaveBeenCalledWith({ kind: 'support_billing_entity', billing_entity_id: 'B' });
});

it('keeps a recovered pending route on screen when a different default arrives later, without writing or preparing', async () => {
  mocks.native = false; mocks.scoped = true; mocks.deferEntities = true;
  mocks.journal = { kind: 'support_billing_entity', billing_entity_id: 'B' };
  const action = { submit: mocks.submit, resolve: mocks.resolve, acknowledge: mocks.acknowledge, get pendingCommand() { return mocks.journal; } };
  mocks.load.mockResolvedValueOnce({ ok: true, project_id: 'P', version: '10:1', project: { projectId: 'P' } });
  mocks.factory.mockReturnValue({ load: mocks.load, capture: mocks.capture, recover: vi.fn(() => action), invalidate: mocks.invalidate });
  render(<SupportQuotationDialog {...props({ project: { ...project, billingEntityId: undefined }, ticket: { ...ticket, quotation: undefined } })} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
  await screen.findByRole('button', { name: 'Check saved billing change' });
  act(() => mocks.entityCallback([{ id: 'A', displayName: 'Default', gstin: 'A' }, { id: 'company', displayName: 'Company', gstin: 'C' }, { id: 'B', displayName: 'Branch', gstin: 'B' }]));
  await waitFor(() => expect(routeSelect()).toHaveValue('B'));
  act(() => mocks.entityCallback([{ id: 'A', displayName: 'Default', gstin: 'A' }, { id: 'B', displayName: 'Branch', gstin: 'B' }]));
  expect(routeSelect()).toHaveValue('B');
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.prepare).not.toHaveBeenCalled();
});

it('uses a fresh captured request at the confirmed version for a second route edit after a failed preparation', async () => {
  mocks.load.mockResolvedValueOnce({ ok: true, project_id: 'P', version: '10:1', project: { projectId: 'P', billingEntityId: 'company' } })
    .mockResolvedValueOnce({ ok: true, project_id: 'P', version: '10:2', project: { projectId: 'P', billingEntityId: 'B' } })
    .mockResolvedValueOnce({ ok: true, project_id: 'P', version: '10:3', project: { projectId: 'P', billingEntityId: 'company' } });
  mocks.prepare.mockRejectedValueOnce(new Error('PDF service unavailable'));
  render(<SupportQuotationDialog {...props()} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledOnce());
  fireEvent.change(routeSelect(), { target: { value: 'B' } });
  fillQuote();
  fireEvent.click(screen.getByRole('button', { name: 'Generate quotation PDF' }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'PDF service unavailable' })));
  expect(mocks.actions).toHaveLength(2);
  expect(mocks.actions[0].sent).toEqual([{ kind: 'support_billing_entity', billing_entity_id: 'B' }]);
  expect(routeSelect()).toHaveValue('B');
  fireEvent.change(routeSelect(), { target: { value: 'company' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate quotation PDF' }));
  await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(2));
  expect(mocks.actions[1].sent).toEqual([{ kind: 'support_billing_entity', billing_entity_id: 'company' }]);
  expect(mocks.actions[0].sent).toHaveLength(1);
  expect(mocks.prepare.mock.calls[1][0]).toMatchObject({ billingEntityId: 'company' });
  expect(mocks.acknowledge).toHaveBeenCalledTimes(2);
});
