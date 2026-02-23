"use client";

import { useState, useCallback, useEffect } from "react";
import { Upload, Plus, RefreshCw, Settings, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const [selectedGhlTag, setSelectedGhlTag] = useState("all");
  const [loadingTags, setLoadingTags] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalSynced, setTotalSynced] = useState(0);
  const [totalInGHL, setTotalInGHL] = useState<number | null>(null);

  const ghlConfigured = !!(settings.ghlApiKey && settings.ghlLocationId);
  const ghlSyncEnabled = settings.ghlSyncEnabled ?? false;

  const handleToggleGhlSync = async (checked: boolean) => {
    await updateSettings({ ghlSyncEnabled: checked });
  };

  // Reset cursor when tag changes
  useEffect(() => {
    setNextCursor(null);
    setTotalSynced(0);
    setTotalInGHL(null);
  }, [selectedGhlTag]);

  // Fetch GHL tags when sync is enabled and configured
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
        console.error("Failed to fetch GHL tags:", err);
      } finally {
        if (!cancelled) setLoadingTags(false);
      }
    };

    fetchTags();
    return () => { cancelled = true; };
  }, [ghlSyncEnabled, ghlConfigured, user]);

  const handleSync = useCallback(async (cursor?: string | null) => {
    if (!user) return;
    setSyncing(true);
    const toastId = toast.loading(cursor ? "Fetching next 100 contacts..." : "Fetching contacts from GoHighLevel...");
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
          ...(selectedGhlTag !== "all" && { tag: selectedGhlTag }),
          ...(cursor && { cursor }),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.message || "Failed to sync GHL contacts", { id: toastId });
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

      if (data.hasMore) {
        toast.success(`Synced ${data.synced} contacts. More available — click "Fetch Next 100" to continue.`, { id: toastId });
      } else {
        toast.success(`Synced ${data.synced} contacts. All done!`, { id: toastId });
      }
    } catch (error) {
      console.error("GHL sync error:", error);
      toast.error("Failed to sync GHL contacts", { id: toastId });
    } finally {
      setSyncing(false);
    }
  }, [user, updateSettings, mergeGhlLeads, selectedGhlTag]);

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

      {/* GHL Sync Section */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="ghl-sync"
              checked={ghlSyncEnabled}
              onCheckedChange={handleToggleGhlSync}
            />
            <Label htmlFor="ghl-sync" className="font-medium">
              Sync from GoHighLevel
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
              <div className="flex items-center gap-3 flex-wrap">
                <Select
                  value={selectedGhlTag}
                  onValueChange={setSelectedGhlTag}
                  disabled={syncing || loadingTags}
                >
                  <SelectTrigger className="w-[180px] h-9">
                    <SelectValue placeholder={loadingTags ? "Loading tags..." : "Select tag"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Contacts</SelectItem>
                    {ghlTags.map((tag) => (
                      <SelectItem key={tag} value={tag}>
                        {tag}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

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

                {totalSynced > 0 && totalInGHL && (
                  <div className="flex-1 min-w-[200px] space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{totalSynced} synced</span>
                      <span>{totalInGHL} total in GHL</span>
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
            ) : (
              <span className="text-sm text-muted-foreground">
                Configure GHL API key in{" "}
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
