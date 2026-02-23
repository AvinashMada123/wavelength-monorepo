"use client";

import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { Lead, LeadFilters } from "@/types/lead";
import { generateId } from "@/lib/utils";
import { useAuthContext } from "./auth-context";

interface LeadsState {
  leads: Lead[];
  filters: LeadFilters;
  selectedIds: string[];
  loaded: boolean;
}

type LeadsAction =
  | { type: "SET_LEADS"; payload: Lead[] }
  | { type: "ADD_LEAD"; payload: Omit<Lead, "createdAt" | "updatedAt" | "callCount" | "status"> }
  | { type: "ADD_LEADS_BULK"; payload: { leads: Partial<Lead>[]; source: Lead["source"] } }
  | { type: "UPDATE_LEAD"; payload: { id: string; updates: Partial<Lead> } }
  | { type: "DELETE_LEADS"; payload: string[] }
  | { type: "SET_FILTERS"; payload: Partial<LeadFilters> }
  | { type: "TOGGLE_SELECT"; payload: string }
  | { type: "SELECT_ALL"; payload: string[] }
  | { type: "DESELECT_ALL" }
  | { type: "INCREMENT_CALL_COUNT"; payload: string }
  | { type: "MERGE_GHL_LEADS"; payload: Lead[] };

const initialFilters: LeadFilters = {
  search: "",
  status: "all",
  source: "all",
  tag: "all",
  customFilters: [],
};

function leadsReducer(state: LeadsState, action: LeadsAction): LeadsState {
  switch (action.type) {
    case "SET_LEADS":
      return { ...state, leads: action.payload, loaded: true };
    case "ADD_LEAD": {
      const now = new Date().toISOString();
      const newLead: Lead = {
        ...action.payload,
        callCount: 0,
        status: "new",
        createdAt: now,
        updatedAt: now,
      };
      return { ...state, leads: [newLead, ...state.leads] };
    }
    case "ADD_LEADS_BULK": {
      const now = new Date().toISOString();
      const newLeads: Lead[] = action.payload.leads.map((l) => ({
        id: generateId(),
        phoneNumber: l.phoneNumber || "",
        contactName: l.contactName || "",
        email: l.email,
        company: l.company,
        location: l.location,
        tags: l.tags,
        status: "new" as const,
        callCount: 0,
        createdAt: now,
        updatedAt: now,
        source: action.payload.source,
      }));
      return { ...state, leads: [...newLeads, ...state.leads] };
    }
    case "UPDATE_LEAD":
      return {
        ...state,
        leads: state.leads.map((l) =>
          l.id === action.payload.id
            ? { ...l, ...action.payload.updates, updatedAt: new Date().toISOString() }
            : l
        ),
      };
    case "DELETE_LEADS":
      return {
        ...state,
        leads: state.leads.filter((l) => !action.payload.includes(l.id)),
        selectedIds: state.selectedIds.filter((id) => !action.payload.includes(id)),
      };
    case "SET_FILTERS":
      return {
        ...state,
        filters: { ...state.filters, ...action.payload },
      };
    case "TOGGLE_SELECT": {
      const exists = state.selectedIds.includes(action.payload);
      return {
        ...state,
        selectedIds: exists
          ? state.selectedIds.filter((id) => id !== action.payload)
          : [...state.selectedIds, action.payload],
      };
    }
    case "SELECT_ALL":
      return { ...state, selectedIds: action.payload };
    case "DESELECT_ALL":
      return { ...state, selectedIds: [] };
    case "INCREMENT_CALL_COUNT":
      return {
        ...state,
        leads: state.leads.map((l) =>
          l.id === action.payload
            ? {
                ...l,
                callCount: l.callCount + 1,
                lastCallDate: new Date().toISOString(),
                status: l.status === "new" ? "contacted" : l.status,
                updatedAt: new Date().toISOString(),
              }
            : l
        ),
      };
    case "MERGE_GHL_LEADS": {
      const incoming = action.payload;
      const existingGhlIds = new Map(
        state.leads
          .filter((l) => l.ghlContactId)
          .map((l) => [l.ghlContactId!, l.id])
      );
      const updatedLeads = state.leads.map((l) => {
        if (!l.ghlContactId) return l;
        const match = incoming.find((g) => g.ghlContactId === l.ghlContactId);
        if (match) return { ...l, ...match, id: l.id, status: l.status, callCount: l.callCount };
        return l;
      });
      const newLeads = incoming.filter(
        (g) => !existingGhlIds.has(g.ghlContactId!)
      );
      return { ...state, leads: [...newLeads, ...updatedLeads] };
    }
    default:
      return state;
  }
}

const LeadsContext = createContext<{
  state: LeadsState;
  dispatch: React.Dispatch<LeadsAction>;
} | null>(null);

export function LeadsProvider({ children }: { children: ReactNode }) {
  const { user, userProfile, initialData } = useAuthContext();
  const orgId = userProfile?.orgId ?? null;

  const [state, baseDispatch] = useReducer(leadsReducer, {
    leads: [],
    filters: initialFilters,
    selectedIds: [],
    loaded: false,
  });

  const getToken = useCallback(async () => {
    if (!user) return null;
    return user.getIdToken();
  }, [user]);

  // Use initialData from auth context (pre-fetched in single API call)
  useEffect(() => {
    if (!orgId) {
      baseDispatch({ type: "SET_LEADS", payload: [] });
      return;
    }
    if (initialData) {
      baseDispatch({ type: "SET_LEADS", payload: initialData.leads as Lead[] });
    }
  }, [orgId, initialData]);

  // Enhanced dispatch that also persists via server API
  const dispatch: React.Dispatch<LeadsAction> = useCallback(
    (action: LeadsAction) => {
      baseDispatch(action);

      if (!orgId) return;

      const apiCall = async (body: Record<string, unknown>) => {
        const token = await getToken();
        if (!token) return;
        await fetch("/api/data/leads", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
      };

      switch (action.type) {
        case "ADD_LEAD": {
          const now = new Date().toISOString();
          const newLead: Lead = {
            ...action.payload,
            callCount: 0,
            status: "new",
            createdAt: now,
            updatedAt: now,
          };
          apiCall({ action: "add", lead: newLead }).catch((err) =>
            console.error("Failed to add lead:", err)
          );
          break;
        }
        case "ADD_LEADS_BULK": {
          const now = new Date().toISOString();
          const newLeads: Lead[] = action.payload.leads.map((l) => ({
            id: generateId(),
            phoneNumber: l.phoneNumber || "",
            contactName: l.contactName || "",
            email: l.email,
            company: l.company,
            location: l.location,
            tags: l.tags,
            status: "new" as const,
            callCount: 0,
            createdAt: now,
            updatedAt: now,
            source: action.payload.source,
          }));
          apiCall({ action: "addBulk", leads: newLeads }).catch((err) =>
            console.error("Failed to bulk add leads:", err)
          );
          break;
        }
        case "UPDATE_LEAD": {
          apiCall({ action: "update", id: action.payload.id, updates: action.payload.updates }).catch((err) =>
            console.error("Failed to update lead:", err)
          );
          break;
        }
        case "DELETE_LEADS": {
          apiCall({ action: "delete", ids: action.payload }).catch((err) =>
            console.error("Failed to delete leads:", err)
          );
          break;
        }
        case "INCREMENT_CALL_COUNT": {
          apiCall({ action: "incrementCallCount", id: action.payload }).catch((err) =>
            console.error("Failed to increment call count:", err)
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
    <LeadsContext.Provider value={{ state, dispatch }}>
      {children}
    </LeadsContext.Provider>
  );
}

export function useLeadsContext() {
  const ctx = useContext(LeadsContext);
  if (!ctx) throw new Error("useLeadsContext must be within LeadsProvider");
  return ctx;
}
