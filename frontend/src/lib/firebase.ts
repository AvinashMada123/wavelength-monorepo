import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth, setPersistence, browserLocalPersistence } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyAQIqWTCaTVbUynpkHnOHLh2NVRY1-AKes",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "ai-calling-9238e.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "ai-calling-9238e",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "ai-calling-9238e.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "664021114212",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:664021114212:web:fcbb6ad789d2cc914cae71",
};

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;

function getFirebaseApp(): FirebaseApp {
  if (_app) return _app;
  _app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  return _app;
}

function getFirebaseAuth(): Auth {
  if (_auth) return _auth;
  const authInstance = getAuth(getFirebaseApp());
  setPersistence(authInstance, browserLocalPersistence).catch((err) => {
    console.error("Failed to set auth persistence:", err);
  });
  _auth = authInstance;
  return _auth;
}

// Lazy getters — only initialize when actually accessed at runtime
export const app = typeof window !== "undefined" ? getFirebaseApp() : ({} as FirebaseApp);
export const auth = typeof window !== "undefined" ? getFirebaseAuth() : ({} as Auth);

// Export getters for code that needs to ensure runtime initialization
export { getFirebaseApp, getFirebaseAuth };
