"use client";

import { useMemo, useState } from "react";
import { useLeadsContext } from "@/context/leads-context";
import type { Lead, LeadFilters } from "@/types/lead";
import { ITEMS_PER_PAGE } from "@/lib/constants";
import { generateId } from "@/lib/utils";

export function useLeads() {
  const { state, dispatch } = useLeadsContext();
  const [page, setPage] = useState(1);

  const filteredLeads = useMemo(() => {
    let result = state.leads;

    if (state.filters.status !== "all") {
      result = result.filter((l) => l.status === state.filters.status);
    }
    if (state.filters.source !== "all") {
      result = result.filter((l) => l.source === state.filters.source);
    }
    if (state.filters.tag && state.filters.tag !== "all") {
      result = result.filter((l) => l.tags?.includes(state.filters.tag));
    }
    if (state.filters.search) {
      const q = state.filters.search.toLowerCase();
      result = result.filter(
        (l) =>
          l.contactName.toLowerCase().includes(q) ||
          l.phoneNumber.includes(q) ||
          (l.email?.toLowerCase().includes(q) ?? false) ||
          (l.company?.toLowerCase().includes(q) ?? false)
      );
    }

    if (state.filters.customFilters?.length) {
      for (const cf of state.filters.customFilters) {
        if (!cf.column || !cf.value) continue;
        const q = cf.value.toLowerCase();
        result = result.filter((l) => {
          const val = (l as unknown as Record<string, unknown>)[cf.column];
          if (val == null) return false;
          return String(val).toLowerCase().includes(q);
        });
      }
    }

    return result;
  }, [state.leads, state.filters]);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const lead of state.leads) {
      if (lead.tags) {
        for (const tag of lead.tags) {
          tagSet.add(tag);
        }
      }
    }
    return Array.from(tagSet).sort();
  }, [state.leads]);

  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / ITEMS_PER_PAGE));
  const paginatedLeads = filteredLeads.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE
  );

  return {
    leads: state.leads,
    filteredLeads,
    paginatedLeads,
    page,
    setPage,
    totalPages,
    filters: state.filters,
    selectedIds: state.selectedIds,
    loaded: state.loaded,

    addLead: (lead: Omit<Lead, "id" | "createdAt" | "updatedAt" | "callCount" | "status">): string => {
      const id = generateId();
      dispatch({ type: "ADD_LEAD", payload: { ...lead, id } });
      return id;
    },

    addLeadsBulk: (leads: Partial<Lead>[], source: Lead["source"]) => {
      dispatch({ type: "ADD_LEADS_BULK", payload: { leads, source } });
    },

    updateLead: (id: string, updates: Partial<Lead>) => {
      dispatch({ type: "UPDATE_LEAD", payload: { id, updates } });
    },

    deleteLeads: (ids: string[]) => {
      dispatch({ type: "DELETE_LEADS", payload: ids });
    },

    setFilters: (filters: Partial<LeadFilters>) => {
      dispatch({ type: "SET_FILTERS", payload: filters });
      setPage(1);
    },

    toggleSelect: (id: string) => {
      dispatch({ type: "TOGGLE_SELECT", payload: id });
    },

    selectAll: () => {
      dispatch({
        type: "SELECT_ALL",
        payload: filteredLeads.map((l) => l.id),
      });
    },

    deselectAll: () => {
      dispatch({ type: "DESELECT_ALL" });
    },

    incrementCallCount: (id: string) => {
      dispatch({ type: "INCREMENT_CALL_COUNT", payload: id });
    },

    mergeGhlLeads: (leads: Lead[]) => {
      dispatch({ type: "MERGE_GHL_LEADS", payload: leads });
    },

    allTags,
    totalLeads: state.leads.length,
    newLeads: state.leads.filter((l) => l.status === "new").length,
    contactedLeads: state.leads.filter((l) => l.status === "contacted").length,
  };
}
