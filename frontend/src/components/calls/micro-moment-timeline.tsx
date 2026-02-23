"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CallEndedData } from "@/types/call";

const momentColors: Record<string, string> = {
  buying_signal: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  resistance: "bg-red-500/10 text-red-400 border-red-500/20",
  price_shock: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  interest_spike: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  last_chance: "bg-purple-500/10 text-purple-400 border-purple-500/20",
};

const momentDotColors: Record<string, string> = {
  buying_signal: "bg-emerald-400",
  resistance: "bg-red-400",
  price_shock: "bg-amber-400",
  interest_spike: "bg-blue-400",
  last_chance: "bg-purple-400",
};

const strategyLabels: Record<string, string> = {
  discovery: "Discovery",
  closing: "Closing",
  rapport: "Rapport Building",
  value_reframe: "Value Reframe",
  momentum: "Momentum",
  last_chance: "Last Chance",
};

interface MicroMomentTimelineProps {
  microMoments: CallEndedData["micro_moments"];
}

export function MicroMomentTimeline({ microMoments }: MicroMomentTimelineProps) {
  if (!microMoments || !microMoments.moments_detected?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <p className="text-sm">No micro-moments detected during this call.</p>
        <p className="text-xs mt-1">
          Moments are detected when the AI identifies buying signals, resistance, or other behavioral patterns.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg border bg-muted/30 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Final Strategy</p>
          <Badge variant="outline" className="mt-1">
            {strategyLabels[microMoments.final_strategy] || microMoments.final_strategy}
          </Badge>
        </div>
        <div className="rounded-lg border bg-muted/30 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Moments Detected</p>
          <p className="text-sm font-semibold mt-1">{microMoments.moments_detected.length}</p>
        </div>
        <div className="rounded-lg border bg-muted/30 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Strategy Switches</p>
          <p className="text-sm font-semibold mt-1">
            {new Set(microMoments.moments_detected.map((m) => m.strategy)).size}
          </p>
        </div>
      </div>

      {/* Timeline */}
      <div className="relative border-l-2 border-border pl-6 space-y-4 ml-2">
        {microMoments.moments_detected.map((moment, i) => (
          <div key={i} className="relative">
            {/* Dot */}
            <div
              className={cn(
                "absolute -left-[29px] top-2 h-3 w-3 rounded-full border-2 border-background",
                momentDotColors[moment.moment] || "bg-primary"
              )}
            />

            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Badge
                  variant="outline"
                  className={cn("text-xs", momentColors[moment.moment])}
                >
                  {moment.moment.replace(/_/g, " ")}
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">
                  Turn #{moment.turn}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  Strategy:{" "}
                  <span className="text-foreground font-medium">
                    {strategyLabels[moment.strategy] || moment.strategy}
                  </span>
                </span>
                <span>Words: {moment.user_word_count}</span>
                <span>Response: {moment.response_time_ms}ms</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
