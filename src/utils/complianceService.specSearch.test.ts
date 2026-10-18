import { beforeEach, describe, expect, it, vi } from 'vitest';

const { httpsCallableMock, callableResult } = vi.hoisted(() => ({
  httpsCallableMock: vi.fn(),
  callableResult: vi.fn(),
}));

let operationSequence = 0;
const firstOperationId = '550e8400-e29b-41d4-a716-446655440000';
const secondOperationId = '550e8400-e29b-41d4-a716-446655440001';

vi.mock('firebase/functions', () => ({
  httpsCallable: httpsCallableMock,
}));

vi.mock('@/firebase', () => ({ functions: {} }));

import { triggerSpecSearch } from './complianceService';

describe('triggerSpecSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    operationSequence = 0;
    vi.stubGlobal('crypto', {
      randomUUID: () => operationSequence++ === 0 ? firstOperationId : secondOperationId,
    });
    window.localStorage.clear();
    httpsCallableMock.mockReturnValue(callableResult);
    callableResult.mockResolvedValue({
      data: {
        ok: true,
        operation_id: firstOperationId,
        state: 'completed',
        specificationUrl: 'https://vendor.example/spec.pdf',
      },
    });
  });

  it('dispatches through the protected callable using only project, item, operation, and authenticated actor IDs', async () => {
    await triggerSpecSearch({
      bomItemId: 'item-1',
      projectId: 'project-1',
      itemName: 'Valve',
      make: 'Acme',
      sku: 'V-100',
      userId: 'firebase-uid-1',
    });

    expect(httpsCallableMock).toHaveBeenCalledWith({}, 'nativeSpecSearchOperation');
    expect(callableResult).toHaveBeenCalledWith({
      project_id: 'project-1',
      item_id: 'item-1',
      operation_id: firstOperationId,
      expected_actor_uid: 'firebase-uid-1',
    });
  });

  it('maps the protected completed result to the existing button response shape', async () => {
    const response = await triggerSpecSearch({
      bomItemId: 'item-1',
      projectId: 'project-1',
      itemName: 'Valve',
      userId: 'firebase-uid-1',
    });

    expect(response).toMatchObject({
      success: true,
      searchId: firstOperationId,
      status: 'completed',
      specificationUrl: 'https://vendor.example/spec.pdf',
    });
  });

  it('reuses the same operation ID after a lost response', async () => {
    callableResult
      .mockRejectedValueOnce(new Error('network response was lost'))
      .mockResolvedValueOnce({ data: {
        ok: true,
        operation_id: firstOperationId,
        state: 'completed',
        specificationUrl: 'https://vendor.example/spec.pdf',
      } });
    const request = {
      bomItemId: 'item-1',
      projectId: 'retry-project',
      itemName: 'Valve',
      userId: 'retry-user',
    };

    await expect(triggerSpecSearch(request)).rejects.toThrow('network response was lost');
    expect(window.localStorage.getItem('bom:spec-search:pending:retry-user:retry-project:item-1'))
      .toBe(firstOperationId);
    await triggerSpecSearch(request);

    expect(window.localStorage.getItem('bom:spec-search:pending:retry-user:retry-project:item-1'))
      .toBeNull();
    expect(callableResult.mock.calls.map(([payload]) => payload.operation_id))
      .toEqual([firstOperationId, firstOperationId]);
  });

  it('allows a fresh operation after a terminal response', async () => {
    const request = {
      bomItemId: 'item-1',
      projectId: 'terminal-project',
      itemName: 'Valve',
      userId: 'terminal-user',
    };
    await triggerSpecSearch(request);
    callableResult.mockResolvedValue({ data: {
      ok: true,
      operation_id: secondOperationId,
      state: 'completed',
      specificationUrl: 'https://vendor.example/spec.pdf',
    } });
    await triggerSpecSearch(request);

    expect(callableResult.mock.calls.map(([payload]) => payload.operation_id))
      .toEqual([firstOperationId, secondOperationId]);
  });
});
