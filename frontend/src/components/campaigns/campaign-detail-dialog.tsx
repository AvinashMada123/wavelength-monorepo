"use client";

import { useState, useEffect, useCallback } from "react";
import { Phone, Clock, CheckCircle, XCircle, PhoneOff, SkipForward, Loader2, Timer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CAMPAIGN_LEAD_STATUS_CONFIG } from "@/lib/constants";
import { formatPhoneNumber } from "@/lib/utils";
import { useAuthContext } from "@/context/auth-context";
import type { Campaign, CampaignLead, CampaignLeadStatus } from "@/types/campaign";

interface CampaignDetailDialogProps {
  campaign: Campaign | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusIcons: Record<CampaignLeadStatus, React.ReactNode> = {
  queued: <Clock className="h-3.5 w-3.5" />,
  calling: <Phone className="h-3.5 w-3.5 animate-pulse" />,
  completed: <CheckCircle className="h-3.5 w-3.5" />,
  failed: <XCircle className="h-3.5 w-3.5" />,
  skipped: <SkipForward className="h-3.5 w-3.5" />,
  no_answer: <PhoneOff className="h-3.5 w-3.5" />,
  retry_pending: <Timer className="h-3.5 w-3.5" />,
};

export function CampaignDetailDialog({ campaign, open, onOpenChange }: CampaignDetailDialogProps) {
  const { user } = useAuthContext();
  const [leads, setLeads] = useState<CampaignLead[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLeads = useCallback(async () => {
    if (!user || !campaign) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/data/campaigns", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get", campaignId: campaign.id }),
      });
      const data = await res.json();
      if (data.leads) setLeads(data.leads);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [user, campaign]);

  useEffect(() => {
    if (open && campaign) {
      fetchLeads();
    }
  }, [open, campaign, fetchLeads]);

  // Auto-refresh leads while campaign is running
  useEffect(() => {
    if (!open || !campaign || campaign.status !== "running") return;
    const interval = setInterval(fetchLeads, 5000);
    return () => clearInterval(interval);
  }, [open, campaign, fetchLeads]);

  if (!campaign) return null;

  const processed = campaign.completedCalls + campaign.failedCalls + campaign.noAnswerCalls;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>{campaign.name}</DialogTitle>
          <DialogDescription>
            {campaign.botConfigName || "Bot Config"} &middot; {campaign.totalLeads} leads &middot; Concurrency: {campaign.concurrencyLimit}
          </DialogDescription>
        </DialogHeader>

        {/* Stats row */}
        <div className="grid grid-cols-5 gap-3 text-center">
          <div className="rounded-lg border p-2">
            <p className="text-lg font-bold text-green-400">{campaign.completedCalls}</p>
            <p className="text-[10px] text-muted-foreground">Completed</p>
          </div>
          <div className="rounded-lg border p-2">
            <p className="text-lg font-bold text-red-400">{campaign.failedCalls}</p>
            <p className="text-[10px] text-muted-foreground">Failed</p>
          </div>
          <div className="rounded-lg border p-2">
            <p className="text-lg font-bold text-amber-400">{campaign.noAnswerCalls}</p>
            <p className="text-[10px] text-muted-foreground">No Answer</p>
          </div>
          <div className="rounded-lg border p-2">
            <p className="text-lg font-bold text-blue-400">{campaign.activeCalls ?? 0}</p>
            <p className="text-[10px] text-muted-foreground">Active</p>
          </div>
          <div className="rounded-lg border p-2">
            <p className="text-lg font-bold text-muted-foreground">{campaign.totalLeads - processed - (campaign.activeCalls ?? 0)}</p>
            <p className="text-[10px] text-muted-foreground">Queued</p>
          </div>
        </div>

        {/* Leads list */}
        {loading && leads.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-1">
              {leads.map((lead) => {
                const cfg = CAMPAIGN_LEAD_STATUS_CONFIG[lead.status] || CAMPAIGN_LEAD_STATUS_CONFIG.queued;
                return (
                  <div
                    key={lead.id}
                    className="flex items-center gap-3 rounded-md px-3 py-2 text-sm border"
                  >
                    <span className="text-muted-foreground text-xs w-6 text-right">{lead.position + 1}</span>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{lead.contactName || "Unknown"}</span>
                      <span className="text-muted-foreground ml-2 text-xs">
                        {formatPhoneNumber(lead.phoneNumber || "")}
                      </span>
                    </div>
                    <Badge variant="outline" className={`text-xs gap-1 ${cfg.color}`}>
                      {statusIcons[lead.status]}
                      {cfg.label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
