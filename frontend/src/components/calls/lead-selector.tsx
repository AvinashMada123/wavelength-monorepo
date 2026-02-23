"use client";

import { useState, useMemo } from "react";
import { Check, Search, User } from "lucide-react";
import { cn, formatPhoneNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLeads } from "@/hooks/use-leads";
import type { Lead } from "@/types/lead";

interface LeadSelectorProps {
  onSelectLead: (lead: Lead) => void;
  selectedLeadId?: string | null;
}

export function LeadSelector({ onSelectLead, selectedLeadId }: LeadSelectorProps) {
  const { leads } = useLeads();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredLeads = useMemo(() => {
    const query = search.toLowerCase();
    if (!query) return leads;
    return leads.filter(
      (lead) =>
        lead.contactName.toLowerCase().includes(query) ||
        lead.phoneNumber.includes(query) ||
        (lead.email?.toLowerCase().includes(query) ?? false) ||
        (lead.company?.toLowerCase().includes(query) ?? false)
    );
  }, [leads, search]);

  const selectedLead = leads.find((l) => l.id === selectedLeadId);

  const handleSelect = (lead: Lead) => {
    onSelectLead(lead);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {selectedLead ? (
            <span className="flex items-center gap-2 truncate">
              <User className="h-4 w-4 shrink-0" />
              {selectedLead.contactName} &mdash;{" "}
              {formatPhoneNumber(selectedLead.phoneNumber)}
            </span>
          ) : (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Search className="h-4 w-4 shrink-0" />
              Search existing leads...
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="border-b p-2">
          <Input
            placeholder="Search by name, phone, company..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9"
            autoFocus
          />
        </div>
        <ScrollArea className="max-h-[250px]">
          {filteredLeads.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No leads found
            </div>
          ) : (
            <div className="p-1">
              {filteredLeads.slice(0, 50).map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => handleSelect(lead)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent transition-colors",
                    selectedLeadId === lead.id && "bg-accent"
                  )}
                >
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="font-medium truncate">{lead.contactName}</div>
                    <div className="text-muted-foreground text-xs">
                      {formatPhoneNumber(lead.phoneNumber)}
                      {lead.company && ` · ${lead.company}`}
                    </div>
                  </div>
                  {selectedLeadId === lead.id && (
                    <Check className="h-4 w-4 shrink-0 mt-0.5" />
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
