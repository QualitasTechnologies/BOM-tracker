import { useState, useEffect, useRef, useCallback } from 'react';
import { Check, Plus, X, Paperclip, Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/firebase';
import {
  TravelVisit, TravelExpenseItem, ExpenseCategory,
  EXPENSE_CATEGORIES, MealType, MEAL_TYPES,
} from '@/types/overhead';
import { ProjectMember } from '@/utils/projectFirestore';

interface ExpenseRow {
  id: string;
  category: ExpenseCategory;
  date: string;
  // General / Transport / Misc
  description: string;
  amount: string;
  // Accommodation
  rooms: string;
  nights: string;
  peoplePerRoom: string;
  ratePerRoomPerNight: string;
  // Food
  mealType: MealType;
  people: string;
  // Receipt
  receiptUrl?: string;
  receiptName?: string;
  uploading: boolean;
}

const emptyRow = (id: string): ExpenseRow => ({
  id,
  category: 'Transport',
  date: '',
  description: '',
  amount: '',
  rooms: '1',
  nights: '1',
  peoplePerRoom: '1',
  ratePerRoomPerNight: '',
  mealType: 'Dinner',
  people: '',
  uploading: false,
});

const computeRowAmount = (row: ExpenseRow): number => {
  if (row.category === 'Accommodation') {
    const r = parseFloat(row.rooms) || 0;
    const n = parseFloat(row.nights) || 0;
    const rate = parseFloat(row.ratePerRoomPerNight) || 0;
    return r * n * rate;
  }
  return parseFloat(row.amount) || 0;
};

const rowIsValid = (row: ExpenseRow): boolean => {
  const amt = computeRowAmount(row);
  if (amt <= 0) return false;
  if (row.category === 'Accommodation') {
    return (parseFloat(row.rooms) || 0) > 0 && (parseFloat(row.nights) || 0) > 0 && (parseFloat(row.ratePerRoomPerNight) || 0) > 0;
  }
  return true;
};

const rowToItem = (row: ExpenseRow): TravelExpenseItem => {
  const base: TravelExpenseItem = {
    id: row.id,
    category: row.category,
    amount: computeRowAmount(row),
  };
  if (row.date) base.date = row.date;
  if (row.receiptUrl) { base.receiptUrl = row.receiptUrl; base.receiptName = row.receiptName; }

  if (row.category === 'Accommodation') {
    base.rooms = parseFloat(row.rooms) || 1;
    base.nights = parseFloat(row.nights) || 1;
    base.peoplePerRoom = parseFloat(row.peoplePerRoom) || 1;
    base.ratePerRoomPerNight = parseFloat(row.ratePerRoomPerNight) || 0;
  } else if (row.category === 'Food & Per Diem') {
    base.mealType = row.mealType;
    if (row.people) base.people = parseFloat(row.people) || undefined;
    if (row.description) base.description = row.description;
  } else {
    if (row.description) base.description = row.description;
  }
  return base;
};

const itemToRow = (item: TravelExpenseItem): ExpenseRow => ({
  id: item.id,
  category: item.category,
  date: item.date ?? '',
  description: item.description ?? '',
  amount: item.category !== 'Accommodation' ? String(item.amount) : '',
  rooms: String(item.rooms ?? 1),
  nights: String(item.nights ?? 1),
  peoplePerRoom: String(item.peoplePerRoom ?? 1),
  ratePerRoomPerNight: String(item.ratePerRoomPerNight ?? ''),
  mealType: item.mealType ?? 'Dinner',
  people: String(item.people ?? ''),
  receiptUrl: item.receiptUrl,
  receiptName: item.receiptName,
  uploading: false,
});

const INR = (n: number) =>
  n > 0 ? `₹${Math.round(n).toLocaleString('en-IN')}` : '—';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  members: ProjectMember[];
  currentUserId: string;
  editVisit?: TravelVisit;
  onSave: (visit: Omit<TravelVisit, 'id' | 'createdAt' | 'createdBy'>) => void;
}

const LogTravelVisitDialog = ({
  open, onOpenChange, projectId, members, currentUserId, editVisit, onSave,
}: Props) => {
  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [attendees, setAttendees] = useState<string[]>([currentUserId]);
  const [location, setLocation] = useState('');
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState('');
  const [attendeeOpen, setAttendeeOpen] = useState(false);
  const [rows, setRows] = useState<ExpenseRow[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<string | null>(null);

  useEffect(() => {
    if (open) {
      if (editVisit) {
        const sd = editVisit.startDate ?? editVisit.date ?? today;
        const ed = editVisit.endDate ?? editVisit.date ?? today;
        setStartDate(sd);
        setEndDate(ed);
        setAttendees(editVisit.attendees);
        setLocation(editVisit.location ?? '');
        setPurpose(editVisit.purpose ?? '');
        setNotes(editVisit.notes ?? '');
        setRows(
          editVisit.expenses?.length
            ? editVisit.expenses.map(itemToRow)
            : []
        );
      } else {
        setStartDate(today);
        setEndDate(today);
        setAttendees([currentUserId]);
        setLocation('');
        setPurpose('');
        setNotes('');
        setRows([]);
      }
      setAttendeeOpen(false);
    }
  }, [open, editVisit, currentUserId, today]);

  const toggleAttendee = (userId: string) => {
    setAttendees(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const resolveNames = (ids: string[]) =>
    ids.map(id => members.find(m => m.userId === id)?.displayName ?? id).join(', ');

  const addRow = () => {
    setRows(prev => [...prev, emptyRow(`exp-${Date.now()}`)]);
  };

  const removeRow = (id: string) => {
    setRows(prev => prev.filter(r => r.id !== id));
  };

  const updateRow = useCallback((id: string, changes: Partial<ExpenseRow>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...changes } : r));
  }, []);

  const triggerReceiptUpload = (rowId: string) => {
    uploadTargetRef.current = rowId;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const rowId = uploadTargetRef.current;
    if (!file || !rowId) return;
    e.target.value = '';

    updateRow(rowId, { uploading: true });
    try {
      const ext = file.name.split('.').pop() ?? 'bin';
      const path = `projects/${projectId}/receipts/${rowId}-${Date.now()}.${ext}`;
      const snap = await uploadBytes(storageRef(storage, path), file);
      const url = await getDownloadURL(snap.ref);
      updateRow(rowId, { receiptUrl: url, receiptName: file.name, uploading: false });
    } catch {
      updateRow(rowId, { uploading: false });
    }
  };

  const totalCost = rows.reduce((s, r) => s + computeRowAmount(r), 0);
  const allRowsValid = rows.every(rowIsValid);
  const canSave = startDate && endDate && startDate <= endDate && attendees.length > 0 && rows.length > 0 && allRowsValid;

  const handleSave = () => {
    if (!canSave) return;
    const expenses = rows.map(rowToItem);
    onSave({
      startDate,
      endDate,
      attendees,
      location: location || undefined,
      purpose: purpose || undefined,
      expenses,
      totalCost,
      reimbursementStatus: editVisit?.reimbursementStatus ?? 'pending',
      notes: notes || undefined,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{editVisit ? 'Edit Visit' : 'Log Travel / Site Visit'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Row 1: dates + attendees */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="visit-start">Start Date <span className="text-red-500">*</span></Label>
              <Input id="visit-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="visit-end">End Date <span className="text-red-500">*</span></Label>
              <Input
                id="visit-end"
                type="date"
                value={endDate}
                min={startDate}
                onChange={e => setEndDate(e.target.value)}
              />
            </div>
            {endDate && startDate && endDate >= startDate && (
              <div className="flex items-end pb-0.5">
                <span className="text-xs text-gray-500">
                  {endDate === startDate
                    ? 'Single day'
                    : `${Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1} days`}
                </span>
              </div>
            )}
          </div>

          {/* Attendees */}
          <div className="space-y-1.5">
            <Label>Who Went <span className="text-red-500">*</span></Label>
            <Popover open={attendeeOpen} onOpenChange={setAttendeeOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start font-normal h-9 text-sm text-left">
                  {attendees.length === 0 ? 'Select team members…' : resolveNames(attendees)}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-2" align="start">
                <div className="space-y-1">
                  {members.map(m => (
                    <button
                      key={m.userId}
                      type="button"
                      onClick={() => toggleAttendee(m.userId)}
                      className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-gray-100 text-sm text-left"
                    >
                      <span className={cn(
                        'flex h-4 w-4 items-center justify-center rounded border',
                        attendees.includes(m.userId)
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'border-gray-300'
                      )}>
                        {attendees.includes(m.userId) && <Check className="h-2.5 w-2.5" />}
                      </span>
                      <span>{m.displayName || m.email}</span>
                    </button>
                  ))}
                  {members.length === 0 && (
                    <p className="text-xs text-gray-500 px-2">No members on this project.</p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Location + Purpose */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="visit-location">Location / Site</Label>
              <Input id="visit-location" placeholder="e.g. Client factory, Pune" value={location} onChange={e => setLocation(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="visit-purpose">Purpose</Label>
              <Input id="visit-purpose" placeholder="e.g. Installation inspection" value={purpose} onChange={e => setPurpose(e.target.value)} />
            </div>
          </div>

          {/* Expenses */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium">
                Expenses <span className="text-red-500">*</span>
                {rows.length > 0 && (
                  <span className="ml-2 font-normal text-gray-500 text-xs">
                    Total: <span className="font-semibold text-gray-700">{INR(totalCost)}</span>
                  </span>
                )}
              </Label>
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={addRow}>
                <Plus size={12} /> Add Expense
              </Button>
            </div>

            {rows.length === 0 && (
              <div
                className="border border-dashed rounded-lg py-6 text-center text-sm text-gray-400 cursor-pointer hover:border-blue-400 hover:text-blue-500 transition-colors"
                onClick={addRow}
              >
                Click to add your first expense
              </div>
            )}

            <div className="space-y-2">
              {rows.map(row => (
                <ExpenseRowCard
                  key={row.id}
                  row={row}
                  onChange={changes => updateRow(row.id, changes)}
                  onRemove={() => removeRow(row.id)}
                  onReceiptUpload={() => triggerReceiptUpload(row.id)}
                />
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="visit-notes">Notes</Label>
            <Textarea
              id="visit-notes"
              placeholder="Optional notes or observations…"
              className="h-16 resize-none text-sm"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {editVisit ? 'Save Changes' : 'Log Visit'}
          </Button>
        </DialogFooter>

        {/* Hidden file input for receipt uploads */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={handleFileChange}
        />
      </DialogContent>
    </Dialog>
  );
};

interface RowProps {
  row: ExpenseRow;
  onChange: (changes: Partial<ExpenseRow>) => void;
  onRemove: () => void;
  onReceiptUpload: () => void;
}

const ExpenseRowCard = ({ row, onChange, onRemove, onReceiptUpload }: RowProps) => {
  const accomAmount = row.category === 'Accommodation' ? computeRowAmount(row) : null;

  return (
    <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg border bg-gray-50 text-sm">
      {/* Category */}
      <Select value={row.category} onValueChange={v => onChange({ category: v as ExpenseCategory })}>
        <SelectTrigger className="h-8 w-40 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EXPENSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
        </SelectContent>
      </Select>

      {/* Dynamic fields */}
      {row.category === 'Accommodation' ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-500">Rooms</span>
          <Input
            type="number" min={1} value={row.rooms}
            onChange={e => onChange({ rooms: e.target.value })}
            className="h-8 w-12 text-xs text-center p-1"
          />
          <span className="text-xs text-gray-400">×</span>
          <span className="text-xs text-gray-500">Nights</span>
          <Input
            type="number" min={1} value={row.nights}
            onChange={e => onChange({ nights: e.target.value })}
            className="h-8 w-12 text-xs text-center p-1"
          />
          <span className="text-xs text-gray-400">×</span>
          <span className="text-xs text-gray-500">Ppl/Rm</span>
          <Input
            type="number" min={1} value={row.peoplePerRoom}
            onChange={e => onChange({ peoplePerRoom: e.target.value })}
            className="h-8 w-12 text-xs text-center p-1"
          />
          <span className="text-xs text-gray-500">@ ₹</span>
          <Input
            type="number" min={0} value={row.ratePerRoomPerNight}
            placeholder="rate"
            onChange={e => onChange({ ratePerRoomPerNight: e.target.value })}
            className="h-8 w-24 text-xs p-1"
          />
          {accomAmount != null && accomAmount > 0 && (
            <span className="text-xs font-semibold text-gray-700">= ₹{accomAmount.toLocaleString('en-IN')}</span>
          )}
        </div>
      ) : row.category === 'Food & Per Diem' ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Select value={row.mealType} onValueChange={v => onChange({ mealType: v as MealType })}>
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEAL_TYPES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-xs text-gray-500">People</span>
          <Input
            type="number" min={1} value={row.people} placeholder="#"
            onChange={e => onChange({ people: e.target.value })}
            className="h-8 w-12 text-xs text-center p-1"
          />
          <Input
            type="text"
            value={row.description}
            placeholder="Description (optional)"
            onChange={e => onChange({ description: e.target.value })}
            className="h-8 text-xs w-40 p-1"
          />
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500">₹</span>
            <Input
              type="number" min={0} value={row.amount} placeholder="Bill total"
              onChange={e => onChange({ amount: e.target.value })}
              className="h-8 w-24 text-xs p-1"
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 flex-1 flex-wrap min-w-0">
          <Input
            type="text" value={row.description} placeholder="Description"
            onChange={e => onChange({ description: e.target.value })}
            className="h-8 text-xs flex-1 min-w-[120px] p-1"
          />
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500">₹</span>
            <Input
              type="number" min={0} value={row.amount} placeholder="Amount"
              onChange={e => onChange({ amount: e.target.value })}
              className="h-8 w-24 text-xs p-1"
            />
          </div>
        </div>
      )}

      {/* Optional date tag */}
      <Input
        type="date" value={row.date}
        onChange={e => onChange({ date: e.target.value })}
        className="h-8 w-36 text-xs p-1"
        title="Tag to a specific day (optional)"
      />

      {/* Receipt */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn('h-8 w-8 p-0', row.receiptUrl ? 'text-emerald-600' : 'text-gray-400 hover:text-gray-600')}
        onClick={onReceiptUpload}
        title={row.receiptUrl ? `Receipt: ${row.receiptName}` : 'Attach receipt'}
        disabled={row.uploading}
      >
        {row.uploading ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
      </Button>

      {/* Delete */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 text-red-400 hover:text-red-600"
        onClick={onRemove}
      >
        <X size={14} />
      </Button>
    </div>
  );
};

export default LogTravelVisitDialog;
