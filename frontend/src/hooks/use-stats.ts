"use client";

import { useMemo } from "react";
import { useLeads } from "./use-leads";
import { useCalls } from "./use-calls";

export function useStats() {
  const { leads, totalLeads, newLeads } = useLeads();
  const { calls, totalCalls, todayCalls, successRate } = useCalls();

  const callsByDay = useMemo(() => {
    const days: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toDateString();
      const label = d.toLocaleDateString("en-US", { weekday: "short" });
      const count = calls.filter(
        (c) => new Date(c.initiatedAt).toDateString() === dateStr
      ).length;
      days.push({ date: label, count });
    }
    return days;
  }, [calls]);

  const maxCallsInDay = useMemo(
    () => Math.max(1, ...callsByDay.map((d) => d.count)),
    [callsByDay]
  );

  const qualificationBreakdown = useMemo(() => {
    const qualified = leads.filter((l) => l.qualificationLevel);
    return {
      total: qualified.length,
      hot: qualified.filter((l) => l.qualificationLevel === "HOT").length,
      warm: qualified.filter((l) => l.qualificationLevel === "WARM").length,
      cold: qualified.filter((l) => l.qualificationLevel === "COLD").length,
    };
  }, [leads]);

  return {
    totalLeads,
    newLeads,
    totalCalls,
    todayCalls,
    successRate,
    callsByDay,
    maxCallsInDay,
    qualificationBreakdown,
  };
}
