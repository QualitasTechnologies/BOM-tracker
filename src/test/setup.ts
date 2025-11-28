import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Firebase
vi.mock('@/firebase', () => ({
  db: {},
  auth: {},
  storage: {},
}));

// Mock firebase/firestore functions
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  addDoc: vi.fn(),
  query: vi.fn(),
  onSnapshot: vi.fn(),
  where: vi.fn(),
}));

// Mock firebase/auth
vi.mock('firebase/auth', () => ({
  signInWithPopup: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  getIdTokenResult: vi.fn(),
}));

// Mock firebase/storage
vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
  deleteObject: vi.fn(),
}));

// Mock URL.createObjectURL and URL.revokeObjectURL for file downloads
// These are needed for CSV export tests but we need to preserve the URL constructor
const originalURL = globalThis.URL;

// Only add the mock methods if they don't exist
if (typeof window !== 'undefined' && window.URL) {
  const mockCreateObjectURL = vi.fn(() => 'mock-url');
  const mockRevokeObjectURL = vi.fn();

  // Preserve the constructor but add mock methods
  window.URL.createObjectURL = mockCreateObjectURL;
  window.URL.revokeObjectURL = mockRevokeObjectURL;
}
