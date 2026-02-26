"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Headphones, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { CallStatusBadge } from "@/components/shared/status-badge";
import { CallDetailModal } from "@/components/calls/call-detail-modal";
import { timeAgo, formatPhoneNumber, formatDuration, cn } from "@/lib/utils";
import type { CallRecord } from "@/types/call";

const interestColors: Record<string, string> = {
  High: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Low: "bg-red-500/10 text-red-400 border-red-500/20",
};

interface CallLogsTableProps {
  calls: CallRecord[];
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
}

export function CallLogsTable({ calls, selectedIds, onSelectionChange }: CallLogsTableProps) {
  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null);

  const allSelected = calls.length > 0 && calls.every((c) => selectedIds.has(c.id));
  const someSelected = calls.some((c) => selectedIds.has(c.id)) && !allSelected;

  const toggleAll = () => {
    if (allSelected) {
      // Deselect all on current page
      const next = new Set(selectedIds);
      for (const c of calls) next.delete(c.id);
      onSelectionChange(next);
    } else {
      // Select all on current page
      const next = new Set(selectedIds);
      for (const c of calls) next.add(c.id);
      onSelectionChange(next);
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected; }}
                onChange={toggleAll}
                className="h-4 w-4 rounded border-muted-foreground/40 accent-violet-500 cursor-pointer"
              />
            </TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Config</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Interest</TableHead>
            <TableHead>Summary</TableHead>
            <TableHead>Time</TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {calls.map((call, index) => (
            <motion.tr
              key={call.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: index * 0.02 }}
              className={cn(
                "hover:bg-muted/50 border-b transition-colors cursor-pointer",
                selectedIds.has(call.id) && "bg-violet-500/5"
              )}
              onClick={() => setSelectedCall(call)}
            >
              <TableCell onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(call.id)}
                  onChange={() => toggleOne(call.id)}
                  className="h-4 w-4 rounded border-muted-foreground/40 accent-violet-500 cursor-pointer"
                />
              </TableCell>
              <TableCell className="font-medium">
                {call.request.contactName}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatPhoneNumber(call.request.phoneNumber)}
              </TableCell>
              <TableCell>
                {(call.botConfigName || call.request.botConfigName) ? (
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {call.botConfigName || call.request.botConfigName}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <CallStatusBadge status={call.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {call.durationSeconds ? formatDuration(call.durationSeconds) : "—"}
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
              <TableCell className="text-muted-foreground max-w-[200px] truncate">
                {call.callSummary || "—"}
              </TableCell>
              <TableCell className="text-muted-foreground whitespace-nowrap">
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

      <CallDetailModal
        call={selectedCall}
        open={!!selectedCall}
        onOpenChange={(open) => !open && setSelectedCall(null)}
      />
    </>
  );
}
