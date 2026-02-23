"use client";

import { Users, Phone, TrendingUp, Activity } from "lucide-react";
import { useStats } from "@/hooks/use-stats";
import { StatCard } from "./stat-card";

export function StatsGrid() {
  const { totalLeads, totalCalls, successRate, todayCalls } = useStats();

  const stats = [
    {
      title: "Total Leads",
      value: totalLeads,
      icon: <Users className="size-5" />,
      gradient: "bg-gradient-to-br from-blue-500 to-cyan-500",
    },
    {
      title: "Calls Made",
      value: totalCalls,
      icon: <Phone className="size-5" />,
      gradient: "bg-gradient-to-br from-emerald-500 to-green-500",
    },
    {
      title: "Success Rate",
      value: successRate,
      suffix: "%",
      icon: <TrendingUp className="size-5" />,
      gradient: "bg-gradient-to-br from-violet-500 to-purple-500",
    },
    {
      title: "Calls Today",
      value: todayCalls,
      icon: <Activity className="size-5" />,
      gradient: "bg-gradient-to-br from-amber-500 to-orange-500",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat, index) => (
        <StatCard key={stat.title} index={index} {...stat} />
      ))}
    </div>
  );
}
