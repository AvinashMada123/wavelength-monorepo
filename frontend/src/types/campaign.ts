export type CampaignStatus = "queued" | "running" | "paused" | "completed" | "cancelled";

export type CampaignLeadStatus = "queued" | "calling" | "completed" | "failed" | "skipped" | "no_answer" | "retry_pending";

export interface Campaign {
  id: string;
  orgId: string;
  name: string;
  botConfigId: string;
  botConfigName?: string;
  status: CampaignStatus;
  concurrencyLimit: number;
  totalLeads: number;
  completedCalls: number;
  failedCalls: number;
  noAnswerCalls: number;
  activeCalls?: number;
  webhookBaseUrl: string;
  createdBy?: string;
  createdAt: string;
  startedAt?: string;
  pausedAt?: string;
  completedAt?: string;
}

export interface CampaignLead {
  id: string;
  campaignId: string;
  leadId: string;
  status: CampaignLeadStatus;
  callUuid?: string;
  position: number;
  queuedAt: string;
  calledAt?: string;
  completedAt?: string;
  errorMessage?: string;
  retryCount?: number;
  nextRetryAt?: string;
  // Joined from leads table
  contactName?: string;
  phoneNumber?: string;
  company?: string;
  email?: string;
}
