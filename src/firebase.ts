// src/firebase.ts
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

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

// ✅ Google Auth Provider setup
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account', // Forces account selection
  access_type: 'offline',
  include_granted_scopes: 'true'
});
