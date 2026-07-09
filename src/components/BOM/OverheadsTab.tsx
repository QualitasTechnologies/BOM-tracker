import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Pencil, Trash2, Plane, Receipt, ChevronDown, ChevronUp,
  Paperclip, CheckCircle, XCircle, Clock, Send, Loader2, FilePenLine,
} from 'lucide-react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import LogTravelVisitDialog from './LogTravelVisitDialog';
import {
  getOverheads, addTravelVisit, updateTravelVisit, deleteTravelVisit,
  addOverheadEntry, updateOverheadEntry, deleteOverheadEntry,
} from '@/utils/overheadFirestore';
import {
  TravelVisit, TravelExpenseItem, OverheadEntry, ProjectOverheads,
  OtherOverheadCategory, OTHER_OVERHEAD_CATEGORIES, ReimbursementStatus,
} from '@/types/overhead';
import { ProjectMember } from '@/utils/projectFirestore';

interface Props {
  projectId: string;
  projectName: string;
  members: ProjectMember[];
  currentUserId: string;
  isAdmin?: boolean;
  onTotalChange?: (total: number) => void;
}

const INR = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const fmtDate = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const visitDateRange = (v: TravelVisit): string => {
  const sd = v.startDate ?? v.date ?? '';
  const ed = v.endDate ?? v.date ?? '';
  if (!sd) return '—';
  if (sd === ed) return fmtDate(sd);
  const s = new Date(sd + 'T00:00:00');
  const e = new Date(ed + 'T00:00:00');
  // Same month: "1–3 Jul 2026"
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.getDate()}–${e.getDate()} ${e.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`;
  }
  return `${fmtDate(sd)} – ${fmtDate(ed)}`;
};

const visitSortKey = (v: TravelVisit) => v.startDate ?? v.date ?? '';

const formatExpenseDesc = (item: TravelExpenseItem): string => {
  if (item.category === 'Accommodation') {
    const r = item.rooms ?? 1, n = item.nights ?? 1, p = item.peoplePerRoom ?? 1;
    const rate = item.ratePerRoomPerNight ?? 0;
    return `${r} room${r !== 1 ? 's' : ''} × ${n} night${n !== 1 ? 's' : ''} × ${p} ppl/rm @ ₹${rate.toLocaleString('en-IN')}`;
  }
  if (item.category === 'Food & Per Diem') {
    const parts: string[] = [];
    if (item.mealType) parts.push(item.mealType);
    if (item.people) parts.push(`${item.people} ${item.people === 1 ? 'person' : 'people'}`);
    if (item.description) parts.push(item.description);
    return parts.join(' — ') || '—';
  }
  return item.description ?? '—';
};

const STATUS_CONFIG: Record<ReimbursementStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  draft: {
    label: 'Draft',
    cls: 'bg-gray-50 text-gray-500 border-gray-200',
    icon: <FilePenLine size={11} />,
  },
  pending: {
    label: 'Pending Approval',
    cls: 'bg-amber-50 text-amber-700 border-amber-200',
    icon: <Clock size={11} />,
  },
  approved: {
    label: 'Approved',
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    icon: <CheckCircle size={11} />,
  },
  rejected: {
    label: 'Rejected',
    cls: 'bg-red-50 text-red-700 border-red-200',
    icon: <XCircle size={11} />,
  },
};

const ReimbursementBadge = ({ status }: { status: ReimbursementStatus }) => {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${cfg.cls}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
};

interface OverheadEntryDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editEntry?: OverheadEntry;
  onSave: (entry: Omit<OverheadEntry, 'id' | 'createdAt' | 'createdBy'>) => void;
}

const OverheadEntryDialog = ({ open, onOpenChange, editEntry, onSave }: OverheadEntryDialogProps) => {
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  const [category, setCategory] = useState<OtherOverheadCategory>('Other');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) {
      if (editEntry) {
        setDate(editEntry.date);
        setCategory(editEntry.category);
        setDescription(editEntry.description);
        setAmount(String(editEntry.amount));
        setNotes(editEntry.notes ?? '');
      } else {
        setDate(today);
        setCategory('Other');
        setDescription('');
        setAmount('');
        setNotes('');
      }
    }
  }, [open, editEntry, today]);

  const amt = parseFloat(amount);
  const valid = date && category && description.trim() && !isNaN(amt) && amt > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" onClick={e => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{editEntry ? 'Edit Overhead' : 'Add Overhead'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="oh-date">Date <span className="text-red-500">*</span></Label>
              <Input id="oh-date" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oh-amount">Amount (₹) <span className="text-red-500">*</span></Label>
              <Input id="oh-amount" type="number" min={0} placeholder="0" value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Category <span className="text-red-500">*</span></Label>
            <Select value={category} onValueChange={v => setCategory(v as OtherOverheadCategory)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {OTHER_OVERHEAD_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="oh-desc">Description <span className="text-red-500">*</span></Label>
            <Input id="oh-desc" placeholder="e.g. Third-party calibration certificate" value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="oh-notes">Notes</Label>
            <Textarea id="oh-notes" placeholder="Optional" className="h-16 resize-none text-sm" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => {
              if (!valid) return;
              onSave({ date, category, description: description.trim(), amount: amt, notes: notes || undefined });
              onOpenChange(false);
            }}
            disabled={!valid}
          >
            {editEntry ? 'Save Changes' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const OverheadsTab = ({ projectId, projectName, members, currentUserId, isAdmin, onTotalChange }: Props) => {
  const { toast } = useToast();
  const [data, setData] = useState<ProjectOverheads>({ travelVisits: [], otherEntries: [] });
  const [loading, setLoading] = useState(true);
  const [expandedVisitId, setExpandedVisitId] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const notifyFn = useCallback((payload: object) => {
    const fn = httpsCallable(getFunctions(), 'notifyExpenseApproval');
    return fn(payload).catch(err => console.warn('[OverheadsTab] Email notification failed:', err));
  }, []);

  const [travelDialogOpen, setTravelDialogOpen] = useState(false);
  const [editingVisit, setEditingVisit] = useState<TravelVisit | undefined>();

  const [overheadDialogOpen, setOverheadDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<OverheadEntry | undefined>();

  const [deleteTarget, setDeleteTarget] = useState<{ type: 'visit' | 'entry'; id: string } | null>(null);

  const load = useCallback(async () => {
    const d = await getOverheads(projectId);
    setData(d);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const resolveNames = (ids: string[]) =>
    ids.map(id => members.find(m => m.userId === id)?.displayName || id).join(', ');

  const handleSaveVisit = async (fields: Omit<TravelVisit, 'id' | 'createdAt' | 'createdBy'>) => {
    try {
      if (editingVisit) {
        const wasApproved = editingVisit.reimbursementStatus === 'approved';
        const newStatus: ReimbursementStatus = wasApproved ? 'pending' : editingVisit.reimbursementStatus;
        const updated: TravelVisit = { ...editingVisit, ...fields, reimbursementStatus: newStatus };
        await updateTravelVisit(projectId, updated);
        setData(prev => ({
          ...prev,
          travelVisits: prev.travelVisits.map(v => v.id === updated.id ? updated : v),
        }));
        if (wasApproved) {
          toast({ title: 'Visit updated — resubmitted for approval' });
          notifyFn({ mode: 'submitted', projectId, projectName, visitDates: visitDateRange(updated), visitLocation: updated.location, visitPurpose: updated.purpose, visitTotal: updated.totalCost, ownerUid: updated.createdBy });
        } else {
          toast({ title: 'Visit updated' });
        }
      } else {
        const newVisit: TravelVisit = {
          ...fields,
          reimbursementStatus: 'draft',
          id: `visit-${Date.now()}`,
          createdAt: new Date().toISOString(),
          createdBy: currentUserId,
        };
        await addTravelVisit(projectId, newVisit);
        setData(prev => ({ ...prev, travelVisits: [...prev.travelVisits, newVisit] }));
        toast({ title: 'Visit saved as draft — submit when ready for approval' });
      }
    } catch {
      toast({ title: 'Error saving visit', variant: 'destructive' });
    }
  };

  const handleSubmitForApproval = async (visit: TravelVisit) => {
    setSubmittingId(visit.id);
    const updated: TravelVisit = { ...visit, reimbursementStatus: 'pending' };
    try {
      await updateTravelVisit(projectId, updated);
      setData(prev => ({
        ...prev,
        travelVisits: prev.travelVisits.map(v => v.id === visit.id ? updated : v),
      }));
      toast({ title: 'Submitted for approval — admins have been notified' });
      notifyFn({ mode: 'submitted', projectId, projectName, visitDates: visitDateRange(visit), visitLocation: visit.location, visitPurpose: visit.purpose, visitTotal: visit.totalCost, ownerUid: visit.createdBy });
    } catch {
      toast({ title: 'Error submitting for approval', variant: 'destructive' });
    } finally {
      setSubmittingId(null);
    }
  };

  const handleUpdateReimbursement = async (visitId: string, status: ReimbursementStatus) => {
    const visit = data.travelVisits.find(v => v.id === visitId);
    if (!visit) return;
    const updated: TravelVisit = { ...visit, reimbursementStatus: status };
    try {
      await updateTravelVisit(projectId, updated);
      setData(prev => ({
        ...prev,
        travelVisits: prev.travelVisits.map(v => v.id === visitId ? updated : v),
      }));
      toast({ title: status === 'approved' ? 'Reimbursement approved' : 'Reimbursement rejected' });
      notifyFn({ mode: status, projectId, projectName, visitDates: visitDateRange(visit), visitLocation: visit.location, visitPurpose: visit.purpose, visitTotal: visit.totalCost, ownerUid: visit.createdBy });
    } catch {
      toast({ title: 'Error updating status', variant: 'destructive' });
    }
  };

  const handleSaveEntry = async (fields: Omit<OverheadEntry, 'id' | 'createdAt' | 'createdBy'>) => {
    try {
      if (editingEntry) {
        const updated: OverheadEntry = { ...editingEntry, ...fields };
        await updateOverheadEntry(projectId, updated);
        setData(prev => ({
          ...prev,
          otherEntries: prev.otherEntries.map(e => e.id === updated.id ? updated : e),
        }));
        toast({ title: 'Overhead updated' });
      } else {
        const newEntry: OverheadEntry = {
          ...fields,
          id: `oh-${Date.now()}`,
          createdAt: new Date().toISOString(),
          createdBy: currentUserId,
        };
        await addOverheadEntry(projectId, newEntry);
        setData(prev => ({ ...prev, otherEntries: [...prev.otherEntries, newEntry] }));
        toast({ title: 'Overhead added' });
      }
    } catch {
      toast({ title: 'Error saving overhead', variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === 'visit') {
        await deleteTravelVisit(projectId, deleteTarget.id);
        setData(prev => ({ ...prev, travelVisits: prev.travelVisits.filter(v => v.id !== deleteTarget.id) }));
        toast({ title: 'Visit deleted' });
      } else {
        await deleteOverheadEntry(projectId, deleteTarget.id);
        setData(prev => ({ ...prev, otherEntries: prev.otherEntries.filter(e => e.id !== deleteTarget.id) }));
        toast({ title: 'Overhead deleted' });
      }
    } catch {
      toast({ title: 'Error deleting', variant: 'destructive' });
    }
    setDeleteTarget(null);
  };

  const travelTotal = data.travelVisits.reduce((s, v) => s + v.totalCost, 0);
  const otherTotal = data.otherEntries.reduce((s, e) => s + e.amount, 0);
  const grandTotal = travelTotal + otherTotal;

  useEffect(() => { onTotalChange?.(grandTotal); }, [grandTotal, onTotalChange]);

  const sortedVisits = [...data.travelVisits].sort((a, b) => visitSortKey(b).localeCompare(visitSortKey(a)));
  const sortedEntries = [...data.otherEntries].sort((a, b) => b.date.localeCompare(a.date));

  if (loading) {
    return <div className="py-12 text-center text-gray-500 text-sm">Loading overheads…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Travel & Visits', value: travelTotal, color: 'text-blue-700 bg-blue-50 border-blue-100' },
          { label: 'Other Overheads', value: otherTotal, color: 'text-orange-700 bg-orange-50 border-orange-100' },
          { label: 'Total Overheads', value: grandTotal, color: 'text-gray-800 bg-gray-50 border-gray-200 font-semibold' },
        ].map(({ label, value, color }) => (
          <div key={label} className={`rounded-lg border px-4 py-3 ${color}`}>
            <p className="text-xs uppercase tracking-wide opacity-70 mb-0.5">{label}</p>
            <p className="text-xl font-semibold">{INR(value)}</p>
          </div>
        ))}
      </div>

      {/* ── Travel & Site Visits ──────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Plane size={16} className="text-blue-600" />
            <h3 className="font-medium text-gray-800">Travel & Site Visits</h3>
            <span className="text-xs text-gray-400">({sortedVisits.length})</span>
          </div>
          <Button
            size="sm" variant="outline" className="h-8 gap-1.5"
            onClick={() => { setEditingVisit(undefined); setTravelDialogOpen(true); }}
          >
            <Plus size={14} /> Log Visit
          </Button>
        </div>

        {sortedVisits.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">
            No visits logged yet.
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 w-5" />
                  <th className="px-3 py-2 text-left">Dates</th>
                  <th className="px-3 py-2 text-left">Who Went</th>
                  <th className="px-3 py-2 text-left">Location / Purpose</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                  <th className="px-3 py-2 w-24" />
                </tr>
              </thead>
              <tbody>
                {sortedVisits.map(visit => {
                  const isExpanded = expandedVisitId === visit.id;
                  const hasExpenses = (visit.expenses?.length ?? 0) > 0;
                  const isLegacy = !hasExpenses;
                  return (
                    <>
                      <tr
                        key={visit.id}
                        className={`border-b hover:bg-gray-50 ${hasExpenses ? 'cursor-pointer' : ''}`}
                        onClick={() => hasExpenses && setExpandedVisitId(isExpanded ? null : visit.id)}
                      >
                        <td className="px-3 py-2.5 text-gray-400">
                          {hasExpenses && (isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                        </td>
                        <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{visitDateRange(visit)}</td>
                        <td className="px-3 py-2.5 text-gray-700 max-w-[140px] truncate">{resolveNames(visit.attendees)}</td>
                        <td className="px-3 py-2.5 text-gray-600">
                          {visit.location && <span className="font-medium text-gray-700">{visit.location}</span>}
                          {visit.location && visit.purpose && <span className="text-gray-400"> — </span>}
                          {visit.purpose}
                          {!visit.location && !visit.purpose && <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <ReimbursementBadge status={visit.reimbursementStatus ?? 'pending'} />
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium text-gray-800 whitespace-nowrap">
                          {INR(visit.totalCost)}
                        </td>
                        <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            {/* Submit button — visible to all, only on draft visits */}
                            {visit.reimbursementStatus === 'draft' && (
                              <Button
                                variant="ghost" size="sm" className="h-7 px-1.5 text-[10px] text-blue-600 hover:text-blue-700 hover:bg-blue-50 gap-1"
                                onClick={() => handleSubmitForApproval(visit)}
                                disabled={submittingId === visit.id}
                                title="Submit for approval"
                              >
                                {submittingId === visit.id
                                  ? <Loader2 size={10} className="animate-spin" />
                                  : <Send size={10} />}
                                Submit
                              </Button>
                            )}
                            {/* Approve / Reject — admins only, on pending visits */}
                            {isAdmin && visit.reimbursementStatus === 'pending' && (
                              <>
                                <Button
                                  variant="ghost" size="sm" className="h-7 px-1.5 text-[10px] text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                  onClick={() => handleUpdateReimbursement(visit.id, 'approved')}
                                  title="Approve reimbursement"
                                >
                                  Approve
                                </Button>
                                <Button
                                  variant="ghost" size="sm" className="h-7 px-1.5 text-[10px] text-red-500 hover:text-red-600 hover:bg-red-50"
                                  onClick={() => handleUpdateReimbursement(visit.id, 'rejected')}
                                  title="Reject reimbursement"
                                >
                                  Reject
                                </Button>
                              </>
                            )}
                            <Button
                              variant="ghost" size="sm" className="h-7 w-7 p-0"
                              onClick={() => { setEditingVisit(visit); setTravelDialogOpen(true); }}
                              title="Edit"
                            >
                              <Pencil size={12} />
                            </Button>
                            <Button
                              variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                              onClick={() => setDeleteTarget({ type: 'visit', id: visit.id })}
                              title="Delete"
                            >
                              <Trash2 size={12} />
                            </Button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded expense breakdown */}
                      {isExpanded && (
                        <tr key={`${visit.id}-exp`} className="border-b bg-blue-50/30">
                          <td colSpan={7} className="px-6 py-3">
                            {isLegacy ? (
                              <p className="text-xs text-gray-500 italic">
                                Legacy record — ₹{visit.totalCost.toLocaleString('en-IN')} total (no itemised breakdown recorded)
                              </p>
                            ) : (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-gray-400 border-b border-gray-200">
                                    <th className="text-left pb-1 font-medium">Category</th>
                                    <th className="text-left pb-1 font-medium">Description</th>
                                    <th className="text-left pb-1 font-medium">Day</th>
                                    <th className="text-right pb-1 font-medium">Amount</th>
                                    <th className="w-8 pb-1" />
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {visit.expenses.map(item => (
                                    <tr key={item.id} className="py-1">
                                      <td className="py-1.5 pr-3">
                                        <span className="bg-blue-50 text-blue-700 border border-blue-100 rounded px-1.5 py-0.5 text-[10px]">
                                          {item.category}
                                        </span>
                                      </td>
                                      <td className="py-1.5 pr-3 text-gray-700">{formatExpenseDesc(item)}</td>
                                      <td className="py-1.5 pr-3 text-gray-400">{item.date ? fmtDate(item.date) : '—'}</td>
                                      <td className="py-1.5 text-right font-medium text-gray-800">{INR(item.amount)}</td>
                                      <td className="py-1.5 pl-2">
                                        {item.receiptUrl && (
                                          <a href={item.receiptUrl} target="_blank" rel="noreferrer" title={item.receiptName ?? 'Receipt'}>
                                            <Paperclip size={11} className="text-blue-500 hover:text-blue-700" />
                                          </a>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t border-gray-200">
                                    <td colSpan={3} className="pt-1.5 text-gray-500 text-right pr-3">Visit Total</td>
                                    <td className="pt-1.5 text-right font-semibold text-gray-800">{INR(visit.totalCost)}</td>
                                    <td />
                                  </tr>
                                </tfoot>
                              </table>
                            )}
                            {visit.notes && (
                              <p className="mt-2 text-xs text-gray-500 italic">{visit.notes}</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
              {sortedVisits.length > 1 && (
                <tfoot className="border-t bg-gray-50">
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-xs text-gray-500 text-right">Travel Total</td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-800">{INR(travelTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {/* ── Other Overheads ──────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Receipt size={16} className="text-orange-600" />
            <h3 className="font-medium text-gray-800">Other Overheads</h3>
            <span className="text-xs text-gray-400">({sortedEntries.length})</span>
          </div>
          <Button
            size="sm" variant="outline" className="h-8 gap-1.5"
            onClick={() => { setEditingEntry(undefined); setOverheadDialogOpen(true); }}
          >
            <Plus size={14} /> Add Overhead
          </Button>
        </div>

        {sortedEntries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">
            No overheads logged yet.
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-left">Description</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 w-16" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {sortedEntries.map(entry => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{fmtDate(entry.date)}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs bg-orange-50 text-orange-700 border border-orange-100 rounded px-1.5 py-0.5">
                        {entry.category}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-700">
                      {entry.description}
                      {entry.notes && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{entry.notes}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-gray-800 whitespace-nowrap">
                      {INR(entry.amount)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost" size="sm" className="h-7 w-7 p-0"
                          onClick={() => { setEditingEntry(entry); setOverheadDialogOpen(true); }}
                        >
                          <Pencil size={12} />
                        </Button>
                        <Button
                          variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                          onClick={() => setDeleteTarget({ type: 'entry', id: entry.id })}
                        >
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {sortedEntries.length > 1 && (
                <tfoot className="border-t bg-gray-50">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-xs text-gray-500 text-right">Other Overheads Total</td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-800">{INR(otherTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <LogTravelVisitDialog
        open={travelDialogOpen}
        onOpenChange={v => { setTravelDialogOpen(v); if (!v) setEditingVisit(undefined); }}
        projectId={projectId}
        members={members}
        currentUserId={currentUserId}
        editVisit={editingVisit}
        onSave={handleSaveVisit}
      />

      <OverheadEntryDialog
        open={overheadDialogOpen}
        onOpenChange={v => { setOverheadDialogOpen(v); if (!v) setEditingEntry(undefined); }}
        editEntry={editingEntry}
        onSave={handleSaveEntry}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.type === 'visit' ? 'Visit' : 'Overhead'}?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default OverheadsTab;
