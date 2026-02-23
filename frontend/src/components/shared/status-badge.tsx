"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { LEAD_STATUS_CONFIG, CALL_STATUS_CONFIG } from "@/lib/constants";
import type { LeadStatus } from "@/types/lead";
import type { CallStatus } from "@/types/call";

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const config = LEAD_STATUS_CONFIG[status];
  return (
    <Badge variant="outline" className={cn("text-xs font-medium", config.color)}>
      {config.label}
    </Badge>
  );
}

export function CallStatusBadge({ status }: { status: CallStatus }) {
  const config = CALL_STATUS_CONFIG[status];
  return (
    <Badge variant="outline" className={cn("text-xs font-medium gap-1.5", config.color)}>
      {status === "initiating" && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
        </span>
      )}
      {status === "in-progress" && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
      )}
      {config.label}
    </Badge>
  );
}
