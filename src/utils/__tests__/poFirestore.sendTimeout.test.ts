import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; options: unknown; payload: unknown }>,
}));

vi.mock('@/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string, options?: unknown) => async (payload: unknown) => {
    mocks.calls.push({ name, options, payload });
    return { data: { success: true, ok: true, phase: 'complete', released: true, message: 'sent', pdfUrl: '' } };
  },
}));

import type { PurchaseOrder } from '@/types/purchaseOrder';
import {
  recoverAcceptedLegacyPOSend,
  recoverStaleLegacyPOSend,
  retryUncertainLegacyPOSend,
  sendPOEmail,
  sendPurchaseOrder,
  type SendPOEmailInput,
} from '../poFirestore';

// @firebase/functions defaults to a 70s client timeout. Server callables that may run longer (timeoutSeconds: 540 in
// functions/index.js) must pass the same limit or the user sees deadline-exceeded while the server is still finishing.
const SERVER_540S = 540_000;

const purchaseOrder: PurchaseOrder = {
  id: 'po1', projectId: 'p1', poNumber: 'PO-QT-2026-001',
  vendorId: 'v1', vendorName: 'Acme', vendorAddress: '1 Main St', vendorGstin: '29ABCDE1234F1Z5',
  vendorStateCode: '29', vendorStateName: 'Karnataka', vendorEmail: 'vendor@acme.com',
  projectReference: 'P1',
  invoiceToCompany: 'Buyer Co', invoiceToAddress: '2 Side St', invoiceToGstin: '29ABCDE1234F1Z5',
  invoiceToStateCode: '29', invoiceToStateName: 'Karnataka', shipToAddress: '2 Side St',
  items: [{ bomItemId: 'b1', slNo: 1, description: 'Sensor', uom: 'nos', quantity: 2, rate: 100, amount: 200 }],
  subtotal: 200, taxType: 'cgst_sgst', taxPercentage: 18, cgstAmount: 18, sgstAmount: 18, totalAmount: 236,
  amountInWords: 'Two Hundred Thirty Six Rupees Only', currency: 'INR',
  paymentTerms: '100% in 30 days', deliveryTerms: '2-4 weeks', includeAnnexure: false,
  poDate: new Date('2026-10-01T00:00:00.000Z'), status: 'pending-approval', warnings: [],
  createdAt: new Date('2026-10-01T00:00:00.000Z'), createdBy: 'u1', updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};
const sendInput: SendPOEmailInput = {
  purchaseOrder,
  companySettings: {
    companyName: 'Buyer Co', companyAddress: '2 Side St', gstin: '29ABCDE1234F1Z5', stateCode: '29', stateName: 'Karnataka',
  },
  recipientEmail: 'vendor@acme.com',
};

describe('PO callable client timeouts', () => {
  beforeEach(() => { mocks.calls.length = 0; });

  it('sendPOEmail waits as long as the sendPurchaseOrder server limit', async () => {
    await sendPOEmail(sendInput);
    expect(mocks.calls).toEqual([{
      name: 'sendPurchaseOrder', options: { timeout: SERVER_540S },
      payload: { ...sendInput, serverMaterialFinalizationVersion: 1 },
    }]);
  });

  it('sendPOEmail attaches the material-finalization marker itself; callers cannot override it', async () => {
    await sendPOEmail({ ...sendInput, serverMaterialFinalizationVersion: 0 } as unknown as SendPOEmailInput);
    expect((mocks.calls[0].payload as { serverMaterialFinalizationVersion: number }).serverMaterialFinalizationVersion).toBe(1);
  });

  it('retryUncertainLegacyPOSend waits as long as the retryUncertainLegacyPOSend server limit', async () => {
    await retryUncertainLegacyPOSend('p1', 'po1', 'attempt-1');
    expect(mocks.calls).toEqual([{
      name: 'retryUncertainLegacyPOSend', options: { timeout: SERVER_540S },
      payload: { project_id: 'p1', po_id: 'po1', attempt_id: 'attempt-1' },
    }]);
  });

  it('keeps the SDK default for callables whose server limit is under 70s', async () => {
    await sendPurchaseOrder('p1', 'po1', { sentBy: 'a', sentToEmail: 'v@acme.com', actualSentDate: '2026-10-18' }, 'op_1');
    await recoverStaleLegacyPOSend('p1', 'po1', 'attempt-1');
    await recoverAcceptedLegacyPOSend('p1', 'po1', 'attempt-1');
    expect(mocks.calls.map(c => [c.name, c.options])).toEqual([
      ['legacyMarkPurchaseOrderSent', undefined],
      ['recoverStaleLegacyPOSend', undefined],
      ['recoverAcceptedLegacyPOSend', undefined],
    ]);
  });
});
