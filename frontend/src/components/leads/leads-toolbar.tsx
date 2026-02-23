"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Trash2, Phone, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLeads } from "@/hooks/use-leads";
import { useSettings } from "@/hooks/use-settings";
import { useCalls } from "@/hooks/use-calls";
import { BulkCallDialog } from "@/components/leads/bulk-call-dialog";
import { toast } from "sonner";
import type { LeadStatus, CustomFilter } from "@/types/lead";
import type { Lead } from "@/types/lead";
import type { CallRequest } from "@/types/call";

const FILTERABLE_COLUMNS: { value: string; label: string }[] = [
  { value: "contactName", label: "Name" },
  { value: "phoneNumber", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "company", label: "Company" },
  { value: "location", label: "Location" },
  { value: "qualificationLevel", label: "Qualification" },
  { value: "botNotes", label: "Bot Notes" },
];

const MAX_CONCURRENT = 5;

export function LeadsToolbar() {
  const { leads, filters, setFilters, selectedIds, deleteLeads, deselectAll, incrementCallCount, allTags } =
    useLeads();
  const { settings } = useSettings();
  const { initiateCall } = useCalls();
  const [searchValue, setSearchValue] = useState(filters.search);
  const [bulkCallOpen, setBulkCallOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const customFilters: CustomFilter[] = filters.customFilters || [];

  const addCustomFilter = () => {
    setFilters({ customFilters: [...customFilters, { column: "contactName", value: "" }] });
  };

  const updateCustomFilter = (index: number, updates: Partial<CustomFilter>) => {
    const updated = customFilters.map((f, i) => (i === index ? { ...f, ...updates } : f));
    setFilters({ customFilters: updated });
  };

  const removeCustomFilter = (index: number) => {
    setFilters({ customFilters: customFilters.filter((_, i) => i !== index) });
  };

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setFilters({ search: searchValue });
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchValue, setFilters]);

  const handleDeleteSelected = () => {
    deleteLeads(selectedIds);
    deselectAll();
  };

  const selectedLeads = leads.filter((l) => selectedIds.includes(l.id));

  const startBulkCalls = useCallback(async (botConfigId?: string) => {
    const leadsToCall = [...selectedLeads];
    deselectAll();

    const toastId = toast.loading(
      `Bulk calling 0/${leadsToCall.length} complete...`
    );

    let succeeded = 0;
    let failed = 0;
    let idx = 0;

    while (idx < leadsToCall.length) {
      const batch = leadsToCall.slice(idx, idx + MAX_CONCURRENT);

      const results = await Promise.allSettled(
        batch.map(async (lead) => {
          const request: CallRequest = {
            phoneNumber: lead.phoneNumber,
            contactName: lead.contactName,
            clientName: settings.defaults.clientName,
            agentName: settings.defaults.agentName,
            companyName: lead.company || settings.defaults.companyName,
            eventName: settings.defaults.eventName,
            eventHost: settings.defaults.eventHost,
            voice: settings.defaults.voice,
            location: lead.location || settings.defaults.location,
            botConfigId,
          };

          await initiateCall(request, lead.id);
          incrementCallCount(lead.id);
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled") succeeded++;
        else failed++;
      }

      idx += batch.length;

      toast.loading(
        `Bulk calling ${succeeded + failed}/${leadsToCall.length} complete...`,
        { id: toastId }
      );

      if (idx < leadsToCall.length) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    toast.success(
      `Bulk call finished — ${succeeded} succeeded${failed > 0 ? `, ${failed} failed` : ""}`,
      { id: toastId }
    );
  }, [selectedLeads, settings.defaults, initiateCall, incrementCallCount, deselectAll]);

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-1 items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search leads..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select
            value={filters.status}
            onValueChange={(value) =>
              setFilters({ status: value as LeadStatus | "all" })
            }
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="contacted">Contacted</SelectItem>
              <SelectItem value="qualified">Qualified</SelectItem>
              <SelectItem value="unresponsive">Unresponsive</SelectItem>
              <SelectItem value="do-not-call">Do Not Call</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={filters.source}
            onValueChange={(value) =>
              setFilters({ source: value as Lead["source"] | "all" })
            }
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="csv">CSV</SelectItem>
              <SelectItem value="excel">Excel</SelectItem>
              <SelectItem value="ghl">GoHighLevel</SelectItem>
            </SelectContent>
          </Select>

          {allTags.length > 0 && (
            <Select
              value={filters.tag}
              onValueChange={(value) => setFilters({ tag: value })}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Tag" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tags</SelectItem>
                {allTags.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={addCustomFilter}
            className="h-9 gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Filter
          </Button>
        </div>

        {customFilters.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {customFilters.map((cf, index) => (
              <div key={index} className="flex items-center gap-1.5 rounded-md border px-2 py-1 bg-muted/40">
                <Select
                  value={cf.column}
                  onValueChange={(value) => updateCustomFilter(index, { column: value })}
                >
                  <SelectTrigger className="h-7 w-[130px] border-0 bg-transparent p-0 text-sm shadow-none focus:ring-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FILTERABLE_COLUMNS.map((col) => (
                      <SelectItem key={col.value} value={col.value}>
                        {col.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground text-xs">contains</span>
                <Input
                  value={cf.value}
                  onChange={(e) => updateCustomFilter(index, { value: e.target.value })}
                  placeholder="value..."
                  className="h-7 w-[120px] border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                />
                <button
                  onClick={() => removeCustomFilter(index)}
                  className="text-muted-foreground hover:text-foreground ml-1"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div />
        <AnimatePresence>
          {selectedIds.length > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-2"
            >
              <Button
                size="sm"
                onClick={() => setBulkCallOpen(true)}
              >
                <Phone className="mr-2 h-4 w-4" />
                Call Selected ({selectedIds.length})
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteSelected}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Selected ({selectedIds.length})
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <BulkCallDialog
        open={bulkCallOpen}
        onOpenChange={setBulkCallOpen}
        leads={selectedLeads}
        onConfirm={startBulkCalls}
      />
    </>
  );
}
