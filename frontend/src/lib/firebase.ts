import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth, setPersistence, browserLocalPersistence } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
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
