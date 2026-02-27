"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BotConfigSelector } from "@/components/calls/bot-config-selector";
import { formatPhoneNumber } from "@/lib/utils";
import { useAuthContext } from "@/context/auth-context";
import { toast } from "sonner";
import type { Lead } from "@/types/lead";

interface CreateCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leads: Lead[];
  onCreated?: () => void;
}

export function CreateCampaignDialog({ open, onOpenChange, leads, onCreated }: CreateCampaignDialogProps) {
  const { user } = useAuthContext();
  const router = useRouter();
  const [name, setName] = useState("");
  const [botConfigId, setBotConfigId] = useState("");
  const [botConfigName, setBotConfigName] = useState("");
  const [concurrencyLimit, setConcurrencyLimit] = useState(100);
  const [creating, setCreating] = useState(false);

  const defaultName = `Campaign — ${new Date().toLocaleDateString()} — ${leads.length} leads`;

  const handleCreate = async () => {
    if (!user) return;
    if (!botConfigId) {
      toast.error("Please select a bot config");
      return;
    }

    setCreating(true);
    const toastId = toast.loading("Creating campaign...");

    try {
      const token = await user.getIdToken();
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

      // Step 1: Create
      const createRes = await fetch("/api/data/campaigns", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "create",
          name: name || defaultName,
          botConfigId,
          botConfigName,
          leadIds: leads.map((l) => l.id),
          concurrencyLimit: Math.max(1, Math.min(500, concurrencyLimit)),
        }),
      });
      const createData = await createRes.json();
      if (!createData.success) throw new Error(createData.message || "Failed to create campaign");

      // Step 2: Start
      const startRes = await fetch("/api/data/campaigns", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "start", campaignId: createData.campaignId }),
      });
      const startData = await startRes.json();
      if (!startData.success) throw new Error(startData.message || "Failed to start campaign");

      toast.success(`Campaign started — ${startData.triggered} calls triggered`, { id: toastId });
      onOpenChange(false);
      onCreated?.();
      router.push("/campaigns");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create campaign", { id: toastId });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5" />
            Start Campaign — {leads.length} Lead{leads.length !== 1 ? "s" : ""}
          </DialogTitle>
          <DialogDescription>
            Leads will be called in a rolling batch. As calls complete, the next lead is automatically dialed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Campaign Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={defaultName}
            />
          </div>

          <div className="space-y-2">
            <Label>Bot Config</Label>
            <BotConfigSelector
              value={botConfigId}
              onChange={(id, config) => {
                setBotConfigId(id);
                if (config?.name) setBotConfigName(config.name);
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Concurrency Limit</Label>
            <Input
              type="number"
              min={1}
              max={500}
              value={concurrencyLimit}
              onChange={(e) => setConcurrencyLimit(parseInt(e.target.value) || 100)}
            />
            <p className="text-xs text-muted-foreground">
              Maximum simultaneous calls. Recommended: 100.
            </p>
          </div>

          <ScrollArea className="max-h-[150px] rounded-md border p-2">
            <div className="space-y-1">
              {leads.map((lead) => (
                <div key={lead.id} className="flex items-center gap-2 text-sm py-0.5">
                  <span className="font-medium">{lead.contactName}</span>
                  <span className="text-muted-foreground">{formatPhoneNumber(lead.phoneNumber)}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating || !botConfigId}>
            {creating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Megaphone className="mr-2 h-4 w-4" />
            )}
            Create & Start
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
