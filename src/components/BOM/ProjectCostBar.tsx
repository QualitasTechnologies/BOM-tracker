import { useState } from 'react';
import { Pencil, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
  budget?: number;
  bomCost: number;
  overheadCost: number;
  canEdit: boolean;
  onUpdateBudget: (budget: number | undefined) => Promise<void>;
}

const INR = (n: number) =>
  `₹${Math.round(n).toLocaleString('en-IN')}`;

const ProjectCostBar = ({ budget, bomCost, overheadCost, canEdit, onUpdateBudget }: Props) => {
  const [editing, setEditing] = useState(false);
  const [draftBudget, setDraftBudget] = useState('');
  const [saving, setSaving] = useState(false);

  const totalSpent = bomCost + overheadCost;
  const remaining = budget != null ? budget - totalSpent : undefined;
  const pct = budget != null && budget > 0 ? Math.min(100, (totalSpent / budget) * 100) : 0;
  const over = remaining != null && remaining < 0;

  const barColor = over
    ? 'bg-red-500'
    : pct > 80
    ? 'bg-amber-400'
    : 'bg-emerald-500';

  const startEdit = () => {
    setDraftBudget(budget != null ? String(budget) : '');
    setEditing(true);
  };

  const cancelEdit = () => { setEditing(false); setDraftBudget(''); };

  const commitEdit = async () => {
    const val = draftBudget.trim();
    const parsed = val === '' ? undefined : parseFloat(val);
    if (parsed !== undefined && (isNaN(parsed) || parsed < 0)) return;
    setSaving(true);
    await onUpdateBudget(parsed);
    setSaving(false);
    setEditing(false);
  };

  return (
    <div className="rounded-xl border bg-white shadow-sm mb-5 overflow-hidden">
      {/* Budget heading */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Project Budget</span>
          {editing ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">₹</span>
              <Input
                autoFocus
                type="number"
                min={0}
                step={1000}
                className="h-7 w-36 text-sm"
                placeholder="e.g. 500000"
                value={draftBudget}
                onChange={e => setDraftBudget(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
              />
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={commitEdit} disabled={saving}>
                <Check size={13} className="text-emerald-600" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={cancelEdit}>
                <X size={13} />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-gray-800">
                {budget != null ? INR(budget) : <span className="text-gray-400 font-normal">Not set</span>}
              </span>
              {canEdit && (
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 opacity-50 hover:opacity-100" onClick={startEdit} title="Set budget">
                  <Pencil size={11} />
                </Button>
              )}
            </div>
          )}
        </div>

        {budget != null && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${over ? 'bg-red-100 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
            {over ? `${INR(Math.abs(remaining!))} over budget` : `${INR(remaining!)} remaining`}
          </span>
        )}
      </div>

      {/* Cost breakdown */}
      <div className="grid grid-cols-3 divide-x">
        <CostCard label="BOM Material & Services" value={bomCost} />
        <CostCard label="Overheads" value={overheadCost} />
        <CostCard
          label="Total Spent"
          value={totalSpent}
          highlight
          extra={budget != null ? `${pct.toFixed(0)}% of budget` : undefined}
          danger={over}
        />
      </div>

      {/* Progress bar */}
      {budget != null && budget > 0 && (
        <div className="px-4 py-2.5 bg-gray-50 border-t">
          <div className="flex justify-between text-[10px] text-gray-400 mb-1">
            <span>₹0</span>
            <span>{INR(budget)}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[10px] text-gray-400 mt-1 text-right">{pct.toFixed(1)}% of budget used</p>
        </div>
      )}
    </div>
  );
};

interface CostCardProps {
  label: string;
  value: number;
  highlight?: boolean;
  extra?: string;
  danger?: boolean;
}

const CostCard = ({ label, value, highlight, extra, danger }: CostCardProps) => (
  <div className={`px-4 py-3 ${highlight ? 'bg-gray-50' : ''}`}>
    <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">{label}</p>
    <p className={`text-lg font-semibold ${danger ? 'text-red-600' : highlight ? 'text-gray-900' : 'text-gray-700'}`}>
      {`₹${Math.round(value).toLocaleString('en-IN')}`}
    </p>
    {extra && <p className="text-[10px] text-gray-400 mt-0.5">{extra}</p>}
  </div>
);

export default ProjectCostBar;
