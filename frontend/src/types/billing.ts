export interface UsageRecord {
  orgId: string;
  period: string;
  totalCalls: number;
  completedCalls: number;
  failedCalls: number;
  totalSeconds: number;
  totalMinutes: number;
  hotLeads: number;
  warmLeads: number;
  coldLeads: number;
  dailyBreakdown: Record<
    string,
    { calls: number; minutes: number; completed: number }
  >;
  updatedAt: string;
}

export interface BillingConfig {
  costPerMinute: number;
  currency: string;
  freeMinutesPerMonth: number;
}
