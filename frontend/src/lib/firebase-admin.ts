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

  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{"type":"service_account","project_id":"ai-calling-9238e","private_key_id":"39a396a64a5f8a428420504c913a1c94ecee90ba","private_key":"-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC10NzojGHUepn5\\nG3SJ5umecU5os2Q8ahGjia5NFVln6UMWeBRjyVY2zu9xA7yH9izJEgU88TuV5dRU\\nVbur1hOGzX4X5LlPMheNRRxsLtZhisFSHWQ4wYOrxopjHNLAspLDCPZbWOV+IzVG\\nBfv01eH2UXqX4sDi9CqVyL/NwK6FFIiISd8WGzseiT+LqIZ04y8JwFBczk+FG5mh\\n3Ok4PrXMsW5oBZXOa9F5qR/iIcD1kwSd//SMzWYUmdnZkNxBD341gxz/418rja4f\\n+m/YqMWKMx6gHqiaJ+TsGYeM1VVbaVGNqHsZMNmvMlVnwx8mJN9SJl3xVQ5yCst0\\nIF29/h8dAgMBAAECggEAAKisnEUh96CoHTB9yCAnmZTkiVmZE+T4gmS11n6sz8UX\\nIqY1wLTSlKlEUd8HGGEKgYIItdNT+XOXROT4pKNGd9cXzWNdTo2qay8kbrnuufTE\\nRZVorxH4da9nAfvxQZSEFqPaLLOSRVZAU6wi4RzDUF60OIewVkI3Q0qycz7vAvly\\nAHq3o7/caALyTLKamyx7UHqDR2xQMB8izovyU1HzDgOkRLavK6aOAwb1FBCR6mhN\\nQsX6/Rob3pQkKAdh3JSK5RMVZyZbsAi7aN4VXL3WKFq4omhCBfj7OCQ8FEBFX1+w\\nx9/0tAU4PrRifJ+B7UbSABgFpgnvnsR97pfSfSG/KwKBgQDw5o+VLfXzjkOppjrX\\nfei3P0rGpRsCpKCNF1C2UPyYqVLVbv1PZl3EVUwYTFY7exM5cOI3+yrmn17ZNiMI\\nJA6UfXTGvqSYenqWva1zP9XRngxASnlrea6gBhY0gIPQ1U3CFQ85a8FNtNrzyqxj\\ndynPXookTpr4fhmGea5E1euTowKBgQDBNj2p4A+Nw6FpAhi9wYclX+8P/AwbXSrS\\nrU5bk2zTV2+KCcprxZbE1bXXmFRvZ/DKjmfUMZjT3tpHDqNNarcaow9waWKFmF6a\\nx6Faj/yPePKaSeeap76WJaiLHS/4PdIY1Qrj7R1XPhvkB8512l54D5yAtgmtt3Wi\\nqd5WZWSuPwKBgQDFwgAMzvYhQqB5HGUhkdMA24xfFhreSJckPAeeI025ZQcC/2Ij\\nVD2VdxBIwiHoIljdxrVuj1ngiOQsHC0V+cOeUn8SyF4GbkVEieFhwv2cXspf3MNg\\nXzvjUhvYbcfIH9L9iJw+3x6I0/cKO07ZOHGyMkHlHEJLy/jYU/ujtpj1UQKBgG6/\\nJXdCvAeZM+LZ1c6mqE1vALub0GC69XnO5tQs27sEKiXoWMOPfU0T5mhOo088N9QS\\n7ka9qwj+ewUxyb7tRUkaYBYiAdvrq4ZymPUtBSpDvGNdq0iFkAPGUCZ1M3LKFKwx\\nKU3eMuw36Iq7QsdgxLdy01Ufgsq1FtOHJK9G7P/HAoGARZLRehGBxJ5zR6Fu38i9\\novMjAjgBkeGTHrmI5ZzKp/9ThBfSl8qGRcNWsq2lb5HcKTivhjlsBeR++7qktg+N\\nUMb9eWohSUNcC5fdJmiw+N3znWWTpdiP3Rxk0QJto0tCxXwvx3a3V3PfquDIGFnB\\nLPQF7Epaedieosgfil+hZQ0=\\n-----END PRIVATE KEY-----\\n","client_email":"firebase-adminsdk-fbsvc@ai-calling-9238e.iam.gserviceaccount.com","client_id":"101357174601676443468","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40ai-calling-9238e.iam.gserviceaccount.com","universe_domain":"googleapis.com"}';
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
