"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { PhoneOff, ExternalLink, Headphones, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { CallStatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { CallDetailModal } from "@/components/calls/call-detail-modal";
import { useCalls } from "@/hooks/use-calls";
import { useCallsContext } from "@/context/calls-context";
import { useAuthContext } from "@/context/auth-context";
import { timeAgo, formatPhoneNumber, cn } from "@/lib/utils";
import type { CallRecord } from "@/types/call";

const interestColors: Record<string, string> = {
  High: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Low: "bg-red-500/10 text-red-400 border-red-500/20",
};

export function CallHistoryTable() {
  const { calls } = useCalls();
  const { dispatch } = useCallsContext();
  const { user } = useAuthContext();
  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!user) return;
    setRefreshing(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/data/calls", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        dispatch({ type: "SET_CALLS", payload: data.calls });
      }
    } catch {
      // silently ignore
    } finally {
      setRefreshing(false);
    }
  };

  const recentCalls = calls
    .slice()
    .sort((a, b) => new Date(b.initiatedAt).getTime() - new Date(a.initiatedAt).getTime())
    .slice(0, 50);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <CardTitle>Call History</CardTitle>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", refreshing && "animate-spin")} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </CardHeader>
        <CardContent>
          {recentCalls.length === 0 ? (
            <EmptyState
              icon={<PhoneOff className="h-12 w-12" />}
              title="No calls yet"
              description="Initiate your first call to see the history here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Interest</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentCalls.map((call, index) => (
                  <motion.tr
                    key={call.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: index * 0.03 }}
                    className="hover:bg-muted/50 border-b transition-colors cursor-pointer"
                    onClick={() => setSelectedCall(call)}
                  >
                    <TableCell className="font-medium">
                      {call.request.contactName}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatPhoneNumber(call.request.phoneNumber)}
                    </TableCell>
                    <TableCell>
                      <CallStatusBadge status={call.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {call.durationSeconds ? `${call.durationSeconds}s` : "—"}
                    </TableCell>
                    <TableCell>
                      {call.interestLevel ? (
                        <Badge
                          variant="outline"
                          className={cn("text-xs", interestColors[call.interestLevel] || interestColors.Medium)}
                        >
                          {call.interestLevel}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {timeAgo(call.initiatedAt)}
                    </TableCell>
                    <TableCell>
                      {call.status === "completed" && call.callUuid ? (
                        <Headphones className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : call.endedData ? (
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : null}
                    </TableCell>
                  </motion.tr>
                ))}
              </TableBody>
            </Table>
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
