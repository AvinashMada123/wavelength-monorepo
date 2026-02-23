"use client";

import { StatsGrid } from "@/components/dashboard/stats-grid";
import { RecentCallsList } from "@/components/dashboard/recent-calls-list";
import { CallActivityChart } from "@/components/dashboard/call-activity-chart";
import { QualificationBreakdown } from "@/components/dashboard/qualification-breakdown";
import { QuickActions } from "@/components/dashboard/quick-actions";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of your AI calling operations
          </p>
        </div>
        <QuickActions />
      </div>
      <StatsGrid />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecentCallsList />
        <CallActivityChart />
      </div>
      <QualificationBreakdown />
    </div>
  );
}
