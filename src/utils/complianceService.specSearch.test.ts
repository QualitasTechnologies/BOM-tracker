import { beforeEach, describe, expect, it, vi } from 'vitest';

const { httpsCallableMock, callableResult } = vi.hoisted(() => ({
  httpsCallableMock: vi.fn(),
  callableResult: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: httpsCallableMock,
}));

vi.mock('@/firebase', () => ({ functions: {} }));

import { triggerSpecSearch } from './complianceService';

describe('triggerSpecSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('crypto', { randomUUID: () => '550e8400-e29b-41d4-a716-446655440000' });
    httpsCallableMock.mockReturnValue(callableResult);
    callableResult.mockResolvedValue({
      data: {
        ok: true,
        operation_id: '550e8400-e29b-41d4-a716-446655440000',
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
      operation_id: '550e8400-e29b-41d4-a716-446655440000',
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
      searchId: '550e8400-e29b-41d4-a716-446655440000',
      status: 'completed',
      specificationUrl: 'https://vendor.example/spec.pdf',
    });
  });
});
