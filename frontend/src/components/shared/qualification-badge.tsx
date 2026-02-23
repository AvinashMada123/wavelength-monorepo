"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { QUALIFICATION_LEVEL_CONFIG } from "@/lib/constants";
import type { QualificationLevel } from "@/types/qualification";

export function QualificationBadge({
  level,
  confidence,
  size = "default",
}: {
  level: QualificationLevel;
  confidence?: number;
  size?: "default" | "sm";
}) {
  const config = QUALIFICATION_LEVEL_CONFIG[level];
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium",
        size === "sm" ? "text-[10px] px-1.5 py-0" : "text-xs",
        config.color
      )}
    >
      {config.label}
      {confidence !== undefined && (
        <span className="ml-1 opacity-70">{confidence}%</span>
      )}
    </Badge>
  );
}
