"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LinguisticStyle } from "@/types/memory";

const styleColors: Record<string, string> = {
  formality: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  language: "bg-green-500/10 text-green-400 border-green-500/20",
  vocabulary: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  verbosity: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  engagement: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

export function LinguisticStyleTags({ style }: { style?: LinguisticStyle }) {
  if (!style) return <span className="text-muted-foreground text-xs">--</span>;

  const entries = Object.entries(style).filter(([, v]) => typeof v === "string" && v.trim());
  if (entries.length === 0) return <span className="text-muted-foreground text-xs">--</span>;

  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([key, value]) => (
        <Badge
          key={key}
          variant="outline"
          className={cn("text-[10px]", styleColors[key])}
        >
          {value}
        </Badge>
      ))}
    </div>
  );
}
