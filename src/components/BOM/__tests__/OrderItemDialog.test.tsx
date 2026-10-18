import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BOMItem } from '@/types/bom';
import type { Vendor } from '@/utils/settingsFirestore';
import type { ProjectDocument } from '@/types/projectDocument';
import OrderItemDialog from '../OrderItemDialog';

vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/firebase', () => ({ auth: { currentUser: { uid: 'user-1' } } }));
vi.mock('@/utils/projectDocumentFirestore', () => ({
  uploadProjectDocument: vi.fn(),
  linkDocumentToBOMItems: vi.fn(),
}));
vi.mock('@/utils/nativeMaterialCommands', () => ({ isNativeMaterialCommandEnabled: () => true }));
vi.mock('@/components/ui/dialog', () => {
  const Wrap = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children?: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null,
    DialogContent: Wrap, DialogHeader: Wrap, DialogFooter: Wrap, DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
  };
});

const vendor = { id: 'v1', company: 'Acme', type: 'OEM', status: 'active', leadTime: '14 days' } as Vendor;
const poDoc = { id: 'po-doc-1', name: 'po.pdf' } as ProjectDocument;
const baseItem = {
  id: 'item-1', name: 'Servo', quantity: 2, status: 'not-ordered',
  poNumber: 'PO-1', linkedPODocumentId: 'po-doc-1',
  finalizedVendor: { name: 'Acme', price: 10, leadTime: '14 days', availability: 'In Stock' },
} as BOMItem;

const renderDialog = (item: BOMItem) => {
  const onConfirm = vi.fn();
  render(
    <OrderItemDialog
      open onOpenChange={vi.fn()} item={item} projectId="p1"
      availablePODocuments={[poDoc]} vendors={[vendor]} onConfirm={onConfirm}
    />,
  );
  return onConfirm;
};
const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'Mark as Ordered' }));
const field = (id: string) => document.getElementById(id) as HTMLInputElement;

describe('OrderItemDialog dates', () => {
  beforeEach(() => vi.useRealTimers());

  it('does not default a missing order date to today', () => {
    renderDialog(baseItem);
    expect(field('orderDate').value).toBe('');
  });

  it('does not guess expected arrival from vendor lead time', () => {
    renderDialog({ ...baseItem, orderDate: '2026-03-01' });
    expect(field('expectedArrival').value).toBe('');
    expect(screen.queryByText(/Calculated:/)).toBeNull();
  });

  it('preserves existing order date and expected arrival', () => {
    const onConfirm = renderDialog({ ...baseItem, orderDate: '2026-03-01', expectedArrival: '2026-03-20' });
    expect(field('orderDate').value).toBe('2026-03-01');
    expect(field('expectedArrival').value).toBe('2026-03-20');
    confirm();
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ orderDate: '2026-03-01', expectedArrival: '2026-03-20' }));
  });

  it('allows missing dates and shows "Date not set" for each', () => {
    renderDialog(baseItem);
    expect(screen.getAllByText('Date not set')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Mark as Ordered' })).toBeEnabled();
  });

  it('hides "Date not set" once a date is entered', () => {
    renderDialog(baseItem);
    fireEvent.change(field('expectedArrival'), { target: { value: '2026-04-01' } });
    expect(screen.getAllByText('Date not set')).toHaveLength(1);
  });

  it('submits unset dates as null, not empty strings', () => {
    const onConfirm = renderDialog(baseItem);
    confirm();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const payload = onConfirm.mock.calls[0][0];
    expect(payload.orderDate).toBeNull();
    expect(payload.expectedArrival).toBeNull();
  });

  it('submits a date the user clears as null', () => {
    const onConfirm = renderDialog({ ...baseItem, orderDate: '2026-03-01', expectedArrival: '2026-03-20' });
    fireEvent.change(field('expectedArrival'), { target: { value: '' } });
    confirm();
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ orderDate: '2026-03-01', expectedArrival: null }));
  });
});
