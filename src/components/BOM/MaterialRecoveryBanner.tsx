import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  acknowledgeNativeMaterialRequest, getPendingNativeMaterialRequest, resolveNativeMaterialRequest,
} from '@/utils/nativeMaterialCommands';
import type { MaterialResolution, PendingNativeMaterialRecovery } from '@/utils/nativeMaterialRecovery';

interface Props {
  projectId: string;
  /** Reload the BOM after the saved change has been confirmed. */
  onRefresh?: () => void | Promise<void>;
}

const NOTICE: Record<MaterialResolution, string> = {
  committed: 'Your earlier change was saved.',
  cancelled: 'Your earlier change was not applied. You can make it again.',
};

// Recovery is deliberately independent of the editing switch and of edit permission: it only asks what
// happened to the change that was already sent, and never sends it again as something new.
export default function MaterialRecoveryBanner({ projectId, onRefresh }: Props) {
  const [state, setState] = useState<PendingNativeMaterialRecovery>({ kind: 'absent' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const busyRef = useRef(false);

  const scan = useCallback(async () => {
    const mine = generation.current;
    try {
      const next = await getPendingNativeMaterialRequest(projectId);
      if (mine === generation.current) setState(next);
    } catch {
      if (mine === generation.current) setState({ kind: 'error', message: 'A saved BOM change could not be read.' });
    }
  }, [projectId]);

  useEffect(() => {
    generation.current += 1;
    busyRef.current = false;
    setBusy(false); setError(''); setNotice(''); setState({ kind: 'absent' });
    scan();
    return () => { generation.current += 1; };
  }, [projectId, scan]);

  const finish = async (resolution: MaterialResolution, mine: number) => {
    await acknowledgeNativeMaterialRequest(projectId);
    if (mine !== generation.current) return;
    setNotice(NOTICE[resolution]);
    try { await onRefresh?.(); } catch { /* the page shows its own load error */ }
  };

  const act = async () => {
    if (busyRef.current || state.kind !== 'pending') return;
    const mine = generation.current;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const resolution = state.resolution ?? (await resolveNativeMaterialRequest(projectId)).resolution;
      if (mine !== generation.current) return;
      // Remember the answer so a failed confirmation only retries the confirmation.
      setState({ kind: 'pending', operation: state.operation, resolved: true, resolution });
      await finish(resolution, mine);
    } catch {
      if (mine === generation.current) setError('We could not check this change yet. It is still saved on this device, so please try again.');
    } finally {
      if (mine === generation.current) { busyRef.current = false; setBusy(false); await scan(); }
    }
  };

  if (state.kind === 'absent' && !notice) return null;
  return (
    <div role="region" aria-label="Unconfirmed BOM change" className="mx-4 mt-4 space-y-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
      {state.kind === 'error' && <p role="alert">{state.message} Restore browser session storage before editing this BOM.</p>}
      {state.kind === 'pending' && (
        <>
          <p>
            {state.resolved
              ? 'We found out what happened to your earlier change. Confirm it to continue editing this BOM.'
              : 'A recent change to this BOM was not confirmed. Check what happened before making another change.'}
          </p>
          <Button size="sm" disabled={busy} onClick={act}>{state.resolved ? 'Finish checking' : 'Check status'}</Button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
