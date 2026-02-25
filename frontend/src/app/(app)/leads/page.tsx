"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { Upload, Plus, RefreshCw, Settings, ChevronRight, ChevronsUpDown, Check, X, Tag, Download, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { LeadsToolbar } from "@/components/leads/leads-toolbar";
import { LeadsTable } from "@/components/leads/leads-table";
import { LeadsPagination } from "@/components/leads/leads-pagination";
import { LeadUploadModal } from "@/components/leads/lead-upload-modal";
import { AddLeadDialog } from "@/components/leads/add-lead-dialog";
import { useLeads } from "@/hooks/use-leads";
import { useSettings } from "@/hooks/use-settings";
import { useAuthContext } from "@/context/auth-context";
import { toast } from "sonner";

export default function LeadsPage() {
  const { totalLeads, mergeGhlLeads } = useLeads();
  const { settings, updateSettings } = useSettings();
  const { user } = useAuthContext();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [ghlTags, setGhlTags] = useState<string[]>([]);
  const [selectedGhlTags, setSelectedGhlTags] = useState<string[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalSynced, setTotalSynced] = useState(0);
  const [totalInGHL, setTotalInGHL] = useState<number | null>(null);
  const [tagCount, setTagCount] = useState<number | null>(null);
  const [countingTags, setCountingTags] = useState(false);

  const ghlConfigured = !!(settings.ghlApiKey && settings.ghlLocationId);
  const ghlSyncEnabled = settings.ghlSyncEnabled ?? false;

  const handleToggleGhlSync = async (checked: boolean) => {
    await updateSettings({ ghlSyncEnabled: checked });
  };

  // Reset state and count contacts when tags change
  useEffect(() => {
    setNextCursor(null);
    setTotalSynced(0);
    setTotalInGHL(null);
    setTagCount(null);

    if (selectedGhlTags.length === 0 || !user || !ghlConfigured) return;

    let cancelled = false;
    const countContacts = async () => {
      setCountingTags(true);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/data/ghl-contacts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action: "countByTags", tags: selectedGhlTags }),
        });
        const data = await res.json();
        if (!cancelled && data.success) {
          setTagCount(data.total);
        }
      } catch (err) {
        console.error("Failed to count contacts by tag:", err);
      } finally {
        if (!cancelled) setCountingTags(false);
      }
    };

    countContacts();
    return () => { cancelled = true; };
  }, [selectedGhlTags, user, ghlConfigured]);

  // Fetch CRM tags when sync is enabled and configured
  useEffect(() => {
    if (!ghlSyncEnabled || !ghlConfigured || !user) return;

    let cancelled = false;
    const fetchTags = async () => {
      setLoadingTags(true);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/data/ghl-contacts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action: "fetchTags" }),
        });
        const data = await res.json();
        if (!cancelled && data.tags) {
          setGhlTags(data.tags);
        }
      } catch (err) {
        console.error("Failed to fetch CRM tags:", err);
      } finally {
        if (!cancelled) setLoadingTags(false);
      }
    };

    fetchTags();
    return () => { cancelled = true; };
  }, [ghlSyncEnabled, ghlConfigured, user]);

  const filteredTags = useMemo(() => {
    if (!tagSearch.trim()) return ghlTags;
    const q = tagSearch.toLowerCase();
    return ghlTags.filter((t) => t.toLowerCase().includes(q));
  }, [ghlTags, tagSearch]);

  // Check if the typed value is a new tag (not in the fetched list)
  const canAddCustomTag = tagSearch.trim() !== "" && !ghlTags.some((t) => t.toLowerCase() === tagSearch.trim().toLowerCase());

  function toggleTag(tag: string) {
    setSelectedGhlTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function addCustomTag() {
    const trimmed = tagSearch.trim();
    if (!trimmed) return;
    if (!selectedGhlTags.includes(trimmed)) {
      setSelectedGhlTags((prev) => [...prev, trimmed]);
    }
    // Also add to the local tag list so it appears in the selector
    if (!ghlTags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      setGhlTags((prev) => [...prev, trimmed].sort());
    }
    setTagSearch("");
  }

  function removeTag(tag: string) {
    setSelectedGhlTags((prev) => prev.filter((t) => t !== tag));
  }

  function clearTags() {
    setSelectedGhlTags([]);
  }

  const handleSync = useCallback(async (cursor?: string | null) => {
    if (!user) return;
    setSyncing(true);
    const isTagImport = selectedGhlTags.length > 0 && !cursor;
    const toastId = toast.loading(
      isTagImport
        ? `Importing ${tagCount ?? ""} contacts...`
        : cursor
          ? "Fetching next 100 contacts..."
          : "Fetching contacts from CRM..."
    );
    try {
      const token = await user.getIdToken();

      const res = await fetch("/api/data/ghl-contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "sync",
          ...(selectedGhlTags.length > 0 && { tags: selectedGhlTags }),
          ...(cursor && { cursor }),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.message || "Failed to sync CRM contacts", { id: toastId });
        return;
      }

      // Update state
      updateSettings({ ghlLastSyncAt: data.ghlLastSyncAt });
      setNextCursor(data.nextCursor || null);
      setTotalSynced((prev) => prev + data.synced);
      if (data.totalInGHL) setTotalInGHL(data.totalInGHL);

      // Reload leads from server
      const leadsRes = await fetch("/api/data/leads", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const leadsData = await leadsRes.json();
      if (leadsData.leads) {
        mergeGhlLeads(
          leadsData.leads.filter(
            (l: { source: string }) => l.source === "ghl"
          )
        );
      }

      if (data.searchMode) {
        // Tag-filtered sync imported all pages at once
        toast.success(`Imported ${data.synced} contacts. All done!`, { id: toastId });
      } else if (data.hasMore) {
        toast.success(`Synced ${data.synced} contacts. More available — click "Fetch Next 100" to continue.`, { id: toastId });
      } else {
        toast.success(`Synced ${data.synced} contacts. All done!`, { id: toastId });
      }
    } catch (error) {
      console.error("CRM sync error:", error);
      toast.error("Failed to sync CRM contacts", { id: toastId });
    } finally {
      setSyncing(false);
    }
  }, [user, updateSettings, mergeGhlLeads, selectedGhlTags, tagCount]);

  const formatLastSync = (dateStr?: string) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Lead Management
          </h1>
          <p className="text-muted-foreground">{totalLeads} total leads</p>
        </div>
        <div className="flex gap-3">
          <Button
            onClick={() => setUploadOpen(true)}
            variant="outline"
          >
            <Upload className="mr-2 h-4 w-4" /> Import Leads
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add Lead
          </Button>
        </div>
      </div>

      {/* CRM Sync Section */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="ghl-sync"
              checked={ghlSyncEnabled}
              onCheckedChange={handleToggleGhlSync}
            />
            <Label htmlFor="ghl-sync" className="font-medium">
              Sync from CRM
            </Label>
          </div>

          {ghlSyncEnabled && ghlConfigured && settings.ghlLastSyncAt && (
            <span className="text-sm text-muted-foreground">
              Last synced: {formatLastSync(settings.ghlLastSyncAt)}
            </span>
          )}
        </div>

        {ghlSyncEnabled && (
          <>
            {ghlConfigured ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Tag selector with custom tag support */}
                  <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 min-w-[180px] justify-between"
                        disabled={syncing || loadingTags}
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <Tag className="size-3.5 shrink-0" />
                          {loadingTags
                            ? "Loading tags..."
                            : selectedGhlTags.length === 0
                              ? "All Contacts"
                              : selectedGhlTags.length === 1
                                ? selectedGhlTags[0]
                                : `${selectedGhlTags.length} tags selected`}
                        </span>
                        <ChevronsUpDown className="ml-2 size-3.5 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-0" align="start">
                      <div className="p-2 border-b">
                        <Input
                          placeholder="Search or type a new tag..."
                          value={tagSearch}
                          onChange={(e) => setTagSearch(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              if (canAddCustomTag) {
                                addCustomTag();
                              } else if (filteredTags.length === 1) {
                                toggleTag(filteredTags[0]);
                              }
                            }
                          }}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="max-h-[240px] overflow-y-auto p-1">
                        {/* All Contacts option */}
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent cursor-pointer"
                          onClick={() => { clearTags(); setTagPopoverOpen(false); }}
                        >
                          <div className="flex size-4 items-center justify-center rounded border border-primary">
                            {selectedGhlTags.length === 0 && <Check className="size-3" />}
                          </div>
                          All Contacts
                        </button>

                        {/* Add custom tag option */}
                        {canAddCustomTag && (
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent cursor-pointer text-primary"
                            onClick={addCustomTag}
                          >
                            <Plus className="size-4 shrink-0" />
                            <span className="truncate">Add &quot;{tagSearch.trim()}&quot;</span>
                          </button>
                        )}

                        {filteredTags.length === 0 && !loadingTags && !canAddCustomTag && (
                          <p className="text-xs text-muted-foreground text-center py-3">
                            No tags found
                          </p>
                        )}

                        {filteredTags.map((tag) => {
                          const isSelected = selectedGhlTags.includes(tag);
                          return (
                            <button
                              key={tag}
                              type="button"
                              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent cursor-pointer"
                              onClick={() => toggleTag(tag)}
                            >
                              <div className={`flex size-4 items-center justify-center rounded border ${isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"}`}>
                                {isSelected && <Check className="size-3" />}
                              </div>
                              <span className="truncate">{tag}</span>
                            </button>
                          );
                        })}
                      </div>
                      {selectedGhlTags.length > 0 && (
                        <div className="border-t p-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full h-7 text-xs"
                            onClick={clearTags}
                          >
                            <X className="size-3 mr-1" /> Clear selection
                          </Button>
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>

                  {/* Sync buttons: different UX for tag mode vs unfiltered */}
                  {selectedGhlTags.length > 0 ? (
                    <>
                      {/* Tag mode: show count + "Import N Contacts" */}
                      {countingTags ? (
                        <Button size="sm" variant="outline" disabled>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Counting...
                        </Button>
                      ) : tagCount !== null && tagCount > 0 ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSync(null)}
                          disabled={syncing}
                        >
                          {syncing ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="mr-2 h-4 w-4" />
                          )}
                          {syncing ? "Importing..." : `Import ${tagCount} Contacts`}
                        </Button>
                      ) : tagCount === 0 ? (
                        <span className="text-sm text-muted-foreground">
                          No contacts found with selected tags
                        </span>
                      ) : (
                        /* tagCount is null — search endpoint unavailable, fallback to old behavior */
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSync(null)}
                          disabled={syncing}
                        >
                          <RefreshCw
                            className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`}
                          />
                          {syncing ? "Syncing..." : "Fetch 100 Contacts"}
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      {/* No tags: existing cursor-based pagination */}
                      {!nextCursor ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSync(null)}
                          disabled={syncing}
                        >
                          <RefreshCw
                            className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`}
                          />
                          {syncing ? "Syncing..." : "Fetch 100 Contacts"}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSync(nextCursor)}
                          disabled={syncing}
                        >
                          <ChevronRight
                            className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`}
                          />
                          {syncing ? "Syncing..." : "Fetch Next 100"}
                        </Button>
                      )}
                    </>
                  )}

                  {/* Progress indicator */}
                  {totalSynced > 0 && totalInGHL && (
                    <div className="flex-1 min-w-[200px] space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{totalSynced} synced</span>
                        <span>{totalInGHL} total in CRM</span>
                      </div>
                      <Progress
                        value={Math.min(100, Math.round((totalSynced / totalInGHL) * 100))}
                      />
                      <p className="text-xs text-muted-foreground">
                        {Math.min(100, Math.round((totalSynced / totalInGHL) * 100))}%
                        {nextCursor ? " — more available" : " — all fetched"}
                      </p>
                    </div>
                  )}
                  {totalSynced > 0 && !totalInGHL && (
                    <span className="text-sm text-muted-foreground">
                      {totalSynced} synced
                      {nextCursor ? " — more available" : " — all fetched"}
                    </span>
                  )}
                </div>

                {/* Selected tags display */}
                {selectedGhlTags.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs text-muted-foreground">Filtering by:</span>
                    {selectedGhlTags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs gap-1 pr-1">
                        {tag}
                        <button
                          type="button"
                          onClick={() => removeTag(tag)}
                          className="ml-0.5 hover:text-destructive"
                        >
                          <X className="size-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">
                Configure CRM integration token in{" "}
                <Link
                  href="/settings"
                  className="text-primary underline underline-offset-4"
                >
                  <Settings className="mr-1 inline h-3 w-3" />
                  Settings
                </Link>
              </span>
            )}
          </>
        )}
      </div>

      <LeadsToolbar />
      <LeadsTable />
      <LeadsPagination />

      <LeadUploadModal open={uploadOpen} onOpenChange={setUploadOpen} />
      <AddLeadDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
