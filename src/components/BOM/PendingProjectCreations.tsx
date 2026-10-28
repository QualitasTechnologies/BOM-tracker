import { useCallback, useEffect, useState } from 'react';
import MaterialRecoveryBanner from './MaterialRecoveryBanner';
import { listPendingNativeMaterialRequests } from '@/utils/nativeMaterialCommands';

// Entry point for unconfirmed project creations: the project page may not exist, so recovery lives here.
export default function PendingProjectCreations({ uid, refreshKey }: { uid?: string | null; refreshKey?: unknown }) {
  const [ids, setIds] = useState<string[]>([]);
  const scan = useCallback(() => {
    // Keep ids already shown: each banner hides itself once confirmed, and must keep its outcome message until then.
    const found = uid ? listPendingNativeMaterialRequests().filter(entry => entry.operation === 'create_project' || entry.operation === 'unknown').map(entry => entry.projectId) : [];
    setIds(previous => (uid ? Array.from(new Set([...previous, ...found])) : []));
  }, [uid]);
  useEffect(scan, [scan, refreshKey]);
  if (!uid || !ids.length) return null;
  return <>{ids.map(id => <MaterialRecoveryBanner key={`${uid}:${id}`} projectId={id} onRefresh={scan} />)}</>;
}
