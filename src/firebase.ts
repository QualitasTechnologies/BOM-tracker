// src/firebase.ts
import { initializeApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getStorage, connectStorageEmulator } from "firebase/storage";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBZY5FzPjgq9XYDwkP8Xc4PoR3AxJJWGJY",
  authDomain: "visionbomtracker.firebaseapp.com",
  projectId: "visionbomtracker",
  storageBucket: "visionbomtracker.firebasestorage.app",
  messagingSenderId: "353285721197",
  appId: "1:353285721197:web:d5ccba29d35cf0715a8364",
  measurementId: "G-8L089W4R3X"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Initialize Firebase services
export const db = getFirestore(app);
export const auth = getAuth(app);
export const functions = getFunctions(app);
export const storage = getStorage(app);

// Connect to emulators in development mode
// Set USE_EMULATOR=true in your .env file to enable
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATOR === 'true') {
  try {
    // Connect to Functions emulator (port 5001)
    connectFunctionsEmulator(functions, 'localhost', 5001);
    console.log('🔥 Connected to Firebase Functions Emulator');
  } catch (error) {
    // Emulators already connected, ignore error
    console.log('Emulator connection:', error);
  }
}

// ✅ Google Auth Provider setup
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account', // Forces account selection
  access_type: 'offline',
  include_granted_scopes: 'true'
});
