import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/useAuth';
import {
  subscribeToEngineerRates,
  upsertEngineerRate,
  deleteEngineerRate,
  validateEmail,
  validateRate,
} from '@/utils/engineerRatesFirestore';
import type { EngineerRate } from '@/types/engineerRate';
import { Pencil, Trash2, Plus } from 'lucide-react';

export const EngineerRatesTab = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rates, setRates] = useState<EngineerRate[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ email: string; name: string; hourlyRate: string }>({
    email: '', name: '', hourlyRate: '',
  });
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    return subscribeToEngineerRates((r) => setRates(r.sort((a, b) => a.name.localeCompare(b.name))));
  }, []);

  const handleSave = async () => {
    if (!user?.email) return;
    const rate = Number(draft.hourlyRate);
    if (!validateEmail(draft.email)) {
      toast({ title: 'Invalid email', description: 'Must be a @qualitastech.com address', variant: 'destructive' });
      return;
    }
    if (!validateRate(rate)) {
      toast({ title: 'Invalid rate', description: 'Rate must be a number ≥ 0', variant: 'destructive' });
      return;
    }
    try {
      await upsertEngineerRate({ email: draft.email, name: draft.name, hourlyRate: rate }, user.email);
      toast({ title: 'Saved', description: `${draft.name} – ₹${rate}/hr` });
      setDraft({ email: '', name: '', hourlyRate: '' });
      setEditing(null);
      setShowAdd(false);
    } catch (err) {
      toast({ title: 'Save failed', description: String(err), variant: 'destructive' });
    }
  };

  const handleDelete = async (email: string) => {
    if (!window.confirm(`Remove rate for ${email}?`)) return;
    try {
      await deleteEngineerRate(email);
      toast({ title: 'Deleted' });
    } catch (err) {
      toast({ title: 'Delete failed', description: String(err), variant: 'destructive' });
    }
  };

  const startEdit = (r: EngineerRate) => {
    setEditing(r.email);
    setDraft({ email: r.email, name: r.name, hourlyRate: String(r.hourlyRate) });
    setShowAdd(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Engineer Rates</CardTitle>
        <p className="text-sm text-muted-foreground">
          Hourly rates used to compute project labour cost. Admin only.
        </p>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2">Email</th>
              <th className="text-left py-2">Name</th>
              <th className="text-right py-2">Rate (₹/hr)</th>
              <th className="text-left py-2">Updated</th>
              <th className="text-right py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.email} className="border-b">
                {editing === r.email ? (
                  <>
                    <td className="py-2">{r.email}</td>
                    <td className="py-2">
                      <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                    </td>
                    <td className="py-2">
                      <Input type="number" min="0" value={draft.hourlyRate} onChange={(e) => setDraft({ ...draft, hourlyRate: e.target.value })} />
                    </td>
                    <td className="py-2 text-muted-foreground text-xs">—</td>
                    <td className="py-2 text-right">
                      <Button size="sm" onClick={handleSave}>Save</Button>{' '}
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setDraft({ email: '', name: '', hourlyRate: '' }); }}>Cancel</Button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="py-2">{r.email}</td>
                    <td className="py-2">{r.name}</td>
                    <td className="py-2 text-right">₹{r.hourlyRate.toLocaleString('en-IN')}</td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : '—'} ({r.updatedBy})
                    </td>
                    <td className="py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(r)}><Pencil className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(r.email)}><Trash2 className="h-3 w-3" /></Button>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {rates.length === 0 && (
              <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">No engineer rates yet.</td></tr>
            )}
          </tbody>
        </table>

        <div className="mt-4">
          {showAdd ? (
            <div className="flex gap-2 items-end border rounded p-3">
              <div className="flex-1">
                <Label>Email</Label>
                <Input placeholder="anil@qualitastech.com" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
              </div>
              <div className="flex-1">
                <Label>Name</Label>
                <Input placeholder="Anil Kumar" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className="w-32">
                <Label>Rate (₹/hr)</Label>
                <Input type="number" min="0" value={draft.hourlyRate} onChange={(e) => setDraft({ ...draft, hourlyRate: e.target.value })} />
              </div>
              <Button onClick={handleSave}>Add</Button>
              <Button variant="ghost" onClick={() => { setShowAdd(false); setDraft({ email: '', name: '', hourlyRate: '' }); }}>Cancel</Button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setShowAdd(true)}>
              <Plus className="h-4 w-4 mr-2" /> Add engineer rate
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
