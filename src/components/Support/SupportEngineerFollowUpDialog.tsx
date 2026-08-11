import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Mail, Sparkles } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import type { SupportEngineerFollowUpDraft, SupportTicket } from '@/types/support';
import {
  prepareSupportEngineerFollowUp,
  sendSupportEngineerFollowUp,
} from '@/utils/supportFirestore';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  ticket: SupportTicket;
  onSent?: () => void;
}

export function SupportEngineerFollowUpDialog({
  open,
  onOpenChange,
  projectId,
  ticket,
  onSent,
}: Props) {
  const { toast } = useToast();
  const [quickNote, setQuickNote] = useState('');
  const [draft, setDraft] = useState<SupportEngineerFollowUpDraft | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuickNote('');
    setDraft(null);
    setSubject('');
    setBody('');
  }, [open, ticket.id]);

  const handlePrepare = async () => {
    setPreparing(true);
    try {
      const prepared = await prepareSupportEngineerFollowUp({
        projectId,
        ticketId: ticket.id,
        quickNote: quickNote.trim(),
      });
      setDraft(prepared);
      setSubject(prepared.subject);
      setBody(prepared.body);
      toast({
        title: prepared.aiProvider === 'gemini' ? 'Gemini-refined follow-up prepared' : 'Follow-up draft prepared',
        description: prepared.aiProvider === 'gemini'
          ? 'Gemini sanitized and refined the message. Review it before sending.'
          : 'Gemini is unavailable, so a safe structured draft was prepared for review.',
      });
    } catch (error) {
      toast({
        title: 'Could not prepare follow-up',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setPreparing(false);
    }
  };

  const handleSend = async () => {
    if (!subject.trim() || !body.trim()) {
      toast({ title: 'Subject and message are required', variant: 'destructive' });
      return;
    }
    setSending(true);
    try {
      const result = await sendSupportEngineerFollowUp({
        projectId,
        ticketId: ticket.id,
        subject: subject.trim(),
        body: body.trim(),
      });
      toast({
        title: 'Engineer follow-up sent',
        description: `Sent to ${result.to}${result.cc.length ? ` with ${result.cc.length} team member${result.cc.length === 1 ? '' : 's'} in CC` : ''}.`,
      });
      onSent?.();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Follow-up could not be sent',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />Follow up with assigned engineer
          </DialogTitle>
          <DialogDescription>
            {ticket.ticketNumber} · {ticket.assignee?.name || 'Unassigned'} · The final email is recorded in the activity trail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid gap-2">
            <Label>Quick instruction or next step</Label>
            <Textarea
              rows={3}
              maxLength={2000}
              value={quickNote}
              onChange={(event) => setQuickNote(event.target.value)}
              placeholder="Example: Complete the RCA details and follow up with the customer on payment."
            />
            <p className="text-xs text-muted-foreground">
              Gemini sanitizes and refines the instruction. The draft also checks the ticket for missing records based on its current status.
            </p>
          </div>

          {!draft ? (
            <Button className="w-full" onClick={handlePrepare} disabled={preparing}>
              {preparing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Generate follow-up draft
            </Button>
          ) : (
            <>
              <div className="rounded-lg border bg-slate-50 p-4 text-sm">
                <div><span className="font-medium">To:</span> {draft.to}</div>
                <div className="mt-1 break-words">
                  <span className="font-medium">CC:</span> {draft.cc.length ? draft.cc.join(', ') : 'No additional recipients'}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Recipients are resolved from the assigned engineer, current project team, and your signed-in email when sent.
                </p>
              </div>

              {draft.missingItems.length ? (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>{draft.missingItems.length} incomplete record{draft.missingItems.length === 1 ? '' : 's'} found</AlertTitle>
                  <AlertDescription>
                    <ul className="mt-2 space-y-2">
                      {draft.missingItems.map((item) => (
                        <li key={item.code}>
                          <span className="font-medium text-foreground">{item.label}:</span> {item.action}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="border-emerald-200 bg-emerald-50">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  <AlertTitle>No structured record gaps detected</AlertTitle>
                  <AlertDescription>The engineer is still asked for a concise progress note and next committed action.</AlertDescription>
                </Alert>
              )}

              <div className="grid gap-2">
                <Label>Email subject</Label>
                <Input maxLength={180} value={subject} onChange={(event) => setSubject(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Email message</Label>
                <Textarea rows={14} maxLength={12000} value={body} onChange={(event) => setBody(event.target.value)} />
              </div>
              <Button variant="outline" onClick={handlePrepare} disabled={preparing || sending}>
                {preparing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Regenerate from quick instruction
              </Button>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
          {draft && (
            <Button onClick={handleSend} disabled={sending || !subject.trim() || !body.trim()}>
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
              Send to engineer & CC team
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
