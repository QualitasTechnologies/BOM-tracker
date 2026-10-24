import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ProjectCostBar from '../ProjectCostBar';

it('keeps the budget draft editable after a versioned save fails so the same request can be retried', async () => {
  const onUpdateBudget = vi.fn().mockRejectedValueOnce(new Error('The project changed while this edit was open.'));
  render(<ProjectCostBar budget={500000} bomCost={10} overheadCost={0} canEdit onUpdateBudget={onUpdateBudget} />);
  fireEvent.click(screen.getByTitle('Set budget'));
  const input = screen.getByPlaceholderText('e.g. 500000');
  fireEvent.change(input, { target: { value: '650000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));
  await waitFor(() => expect(screen.getByText('The project changed while this edit was open.')).toBeInTheDocument());
  expect(screen.getByPlaceholderText('e.g. 500000')).toHaveValue(650000);
  expect(onUpdateBudget).toHaveBeenCalledWith(650000);
});

it('freezes the visible amount and exposes resolution while a budget request is pending', async () => {
  const onResolvePendingRequest = vi.fn().mockRejectedValueOnce(new Error('Fresh project read failed'));
  render(<ProjectCostBar budget={500000} bomCost={10} overheadCost={0} canEdit hasPendingRequest pendingBudget={650000} onResolvePendingRequest={onResolvePendingRequest} onUpdateBudget={vi.fn()} />);
  expect(screen.queryByTitle('Set budget')).not.toBeInTheDocument();
  expect(screen.getByText(/Saved amount: ₹6,?50,?000/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Check saved change' }));
  await waitFor(() => expect(screen.getByText('Fresh project read failed')).toBeInTheDocument());
  expect(onResolvePendingRequest).toHaveBeenCalledOnce();
});
