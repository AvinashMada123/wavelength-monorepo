"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import type { UserProfile } from "@/types/user";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface InitialData {
  settings: Record<string, any>;
  leads: Record<string, any>[];
  calls: Record<string, any>[];
  botConfigs: Record<string, any>[];
  team: Record<string, any>[];
}

interface AuthState {
  user: User | null;
  userProfile: UserProfile | null;
  initialData: InitialData | null;
  loading: boolean;
  initialized: boolean;
}

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    displayName: string,
    orgName: string
  ) => Promise<void>;
  signUpWithInvite: (
    email: string,
    password: string,
    displayName: string,
    inviteId: string
  ) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const INIT_CACHE_KEY = "wl_init";

interface CachedInit {
  profile: UserProfile;
  settings: Record<string, any>;
  leads: Record<string, any>[];
  calls: Record<string, any>[];
  botConfigs: Record<string, any>[];
  team: Record<string, any>[];
}

function getCachedInit(): CachedInit | null {
  try {
    const cached = sessionStorage.getItem(INIT_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

function setCachedInit(data: CachedInit | null) {
  try {
    if (data) {
      sessionStorage.setItem(INIT_CACHE_KEY, JSON.stringify(data));
    } else {
      sessionStorage.removeItem(INIT_CACHE_KEY);
    }
  } catch {
    // sessionStorage not available
  }
}

async function fetchInit(user: User): Promise<CachedInit | null> {
  try {
    const idToken = await user.getIdToken();
    const res = await fetch("/api/data/init", {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result: CachedInit = {
      profile: data.profile,
      settings: data.settings || {},
      leads: data.leads || [],
      calls: data.calls || [],
      botConfigs: data.botConfigs || [],
      team: data.team || [],
    };
    setCachedInit(result);
    return result;
  } catch {
    return null;
  }
}

async function clearSessionCookie() {
  await fetch("/api/auth/session", { method: "DELETE" });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    userProfile: null,
    initialData: null,
    loading: true,
    initialized: false,
  });

  // Flag to skip onAuthStateChanged fetch when signIn/signUp already handled it
  // Must be useRef so the same object is shared across renders and callbacks
  const handledByAction = useRef(false);

  const refreshProfile = useCallback(async () => {
    if (!state.user) return;
    const init = await fetchInit(state.user);
    if (init) {
      setState((prev) => ({
        ...prev,
        userProfile: init.profile,
        initialData: { settings: init.settings, leads: init.leads, calls: init.calls, botConfigs: init.botConfigs, team: init.team },
      }));
    }
  }, [state.user]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Skip if signIn/signUp already fetched data and set state
        if (handledByAction.current) {
          handledByAction.current = false;
          return;
        }

        // Instantly render from cache if available — no server round-trip
        const cached = getCachedInit();
        if (cached && cached.profile?.uid === user.uid) {
          setState({
            user,
            userProfile: cached.profile,
            initialData: { settings: cached.settings, leads: cached.leads, calls: cached.calls, botConfigs: cached.botConfigs, team: cached.team },
            loading: false,
            initialized: true,
          });
          // Silently refresh in background
          fetchInit(user).then((fresh) => {
            if (fresh) {
              setState((prev) => ({
                ...prev,
                userProfile: fresh.profile,
                initialData: { settings: fresh.settings, leads: fresh.leads, calls: fresh.calls, botConfigs: fresh.botConfigs, team: fresh.team },
              }));
            }
          });
        } else {
          // No cache — single API call for everything
          const init = await fetchInit(user);
          if (init) {
            setState({
              user,
              userProfile: init.profile,
              initialData: { settings: init.settings, leads: init.leads, calls: init.calls, botConfigs: init.botConfigs, team: init.team },
              loading: false,
              initialized: true,
            });
          } else {
            setState({ user, userProfile: null, initialData: null, loading: false, initialized: true });
          }
        }
      } else {
        setCachedInit(null);
        setState({ user: null, userProfile: null, initialData: null, loading: false, initialized: true });
      }
    });
    return unsubscribe;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      // Set flag BEFORE signIn so onAuthStateChanged skips its fetch
      handledByAction.current = true;
      const { user } = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await user.getIdToken();

      // Run session cookie + data fetch in parallel
      const [loginRes, init] = await Promise.all([
        fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        }),
        fetchInit(user),
      ]);

      if (!loginRes.ok) {
        const data = await loginRes.json();
        throw new Error(data.message || "Login failed");
      }

      if (init) {
        setState({
          user,
          userProfile: init.profile,
          initialData: { settings: init.settings, leads: init.leads, calls: init.calls, botConfigs: init.botConfigs, team: init.team },
          loading: false,
          initialized: true,
        });
      } else {
        const data = await loginRes.json();
        setState({ user, userProfile: data.profile || null, initialData: null, loading: false, initialized: true });
      }
    } catch (err) {
      handledByAction.current = false;
      setState((prev) => ({ ...prev, loading: false }));
      throw err;
    }
  }, []);

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      displayName: string,
      orgName: string
    ) => {
      setState((prev) => ({ ...prev, loading: true }));
      try {
        handledByAction.current = true;
        const { user } = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );
        await updateProfile(user, { displayName });

        const idToken = await user.getIdToken();
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken, displayName, orgName }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.message || "Failed to create account");
        }

        const data = await res.json();
        const profile = data.profile || null;
        setCachedInit(profile ? { profile, settings: {}, leads: [], calls: [], botConfigs: [], team: [] } : null);
        setState({
          user,
          userProfile: profile,
          initialData: { settings: {}, leads: [], calls: [], botConfigs: [], team: [] },
          loading: false,
          initialized: true,
        });
      } catch (err) {
        handledByAction.current = false;
        setState((prev) => ({ ...prev, loading: false }));
        throw err;
      }
    },
    []
  );

  const signUpWithInvite = useCallback(
    async (
      email: string,
      password: string,
      displayName: string,
      inviteId: string
    ) => {
      setState((prev) => ({ ...prev, loading: true }));
      try {
        handledByAction.current = true;
        const { user } = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );
        await updateProfile(user, { displayName });

        const idToken = await user.getIdToken();
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken, displayName, inviteId }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.message || "Failed to accept invite");
        }

        // Fetch all data for the org being joined
        const init = await fetchInit(user);
        if (init) {
          setState({
            user,
            userProfile: init.profile,
            initialData: { settings: init.settings, leads: init.leads, calls: init.calls, botConfigs: init.botConfigs, team: init.team },
            loading: false,
            initialized: true,
          });
        } else {
          const data = await res.json();
          setState({ user, userProfile: data.profile || null, initialData: null, loading: false, initialized: true });
        }
      } catch (err) {
        handledByAction.current = false;
        setState((prev) => ({ ...prev, loading: false }));
        throw err;
      }
    },
    []
  );

  const signOut = useCallback(async () => {
    setCachedInit(null);
    await clearSessionCookie();
    await firebaseSignOut(auth);
    setState({
      user: null,
      userProfile: null,
      initialData: null,
      loading: false,
      initialized: true,
    });
  }, []);

  return (
    <AuthContext.Provider
      value={{ ...state, signIn, signUp, signUpWithInvite, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuthContext must be used within AuthProvider");
  return context;
}
