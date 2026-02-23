"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Phone, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { CallStatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { CallDetailModal } from "@/components/calls/call-detail-modal";
import { useCalls } from "@/hooks/use-calls";
import { formatPhoneNumber, timeAgo, cn } from "@/lib/utils";
import type { CallRecord } from "@/types/call";

const interestColors: Record<string, string> = {
  High: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Low: "bg-red-500/10 text-red-400 border-red-500/20",
};

export function RecentCallsList() {
  const { calls } = useCalls();
  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null);

  const recentCalls = calls
    .slice()
    .sort(
      (a, b) =>
        new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime()
    )
    .slice(0, 8);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Recent Calls</CardTitle>
        </CardHeader>
        <CardContent>
          {recentCalls.length === 0 ? (
            <EmptyState
              icon={<Phone className="size-10" />}
              title="No calls yet"
              description="Start making calls from the Call Center"
            />
          ) : (
            <div className="space-y-3">
              {recentCalls.map((call, i) => (
                <motion.div
                  key={call.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  whileHover={{ scale: 1.01 }}
                  className="flex items-center justify-between rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setSelectedCall(call)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {call.request.contactName}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-muted-foreground">
                        {formatPhoneNumber(call.request.phoneNumber)}
                      </p>
                      {call.durationSeconds && (
                        <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {call.durationSeconds}s
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {call.interestLevel && (
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] px-1.5 py-0", interestColors[call.interestLevel] || interestColors.Medium)}
                      >
                        {call.interestLevel}
                      </Badge>
                    )}
                    <CallStatusBadge status={call.status} />
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {timeAgo(call.initiatedAt)}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CallDetailModal
        call={selectedCall}
        open={!!selectedCall}
        onOpenChange={(open) => !open && setSelectedCall(null)}
      />
    </>
  );
}
