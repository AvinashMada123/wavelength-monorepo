"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Megaphone,
  RefreshCw,
  Pause,
  Play,
  XCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { CampaignDetailDialog } from "@/components/campaigns/campaign-detail-dialog";
import { CAMPAIGN_STATUS_CONFIG } from "@/lib/constants";
import { useAuthContext } from "@/context/auth-context";
import { toast } from "sonner";
import type { Campaign, CampaignStatus } from "@/types/campaign";

export default function CampaignsPage() {
  const { user } = useAuthContext();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/data/campaigns", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.campaigns) setCampaigns(data.campaigns);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  // Auto-refresh every 5s if any campaign is running
  useEffect(() => {
    if (!campaigns.some((c) => c.status === "running")) return;
    const interval = setInterval(fetchCampaigns, 5000);
    return () => clearInterval(interval);
  }, [campaigns, fetchCampaigns]);

  const handleAction = async (campaignId: string, action: "pause" | "resume" | "cancel") => {
    if (!user) return;
    setActionLoading(campaignId);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/data/campaigns", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, campaignId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Campaign ${action === "pause" ? "paused" : action === "resume" ? "resumed" : "cancelled"}`);
        fetchCampaigns();
      } else {
        toast.error(data.message || `Failed to ${action} campaign`);
      }
    } catch {
      toast.error(`Failed to ${action} campaign`);
    } finally {
      setActionLoading(null);
    }
  };

  const openDetail = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setDetailOpen(true);
  };

  const formatDate = (date?: string) => {
    if (!date) return "-";
    return new Date(date).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
          <p className="text-sm text-muted-foreground">
            Manage batch calling campaigns with rolling concurrency
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchCampaigns}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="h-12 w-12" />}
          title="No campaigns yet"
          description="Select leads and click 'Start Campaign' to create your first batch calling campaign"
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Bot Config</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead className="text-center">Active</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="w-[140px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((campaign, index) => {
                const processed = campaign.completedCalls + campaign.failedCalls + campaign.noAnswerCalls;
                const progressPct = campaign.totalLeads > 0
                  ? Math.round((processed / campaign.totalLeads) * 100)
                  : 0;
                const statusCfg = CAMPAIGN_STATUS_CONFIG[campaign.status] || CAMPAIGN_STATUS_CONFIG.queued;
                const isActionLoading = actionLoading === campaign.id;

                return (
                  <motion.tr
                    key={campaign.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.03 }}
                    className="hover:bg-muted/50 border-b transition-colors cursor-pointer"
                    onClick={() => openDetail(campaign)}
                  >
                    <TableCell className="font-medium">{campaign.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {campaign.botConfigName || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${statusCfg.color}`}>
                        {statusCfg.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <Progress value={progressPct} className="h-2 flex-1" />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {processed}/{campaign.totalLeads}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {campaign.status === "running" ? (
                        <Badge variant="secondary" className="text-xs">
                          {campaign.activeCalls ?? 0}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(campaign.startedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {campaign.status === "running" && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleAction(campaign.id, "pause")}
                            disabled={isActionLoading}
                          >
                            {isActionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
                          </Button>
                        )}
                        {campaign.status === "paused" && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleAction(campaign.id, "resume")}
                            disabled={isActionLoading}
                          >
                            {isActionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                          </Button>
                        )}
                        {(campaign.status === "running" || campaign.status === "paused" || campaign.status === "queued") && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleAction(campaign.id, "cancel")}
                            disabled={isActionLoading}
                          >
                            <XCircle className="h-4 w-4 text-red-400" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </motion.tr>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <CampaignDetailDialog
        campaign={selectedCampaign}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}
