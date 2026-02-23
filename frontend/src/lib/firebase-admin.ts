import { initializeApp, getApps, cert, type ServiceAccount, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

let _app: App | null = null;
let _auth: Auth | null = null;

function ensureApp(): App {
  if (_app) return _app;

  if (getApps().length > 0) {
    _app = getApps()[0];
    return _app;
  }

  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY env var is not set");
  }

  const serviceAccount = JSON.parse(key) as ServiceAccount;
  _app = initializeApp({ credential: cert(serviceAccount) });
  return _app;
}

export function getAdminAuth(): Auth {
  if (!_auth) _auth = getAuth(ensureApp());
  return _auth;
}

// Backward-compatible exports using getter properties
export const adminAuth = {
  get instance() {
    return getAdminAuth();
  },
  createSessionCookie(...args: Parameters<Auth["createSessionCookie"]>) {
    return getAdminAuth().createSessionCookie(...args);
  },
  verifySessionCookie(...args: Parameters<Auth["verifySessionCookie"]>) {
    return getAdminAuth().verifySessionCookie(...args);
  },
};
