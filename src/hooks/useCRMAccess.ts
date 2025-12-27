import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { subscribeToUserCRMAccess } from '@/utils/userService';

/**
 * Hook to check if the current user has CRM access
 * Admins always have access, others need explicit permission
 */
export const useCRMAccess = () => {
  const { user, loading: authLoading, isAdmin } = useAuth();
  const [hasCRMAccess, setHasCRMAccess] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    // Admins always have CRM access
    if (isAdmin) {
      setHasCRMAccess(true);
      setLoading(false);
      return;
    }

    // If not logged in, no access
    if (!user?.uid) {
      setHasCRMAccess(false);
      setLoading(false);
      return;
    }

    // Subscribe to CRM access changes for non-admin users
    setLoading(true);
    const unsubscribe = subscribeToUserCRMAccess(user.uid, (access) => {
      setHasCRMAccess(access);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user?.uid, isAdmin, authLoading]);

  return {
    hasCRMAccess: isAdmin || hasCRMAccess,
    loading: authLoading || loading,
  };
};
