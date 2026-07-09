import { db } from '@/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ProjectOverheads, TravelVisit, OverheadEntry } from '@/types/overhead';

const ref = (projectId: string) =>
  doc(db, 'projects', projectId, 'overheads', 'data');

const empty = (): ProjectOverheads => ({ travelVisits: [], otherEntries: [] });

export const getOverheads = async (projectId: string): Promise<ProjectOverheads> => {
  const snap = await getDoc(ref(projectId));
  if (!snap.exists()) return empty();
  const data = snap.data();
  return {
    travelVisits: data.travelVisits ?? [],
    otherEntries: data.otherEntries ?? [],
  };
};

export const addTravelVisit = async (projectId: string, visit: TravelVisit): Promise<void> => {
  const current = await getOverheads(projectId);
  await setDoc(ref(projectId), {
    ...current,
    travelVisits: [...current.travelVisits, visit],
  });
};

export const updateTravelVisit = async (projectId: string, visit: TravelVisit): Promise<void> => {
  const current = await getOverheads(projectId);
  await setDoc(ref(projectId), {
    ...current,
    travelVisits: current.travelVisits.map(v => (v.id === visit.id ? visit : v)),
  });
};

export const deleteTravelVisit = async (projectId: string, visitId: string): Promise<void> => {
  const current = await getOverheads(projectId);
  await setDoc(ref(projectId), {
    ...current,
    travelVisits: current.travelVisits.filter(v => v.id !== visitId),
  });
};

export const addOverheadEntry = async (projectId: string, entry: OverheadEntry): Promise<void> => {
  const current = await getOverheads(projectId);
  await setDoc(ref(projectId), {
    ...current,
    otherEntries: [...current.otherEntries, entry],
  });
};

export const updateOverheadEntry = async (projectId: string, entry: OverheadEntry): Promise<void> => {
  const current = await getOverheads(projectId);
  await setDoc(ref(projectId), {
    ...current,
    otherEntries: current.otherEntries.map(e => (e.id === entry.id ? entry : e)),
  });
};

export const deleteOverheadEntry = async (projectId: string, entryId: string): Promise<void> => {
  const current = await getOverheads(projectId);
  await setDoc(ref(projectId), {
    ...current,
    otherEntries: current.otherEntries.filter(e => e.id !== entryId),
  });
};
