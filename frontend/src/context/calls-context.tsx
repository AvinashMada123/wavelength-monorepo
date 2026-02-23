"use client";

import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { CallRecord, CallStatus } from "@/types/call";
import { useAuthContext } from "./auth-context";

interface CallsState {
  calls: CallRecord[];
  activeCall: CallRecord | null;
  loaded: boolean;
}

type CallsAction =
  | { type: "SET_CALLS"; payload: CallRecord[] }
  | { type: "ADD_CALL"; payload: CallRecord }
  | { type: "UPDATE_CALL"; payload: { id: string; updates: Partial<CallRecord> } }
  | { type: "SET_ACTIVE_CALL"; payload: CallRecord }
  | { type: "CLEAR_ACTIVE_CALL" };

function callsReducer(state: CallsState, action: CallsAction): CallsState {
  switch (action.type) {
    case "SET_CALLS":
      return { ...state, calls: action.payload, loaded: true };
    case "ADD_CALL":
      return {
        ...state,
        calls: [action.payload, ...state.calls],
      };
    case "UPDATE_CALL": {
      const updated = state.calls.map((c) =>
        c.id === action.payload.id ? { ...c, ...action.payload.updates } : c
      );
      const activeUpdated =
        state.activeCall?.id === action.payload.id
          ? { ...state.activeCall, ...action.payload.updates }
          : state.activeCall;
      return { ...state, calls: updated, activeCall: activeUpdated };
    }
    case "SET_ACTIVE_CALL":
      return { ...state, activeCall: action.payload };
    case "CLEAR_ACTIVE_CALL":
      return { ...state, activeCall: null };
    default:
      return state;
  }
}

const CallsContext = createContext<{
  state: CallsState;
  dispatch: React.Dispatch<CallsAction>;
} | null>(null);

export function CallsProvider({ children }: { children: ReactNode }) {
  const { user, userProfile, initialData } = useAuthContext();
  const orgId = userProfile?.orgId ?? null;

  const [state, baseDispatch] = useReducer(callsReducer, {
    calls: [],
    activeCall: null,
    loaded: false,
  });

  const getToken = useCallback(async () => {
    if (!user) return null;
    return user.getIdToken();
  }, [user]);

  // Use initialData from auth context (pre-fetched in single API call)
  useEffect(() => {
    if (!orgId) {
      baseDispatch({ type: "SET_CALLS", payload: [] });
      return;
    }
    if (initialData) {
      baseDispatch({ type: "SET_CALLS", payload: initialData.calls as CallRecord[] });
    }
  }, [orgId, initialData]);

  // Enhanced dispatch that also persists via server API
  const dispatch: React.Dispatch<CallsAction> = useCallback(
    (action: CallsAction) => {
      baseDispatch(action);

      if (!orgId) return;

      const apiCall = async (body: Record<string, unknown>) => {
        const token = await getToken();
        if (!token) return;
        await fetch("/api/data/calls", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
      };

      switch (action.type) {
        case "ADD_CALL": {
          apiCall({ action: "add", call: action.payload }).catch((err) =>
            console.error("Failed to add call:", err)
          );
          break;
        }
        case "UPDATE_CALL": {
          apiCall({ action: "update", id: action.payload.id, updates: action.payload.updates }).catch((err) =>
            console.error("Failed to update call:", err)
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
    <CallsContext.Provider value={{ state, dispatch }}>
      {children}
    </CallsContext.Provider>
  );
}

export function useCallsContext() {
  const ctx = useContext(CallsContext);
  if (!ctx) throw new Error("useCallsContext must be within CallsProvider");
  return ctx;
}

// Re-export CallStatus for convenience
export type { CallStatus };
