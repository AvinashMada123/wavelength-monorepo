"use client";

import { Search, Download, X, Calendar, Plus, Tag } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CALL_STATUS_CONFIG } from "@/lib/constants";
import type { CallStatus } from "@/types/call";

export interface CustomFilter {
  column: string;
  value: string;
}

export interface CallLogsFilters {
  search: string;
  status: CallStatus | "all";
  interestLevel: string;
  botConfig: string;
  tags: string[];
  customFilters: CustomFilter[];
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_FILTERS: CallLogsFilters = {
  search: "",
  status: "all",
  interestLevel: "all",
  botConfig: "all",
  tags: [],
  customFilters: [],
  dateFrom: "",
  dateTo: "",
};

const FILTERABLE_COLUMNS: { value: string; label: string }[] = [
  { value: "contactName", label: "Name" },
  { value: "phoneNumber", label: "Phone" },
  { value: "botConfigName", label: "Bot Config" },
  { value: "callSummary", label: "Summary" },
  { value: "interestLevel", label: "Interest" },
];

interface CallLogsToolbarProps {
  filters: CallLogsFilters;
  onFiltersChange: (filters: CallLogsFilters) => void;
  botConfigOptions: string[];
  tagOptions: string[];
  onDownload: () => void;
  totalFiltered: number;
  totalAll: number;
  selectedCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
}

export function CallLogsToolbar({
  filters,
  onFiltersChange,
  botConfigOptions,
  tagOptions,
  onDownload,
  totalFiltered,
  totalAll,
  selectedCount,
  onSelectAll,
  onClearSelection,
}: CallLogsToolbarProps) {
  const update = (patch: Partial<CallLogsFilters>) =>
    onFiltersChange({ ...filters, ...patch });

  const toggleTag = (tag: string) => {
    const next = filters.tags.includes(tag)
      ? filters.tags.filter((t) => t !== tag)
      : [...filters.tags, tag];
    update({ tags: next });
  };

  const addCustomFilter = () => {
    update({ customFilters: [...filters.customFilters, { column: "contactName", value: "" }] });
  };

  const updateCustomFilter = (index: number, updates: Partial<CustomFilter>) => {
    const updated = filters.customFilters.map((f, i) => (i === index ? { ...f, ...updates } : f));
    update({ customFilters: updated });
  };

  const removeCustomFilter = (index: number) => {
    update({ customFilters: filters.customFilters.filter((_, i) => i !== index) });
  };

  const hasFilters =
    filters.search ||
    filters.status !== "all" ||
    filters.interestLevel !== "all" ||
    filters.botConfig !== "all" ||
    filters.tags.length > 0 ||
    filters.customFilters.length > 0 ||
    filters.dateFrom ||
    filters.dateTo;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or phone..."
            value={filters.search}
            onChange={(e) => update({ search: e.target.value })}
            className="pl-8 h-9"
          />
        </div>

        {/* Status */}
        <Select
          value={filters.status}
          onValueChange={(v) => update({ status: v as CallStatus | "all" })}
        >
          <SelectTrigger size="sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(CALL_STATUS_CONFIG).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>
                {cfg.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Interest Level */}
        <Select
          value={filters.interestLevel}
          onValueChange={(v) => update({ interestLevel: v })}
        >
          <SelectTrigger size="sm">
            <SelectValue placeholder="Interest" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Interest</SelectItem>
            <SelectItem value="High">High</SelectItem>
            <SelectItem value="Medium">Medium</SelectItem>
            <SelectItem value="Low">Low</SelectItem>
          </SelectContent>
        </Select>

        {/* Bot Config */}
        {botConfigOptions.length > 0 && (
          <Select
            value={filters.botConfig}
            onValueChange={(v) => update({ botConfig: v })}
          >
            <SelectTrigger size="sm">
              <SelectValue placeholder="Bot Config" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Configs</SelectItem>
              {botConfigOptions.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Tags — multi-select popover */}
        {tagOptions.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Tag className="h-3.5 w-3.5" />
                Tags
                {filters.tags.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1 text-[10px]">
                    {filters.tags.length}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[220px] p-2" align="start">
              <div className="space-y-1 max-h-[240px] overflow-y-auto">
                {tagOptions.map((tag) => {
                  const isSelected = filters.tags.includes(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors text-left"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        readOnly
                        className="h-3.5 w-3.5 rounded border-muted-foreground/40 accent-violet-500"
                      />
                      <span className="truncate">{tag}</span>
                    </button>
                  );
                })}
              </div>
              {filters.tags.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => update({ tags: [] })}
                  className="w-full mt-2 text-xs h-7"
                >
                  Clear tags
                </Button>
              )}
            </PopoverContent>
          </Popover>
        )}

        {/* Date From */}
        <div className="relative">
          <Calendar className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => update({ dateFrom: e.target.value })}
            className="pl-8 h-8 w-[150px] text-xs"
            title="From date"
          />
        </div>

        {/* Date To */}
        <div className="relative">
          <Calendar className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            type="date"
            value={filters.dateTo}
            onChange={(e) => update({ dateTo: e.target.value })}
            className="pl-8 h-8 w-[150px] text-xs"
            title="To date"
          />
        </div>

        {/* Add Filter */}
        <Button
          variant="outline"
          size="sm"
          onClick={addCustomFilter}
          className="gap-1"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Filter
        </Button>

        {/* Clear Filters */}
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onFiltersChange(EMPTY_FILTERS)}
            className="text-xs gap-1"
          >
            <X className="h-3 w-3" />
            Clear
          </Button>
        )}

        {/* Download */}
        <Button variant="outline" size="sm" onClick={onDownload} className="gap-1.5 ml-auto">
          <Download className="h-3.5 w-3.5" />
          {selectedCount > 0 ? `Download ${selectedCount} Selected` : "Download CSV"}
        </Button>
      </div>

      {/* Selected tags display */}
      {filters.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Tags:</span>
          {filters.tags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="text-xs gap-1 cursor-pointer hover:bg-destructive/20"
              onClick={() => toggleTag(tag)}
            >
              {tag}
              <X className="h-3 w-3" />
            </Badge>
          ))}
        </div>
      )}

      {/* Custom column filters — same pattern as leads toolbar */}
      {filters.customFilters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {filters.customFilters.map((cf, index) => (
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

      {/* Selection / filter indicator */}
      {(selectedCount > 0 || (hasFilters && totalFiltered !== totalAll)) && (
        <div className="flex items-center gap-3">
          {selectedCount > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-violet-400 font-medium">{selectedCount} selected</span>
              <Button variant="ghost" size="sm" onClick={onSelectAll} className="h-6 text-xs px-2">
                Select all {totalFiltered}
              </Button>
              <Button variant="ghost" size="sm" onClick={onClearSelection} className="h-6 text-xs px-2">
                Clear selection
              </Button>
            </div>
          )}
          {hasFilters && totalFiltered !== totalAll && selectedCount === 0 && (
            <p className="text-xs text-muted-foreground">
              Showing {totalFiltered} of {totalAll} calls
            </p>
          )}
        </div>
      )}
    </div>
  );
}
