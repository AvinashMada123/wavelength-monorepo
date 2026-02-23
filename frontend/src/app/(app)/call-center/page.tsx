"use client";

import { Suspense } from "react";
import { CallForm } from "@/components/calls/call-form";
import { CallStatusCard } from "@/components/calls/call-status-card";
import { CallHistoryTable } from "@/components/calls/call-history-table";

export default function CallCenterPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Call Center</h1>
        <p className="text-muted-foreground">
          Initiate and monitor AI calls
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2">
          <Suspense>
            <CallForm />
          </Suspense>
        </div>
        <div className="lg:col-span-3 space-y-6">
          <CallStatusCard />
          <CallHistoryTable />
        </div>
      </div>
    </div>
  );
}
