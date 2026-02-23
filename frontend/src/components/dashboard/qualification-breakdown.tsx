"use client";

import { motion } from "framer-motion";
import { Target, Flame, Thermometer, Snowflake } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useLeads } from "@/hooks/use-leads";
import { QualificationBadge } from "@/components/shared/qualification-badge";
import type { QualificationLevel } from "@/types/qualification";

export function QualificationBreakdown() {
  const { leads } = useLeads();

  const qualified = leads.filter((l) => l.qualificationLevel);
  const hot = qualified.filter((l) => l.qualificationLevel === "HOT").length;
  const warm = qualified.filter((l) => l.qualificationLevel === "WARM").length;
  const cold = qualified.filter((l) => l.qualificationLevel === "COLD").length;
  const total = qualified.length;

  if (total === 0) return null;

  const bars: {
    level: QualificationLevel;
    count: number;
    color: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { level: "HOT", count: hot, color: "bg-red-500", icon: Flame },
    { level: "WARM", count: warm, color: "bg-amber-500", icon: Thermometer },
    { level: "COLD", count: cold, color: "bg-blue-500", icon: Snowflake },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          Lead Qualification
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {bars.map((bar) => (
            <div key={bar.level} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <bar.icon className="h-4 w-4" />
                  <QualificationBadge level={bar.level} />
                </div>
                <span className="text-muted-foreground">
                  {bar.count} ({total > 0 ? Math.round((bar.count / total) * 100) : 0}%)
                </span>
              </div>
              <motion.div
                className="h-2 rounded-full bg-muted overflow-hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <motion.div
                  className={`h-full rounded-full ${bar.color}`}
                  initial={{ width: 0 }}
                  animate={{
                    width: `${total > 0 ? (bar.count / total) * 100 : 0}%`,
                  }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </motion.div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground text-right">
            {total} qualified out of {leads.length} total leads
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
