"use client";

import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { AnimatedCounter } from "@/components/shared/animated-counter";

interface StatCardProps {
  title: string;
  value: number;
  suffix?: string;
  icon: React.ReactNode;
  index: number;
  gradient: string;
}

export function StatCard({
  title,
  value,
  suffix,
  icon,
  index,
  gradient,
}: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        delay: index * 0.1,
        duration: 0.5,
        ease: [0.21, 0.47, 0.32, 0.98],
      }}
    >
      <Card className="group hover:border-border hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 p-6">
        <div className="flex items-center gap-4">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white ${gradient}`}
          >
            {icon}
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{title}</p>
            <AnimatedCounter
              value={value}
              suffix={suffix}
              className="text-2xl font-bold tracking-tight"
            />
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
