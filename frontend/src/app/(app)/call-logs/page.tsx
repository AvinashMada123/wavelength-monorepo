"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { PhoneOff, RefreshCw } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CallLogsToolbar, EMPTY_FILTERS } from "@/components/call-logs/call-logs-toolbar";
import { CallLogsTable } from "@/components/call-logs/call-logs-table";
import { CallLogsPagination } from "@/components/call-logs/call-logs-pagination";
import { EmptyState } from "@/components/shared/empty-state";
import { exportCallsCSV } from "@/lib/call-logs-export";
import { useCalls } from "@/hooks/use-calls";
import { useCallsContext } from "@/context/calls-context";
import { useAuthContext } from "@/context/auth-context";
import { ITEMS_PER_PAGE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { CallRecord } from "@/types/call";
import type { CallLogsFilters } from "@/components/call-logs/call-logs-toolbar";
import type { Lead } from "@/types/lead";

export default function CallLogsPage() {
  const { user, initialData } = useAuthContext();
  const { calls, loaded } = useCalls();
  const { dispatch } = useCallsContext();
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<CallLogsFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Build lead lookup map from initialData
  const leadMap = useMemo(() => {
    const map = new Map<string, Lead>();
    const leads = (initialData?.leads || []) as Lead[];
    for (const lead of leads) {
      map.set(lead.id, lead);
    }
    return map;
  }, [initialData?.leads]);

  // Enrich calls with lead tags and custom fields
  const enrichedCalls = useMemo(() => {
    return calls.map((call) => {
      if (!call.leadId) return call;
      const lead = leadMap.get(call.leadId);
      if (!lead) return call;
      return {
        ...call,
        leadTags: lead.tags || [],
        leadCustomFields: lead.customFields || {},
      };
    });
  }, [calls, leadMap]);

  const handleRefresh = useCallback(async () => {
    if (!user) return;
    setRefreshing(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/data/calls", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        dispatch({ type: "SET_CALLS", payload: data.calls });
      }
    } catch {
      // silently ignore
    } finally {
      setRefreshing(false);
    }
  }, [user, dispatch]);

  // Derive unique bot config names
  const botConfigOptions = useMemo(() => {
    const names = new Set<string>();
    for (const c of enrichedCalls) {
      const name = c.botConfigName || c.request.botConfigName;
      if (name) names.add(name);
    }
    return Array.from(names).sort();
  }, [enrichedCalls]);

  // Derive unique tags from ALL leads (not just those linked to visible calls)
  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    const leads = (initialData?.leads || []) as Lead[];
    for (const lead of leads) {
      if (lead.tags) {
        for (const t of lead.tags) {
          if (t) tags.add(t);
        }
      }
    }
    return Array.from(tags).sort();
  }, [initialData?.leads]);

  // Apply filters
  const filteredCalls = useMemo(() => {
    let result = enrichedCalls
      .slice()
      .sort((a, b) => new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime());

    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (c) =>
          c.request.contactName?.toLowerCase().includes(q) ||
          c.request.phoneNumber?.includes(q)
      );
    }

    if (filters.status !== "all") {
      result = result.filter((c) => c.status === filters.status);
    }

    if (filters.interestLevel !== "all") {
      result = result.filter((c) => c.interestLevel === filters.interestLevel);
    }

    if (filters.botConfig !== "all") {
      result = result.filter(
        (c) => (c.botConfigName || c.request.botConfigName) === filters.botConfig
      );
    }

    if (filters.tags.length > 0) {
      result = result.filter((c) =>
        filters.tags.some((t) => c.leadTags?.includes(t))
      );
    }

    // Custom column "contains" filters
    for (const cf of filters.customFilters) {
      if (!cf.value) continue;
      const q = cf.value.toLowerCase();
      result = result.filter((c) => {
        switch (cf.column) {
          case "contactName":
            return c.request.contactName?.toLowerCase().includes(q);
          case "phoneNumber":
            return c.request.phoneNumber?.includes(q);
          case "botConfigName":
            return (c.botConfigName || c.request.botConfigName || "").toLowerCase().includes(q);
          case "callSummary":
            return c.callSummary?.toLowerCase().includes(q);
          case "interestLevel":
            return c.interestLevel?.toLowerCase().includes(q);
          default:
            return true;
        }
      });
    }

    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom);
      from.setHours(0, 0, 0, 0);
      result = result.filter((c) => new Date(c.initiatedAt) >= from);
    }

    if (filters.dateTo) {
      const to = new Date(filters.dateTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter((c) => new Date(c.initiatedAt) <= to);
    }

    return result;
  }, [enrichedCalls, filters]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [filters]);

  // Paginate
  const paginatedCalls = useMemo(() => {
    const start = (page - 1) * ITEMS_PER_PAGE;
    return filteredCalls.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredCalls, page]);

  const handleDownload = () => {
    if (selectedIds.size > 0) {
      const selected = filteredCalls.filter((c) => selectedIds.has(c.id));
      exportCallsCSV(selected);
    } else {
      exportCallsCSV(filteredCalls);
    }
  };

  const handleFiltersChange = (newFilters: CallLogsFilters) => {
    setFilters(newFilters);
    setSelectedIds(new Set());
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(filteredCalls.map((c) => c.id)));
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Call Logs</h1>
          <p className="text-sm text-muted-foreground">
            View, filter, and export your complete call history.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", refreshing && "animate-spin")} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CallLogsToolbar
            filters={filters}
            onFiltersChange={handleFiltersChange}
            botConfigOptions={botConfigOptions}
            tagOptions={tagOptions}
            onDownload={handleDownload}
            totalFiltered={filteredCalls.length}
            totalAll={enrichedCalls.length}
            selectedCount={selectedIds.size}
            onSelectAll={handleSelectAll}
            onClearSelection={handleClearSelection}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {filteredCalls.length === 0 ? (
            <EmptyState
              icon={<PhoneOff className="h-12 w-12" />}
              title={enrichedCalls.length === 0 ? "No calls yet" : "No matching calls"}
              description={
                enrichedCalls.length === 0
                  ? "Initiate your first call to see logs here."
                  : "Try adjusting your filters to find what you're looking for."
              }
            />
          ) : (
            <>
              <CallLogsTable
                calls={paginatedCalls}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
              />
              <CallLogsPagination
                page={page}
                totalItems={filteredCalls.length}
                onPageChange={setPage}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
