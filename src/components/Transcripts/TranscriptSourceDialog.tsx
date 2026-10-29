import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { getProjectSourceTranscript, subscribeScopedSourceTranscript, type SourceTranscript } from '@/utils/transcriptFirestore';
import { isScopedProjectReadEnabled } from '@/utils/projectReadMode';

interface TranscriptSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  transcriptId: string;
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; source: SourceTranscript };
type BoundState = { contextKey: string; state: State };

// Read-only view of the full stored transcript behind an activity. Every open (and every retry) is
// a fresh authorized read; the text is rendered only as a React text child, never as markup.
const TranscriptSourceDialog = ({ open, onOpenChange, projectId, transcriptId }: TranscriptSourceDialogProps) => {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [attempt, setAttempt] = useState(0);
  const contextKey = JSON.stringify([open, uid, projectId, transcriptId, attempt]);
  const currentContext = useRef(contextKey);
  // Invalidate synchronously during render, before a prior effect's cleanup can run.
  currentContext.current = contextKey;
  const [boundState, setBoundState] = useState<BoundState>({ contextKey, state: { status: 'loading' } });
  const state = boundState.contextKey === contextKey ? boundState.state : { status: 'loading' as const };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const isCurrent = () => !cancelled && currentContext.current === contextKey;
    setBoundState({ contextKey, state: { status: 'loading' } });
    if (isScopedProjectReadEnabled()) {
      return subscribeScopedSourceTranscript(projectId, transcriptId, uid || '',
        source => { if (isCurrent()) setBoundState({ contextKey, state: { status: 'ready', source } }); },
        err => {
          if (!isCurrent()) return;
          const message = err instanceof Error && err.message ? err.message : 'Could not load the transcript.';
          setBoundState({ contextKey, state: { status: 'error', message } });
        });
    }
    getProjectSourceTranscript(projectId, transcriptId, { isCurrent })
      .then((source) => { if (isCurrent()) setBoundState({ contextKey, state: { status: 'ready', source } }); })
      .catch((err: unknown) => {
        if (!isCurrent()) return;
        const message = err instanceof Error && err.message ? err.message : 'Could not load the transcript.';
        setBoundState({ contextKey, state: { status: 'error', message } });
      });
    return () => { cancelled = true; };
  }, [open, uid, projectId, transcriptId, attempt, contextKey]);

  const ready = state.status === 'ready' ? state.source : null;
  const transcript = ready?.transcript;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Source transcript</DialogTitle>
          <DialogDescription>
            The full transcript this activity was extracted from. It is read-only.
          </DialogDescription>
        </DialogHeader>

        {state.status === 'loading' && (
          <div className="flex items-center gap-2 py-6 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading transcript...
          </div>
        )}

        {state.status === 'error' && (
          <div className="space-y-3">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
            <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </Button>
          </div>
        )}

        {ready && transcript && (
          <div className="space-y-3">
            <div className="text-sm text-gray-700">
              <div className="font-medium">
                {transcript.meetingTitle || transcript.fileName || 'Untitled meeting'}
              </div>
              <div className="text-xs text-gray-500">
                Meeting date: {transcript.meetingDate}
                {transcript.fileName ? ` · File: ${transcript.fileName}` : ''}
                {transcript.createdByName ? ` · Saved by ${transcript.createdByName}` : ''}
                {transcript.createdAt ? ` on ${transcript.createdAt}` : ''}
              </div>
            </div>
            {ready.linkedProjectCount > 1 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  This transcript covers {ready.linkedProjectCount} projects, so the text below may
                  include discussion of other projects.
                </AlertDescription>
              </Alert>
            )}
            <pre
              data-testid="source-transcript-text"
              className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded border bg-gray-50 p-3 text-xs text-gray-900"
            >{transcript.rawText}</pre>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default TranscriptSourceDialog;
