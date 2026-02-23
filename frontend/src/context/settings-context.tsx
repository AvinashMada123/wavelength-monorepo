"use client";

import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { AppSettings } from "@/types/settings";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import { useAuthContext } from "./auth-context";

type SettingsAction =
  | { type: "SET_SETTINGS"; payload: AppSettings }
  | { type: "UPDATE_SETTINGS"; payload: Partial<AppSettings> }
  | { type: "RESET" };

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
}

function settingsReducer(
  state: SettingsState,
  action: SettingsAction
): SettingsState {
  switch (action.type) {
    case "SET_SETTINGS":
      return { ...state, settings: action.payload, loaded: true };
    case "UPDATE_SETTINGS":
      return {
        ...state,
        settings: {
          ...state.settings,
          ...action.payload,
          defaults: {
            ...state.settings.defaults,
            ...(action.payload.defaults || {}),
          },
          appearance: {
            ...state.settings.appearance,
            ...(action.payload.appearance || {}),
          },
          ai: {
            ...state.settings.ai,
            ...(action.payload.ai || {}),
          },
        },
      };
    case "RESET":
      return { ...state, settings: DEFAULT_SETTINGS };
    default:
      return state;
  }
}

const SettingsContext = createContext<{
  state: SettingsState;
  dispatch: React.Dispatch<SettingsAction>;
} | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user, userProfile, initialData } = useAuthContext();
  const orgId = userProfile?.orgId ?? null;

  const [state, baseDispatch] = useReducer(settingsReducer, {
    settings: DEFAULT_SETTINGS,
    loaded: false,
  });

  const getToken = useCallback(async () => {
    if (!user) return null;
    return user.getIdToken();
  }, [user]);

  // Use initialData from auth context (pre-fetched in single API call)
  useEffect(() => {
    if (!orgId) {
      baseDispatch({ type: "SET_SETTINGS", payload: DEFAULT_SETTINGS });
      return;
    }
    if (initialData) {
      // Deep merge: preserve all DEFAULT_SETTINGS fields that DB settings may not have
      const db = (initialData.settings || {}) as Partial<AppSettings>;
      baseDispatch({
        type: "SET_SETTINGS",
        payload: {
          ...DEFAULT_SETTINGS,
          ...db,
          defaults: { ...DEFAULT_SETTINGS.defaults, ...(db.defaults || {}) },
          appearance: { ...DEFAULT_SETTINGS.appearance, ...(db.appearance || {}) },
          ai: { ...DEFAULT_SETTINGS.ai, ...(db.ai || {}) },
        },
      });
    }
  }, [orgId, initialData]);

  // Enhanced dispatch that also persists via server API
  const dispatch: React.Dispatch<SettingsAction> = useCallback(
    (action: SettingsAction) => {
      baseDispatch(action);

      if (!orgId) return;

      const persistSettings = async (settings: Partial<AppSettings>) => {
        const token = await getToken();
        if (!token) return;
        await fetch("/api/data/settings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ settings }),
        });
      };

      switch (action.type) {
        case "UPDATE_SETTINGS": {
          persistSettings(action.payload).catch((err) =>
            console.error("Failed to update settings:", err)
          );
          break;
        }
        case "RESET": {
          persistSettings(DEFAULT_SETTINGS).catch((err) =>
            console.error("Failed to reset settings:", err)
          );
          break;
        }
        default:
          break;
      }
    },
    [orgId, getToken]
  );

  return (
    <SettingsContext.Provider value={{ state, dispatch }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettingsContext() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettingsContext must be within SettingsProvider");
  return ctx;
}
