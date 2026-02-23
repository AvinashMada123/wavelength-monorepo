"use client";

import { motion } from "framer-motion";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { useStats } from "@/hooks/use-stats";

export function CallActivityChart() {
  const { callsByDay, maxCallsInDay } = useStats();

  const MAX_BAR_PX = 148; // px — leaves room for label + count chip

  return (
    <Card>
      <CardHeader>
        <CardTitle>Call Activity</CardTitle>
        <CardDescription>Last 7 days</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex h-48 items-end justify-between gap-2">
          {callsByDay.map((day, i) => {
            const barHeight =
              maxCallsInDay > 0
                ? Math.max((day.count / maxCallsInDay) * MAX_BAR_PX, day.count > 0 ? 6 : 4)
                : 4;

            return (
              <div
                key={day.date}
                className="group flex flex-1 flex-col items-center gap-1"
              >
                <span className="text-xs font-medium text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                  {day.count > 0 ? day.count : ""}
                </span>
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: barHeight }}
                  transition={{
                    delay: i * 0.08,
                    duration: 0.6,
                    ease: [0.21, 0.47, 0.32, 0.98],
                  }}
                  className={`w-full max-w-[40px] rounded-t-sm ${
                    day.count > 0
                      ? "bg-gradient-to-t from-violet-500 to-indigo-400"
                      : "bg-muted/40"
                  }`}
                />
                <span className="text-xs text-muted-foreground">
                  {day.date}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
