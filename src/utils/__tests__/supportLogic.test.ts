import { describe, expect, it } from 'vitest';
import type { SupportProjectProfile, SupportTicket } from '@/types/support';
import {
  calculateSupportTargets,
  defaultCommercialStatus,
  determineCoverage,
  getInstalledMachines,
  needsCommercialAction,
  shouldShowInvoiceTracking,
  getTransitionBlocker,
  validatePaymentTracking,
} from '../supportLogic';

describe('support coverage', () => {
  const profile: SupportProjectProfile = {
    warrantyStartDate: '2026-01-01',
    warrantyEndDate: '2026-12-31',
    amcStatus: 'active',
    amcStartDate: '2027-01-01',
    amcEndDate: '2027-12-31',
  };

  it('detects warranty, AMC and out-of-coverage periods', () => {
    expect(determineCoverage(profile, new Date('2026-07-01'))).toBe('warranty');
    expect(determineCoverage(profile, new Date('2027-07-01'))).toBe('amc');
    expect(determineCoverage(profile, new Date('2028-07-01'))).toBe('chargeable');
  });

  it('maps coverage to a safe commercial default', () => {
    expect(defaultCommercialStatus('warranty')).toBe('not-required');
    expect(defaultCommercialStatus('amc')).toBe('not-required');
    expect(defaultCommercialStatus('chargeable')).toBe('quotation-required');
    expect(defaultCommercialStatus('undetermined')).toBe('assessment-required');
  });

  it('uses machine-specific coverage and adapts legacy machine fields', () => {
    const machine = {
      id: 'line-1',
      name: 'Line 1',
      serialNumber: 'BVS4-001',
      warrantyStartDate: '2026-01-01',
      warrantyEndDate: '2026-06-30',
    };
    expect(determineCoverage(profile, new Date('2026-07-01'), machine)).toBe('chargeable');
    expect(getInstalledMachines({ machineModel: 'Legacy system', machineSerialNumber: 'LEG-1' }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ serialNumber: 'LEG-1' })]));
  });
});

describe('support workflow', () => {
  it('uses shorter targets for critical tickets', () => {
    const from = new Date('2026-07-31T10:00:00Z');
    const critical = calculateSupportTargets('critical', from);
    const medium = calculateSupportTargets('medium', from);
    expect(critical.firstResponseTargetAt.getTime()).toBeLessThan(
      medium.firstResponseTargetAt.getTime(),
    );
    expect(critical.resolutionTargetAt.getTime()).toBeLessThan(
      medium.resolutionTargetAt.getTime(),
    );
  });

  it('gates chargeable work and formal closure', () => {
    const ticket = {
      coverageType: 'chargeable',
      commercialStatus: 'quotation-sent',
      customerConfirmation: 'pending',
    } as SupportTicket;

    expect(getTransitionBlocker(ticket, 'in-progress')).toMatch(/acceptance/i);
    expect(getTransitionBlocker(ticket, 'resolved')).toMatch(/root cause/i);

    const documented = {
      ...ticket,
      commercialStatus: 'accepted',
      rootCause: 'Lighting controller failed.',
      correctiveAction: 'Controller replaced.',
      resolutionSummary: 'Inspection restored.',
    } as SupportTicket;
    expect(getTransitionBlocker(documented, 'in-progress')).toBeNull();
    expect(getTransitionBlocker(documented, 'closed')).toMatch(/customer confirmation/i);
  });

  it('supports invoice tracking after an external quotation and customer PO', () => {
    const ticket = {
      coverageType: 'chargeable',
      commercialStatus: 'accepted',
      status: 'resolved',
      paymentStatus: 'not-invoiced',
      estimatedAmount: 24544,
    } as SupportTicket;

    expect(shouldShowInvoiceTracking(ticket)).toBe(true);
    expect(needsCommercialAction(ticket)).toBe(true);

    expect(needsCommercialAction({
      ...ticket,
      commercialStatus: 'invoiced',
      paymentStatus: 'invoice-raised',
    })).toBe(true);
    expect(needsCommercialAction({
      ...ticket,
      commercialStatus: 'invoiced',
      paymentStatus: 'paid',
      amountReceived: 24544,
    })).toBe(false);
  });

  it('validates invoice and payment milestones', () => {
    const invoiceRaised = {
      paymentStatus: 'invoice-raised' as const,
      invoiceNumber: '',
      invoiceDate: '2026-08-10',
      invoiceDueDate: '2026-08-25',
      invoiceAmount: 24544,
      amountReceived: 0,
      paymentReceivedDate: '',
      paymentReference: '',
    };
    expect(validatePaymentTracking(invoiceRaised)).toMatch(/invoice number/i);
    expect(validatePaymentTracking({
      ...invoiceRaised,
      invoiceNumber: 'QT/26-27/001',
    })).toBeNull();
    expect(validatePaymentTracking({
      ...invoiceRaised,
      paymentStatus: 'paid',
      invoiceNumber: 'QT/26-27/001',
      amountReceived: 20000,
      paymentReceivedDate: '2026-08-20',
      paymentReference: 'UTR-1',
    })).toMatch(/below the invoice total/i);
  });
});
