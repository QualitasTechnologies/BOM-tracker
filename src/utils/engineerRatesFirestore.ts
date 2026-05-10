import { db } from '@/firebase';
import {
  collection, doc, getDocs, setDoc, deleteDoc,
  serverTimestamp, Timestamp, onSnapshot, Unsubscribe,
} from 'firebase/firestore';
import type { EngineerRate, EngineerRateInput } from '@/types/engineerRate';

const QUALITAS_DOMAIN = '@qualitastech.com';
const ENGINEER_RATES = 'engineerRates';

export const validateEmail = (email: unknown): boolean => {
  if (typeof email !== 'string') return false;
  const e = email.trim().toLowerCase();
  if (!e.endsWith(QUALITAS_DOMAIN)) return false;
  const local = e.slice(0, -QUALITAS_DOMAIN.length);
  return local.length > 0 && /^[a-z0-9._-]+$/.test(local);
};

export const emailToDocId = (email: string): string => {
  if (!email || typeof email !== 'string') {
    throw new Error('email is required');
  }
  const normalized = email.trim().toLowerCase();
  if (!validateEmail(normalized)) {
    throw new Error(`email must be a ${QUALITAS_DOMAIN} address`);
  }
  return normalized.replace('@', '_at_').replace(/\./g, '_');
};

export const validateRate = (rate: unknown): boolean => {
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= 0;
};

export const upsertEngineerRate = async (
  input: EngineerRateInput,
  currentUserEmail: string,
): Promise<void> => {
  if (!validateEmail(input.email)) {
    throw new Error('invalid email');
  }
  if (!validateRate(input.hourlyRate)) {
    throw new Error('invalid rate');
  }
  const docId = emailToDocId(input.email);
  const ref = doc(collection(db, ENGINEER_RATES), docId);
  await setDoc(ref, {
    email: input.email.trim().toLowerCase(),
    name: input.name.trim(),
    hourlyRate: input.hourlyRate,
    currency: 'INR' as const,
    updatedAt: serverTimestamp(),
    updatedBy: currentUserEmail,
  });
};

export const deleteEngineerRate = async (email: string): Promise<void> => {
  const docId = emailToDocId(email);
  await deleteDoc(doc(collection(db, ENGINEER_RATES), docId));
};

export const getAllEngineerRates = async (): Promise<EngineerRate[]> => {
  const snap = await getDocs(collection(db, ENGINEER_RATES));
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      email: data.email,
      name: data.name,
      hourlyRate: data.hourlyRate,
      currency: data.currency || 'INR',
      updatedAt: (data.updatedAt as Timestamp)?.toDate?.() ?? new Date(0),
      updatedBy: data.updatedBy,
    } as EngineerRate;
  });
};

export const subscribeToEngineerRates = (
  cb: (rates: EngineerRate[]) => void,
): Unsubscribe => {
  return onSnapshot(collection(db, ENGINEER_RATES), (snap) => {
    cb(snap.docs.map((d) => {
      const data = d.data();
      return {
        email: data.email,
        name: data.name,
        hourlyRate: data.hourlyRate,
        currency: data.currency || 'INR',
        updatedAt: (data.updatedAt as Timestamp)?.toDate?.() ?? new Date(0),
        updatedBy: data.updatedBy,
      } as EngineerRate;
    }));
  });
};
