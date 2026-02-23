"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Phone, PhoneOff, PhoneMissed } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CallStatusBadge } from "@/components/shared/status-badge";
import { useCalls } from "@/hooks/use-calls";
import { formatPhoneNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { CallStatus } from "@/types/call";

const borderColors: Record<CallStatus, string> = {
  initiating: "border-l-blue-500",
  "in-progress": "border-l-emerald-500",
  completed: "border-l-green-500",
  failed: "border-l-red-500",
  "no-answer": "border-l-amber-500",
};

function PulsingRings() {
  return (
    <div className="relative flex h-12 w-12 items-center justify-center">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute h-full w-full rounded-full border-2 border-blue-400"
          initial={{ scale: 0.5, opacity: 1 }}
          animate={{ scale: 2, opacity: 0 }}
          transition={{
            duration: 2,
            repeat: Infinity,
            delay: i * 0.6,
            ease: "easeOut",
          }}
        />
      ))}
      <div className="h-3 w-3 rounded-full bg-blue-500" />
    </div>
  );
}

function AudioWave() {
  return (
    <div className="flex h-12 items-end justify-center gap-1">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-1.5 rounded-full bg-emerald-500"
          animate={{ height: ["8px", "32px", "8px"] }}
          transition={{
            duration: 0.8 + i * 0.2,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.15,
          }}
        />
      ))}
    </div>
  );
}

export function CallStatusCard() {
  const { activeCall, updateCallStatus } = useCalls();

  return (
    <AnimatePresence mode="wait">
      {activeCall && (
        <motion.div
          key={activeCall.id}
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ duration: 0.3 }}
        >
          <Card
            className={cn(
              "border-l-4 overflow-hidden",
              borderColors[activeCall.status]
            )}
          >
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold">
                    {activeCall.request.contactName}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {formatPhoneNumber(activeCall.request.phoneNumber)}
                  </p>
                  {activeCall.callUuid && (
                    <p className="font-mono text-xs text-muted-foreground">
                      UUID: {activeCall.callUuid.slice(0, 8)}...
                    </p>
                  )}
                  <CallStatusBadge status={activeCall.status} />
                </div>

                <div className="flex-shrink-0">
                  {activeCall.status === "initiating" && <PulsingRings />}
                  {activeCall.status === "in-progress" && <AudioWave />}
                </div>
              </div>

              {(activeCall.status === "initiating" ||
                activeCall.status === "in-progress") && (
                <div className="mt-4 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-green-500/30 text-green-500 hover:bg-green-500/10 hover:text-green-400"
                    onClick={() =>
                      updateCallStatus(activeCall.id, "completed")
                    }
                  >
                    <Phone className="mr-1 h-3.5 w-3.5" />
                    Mark Complete
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-500/30 text-red-500 hover:bg-red-500/10 hover:text-red-400"
                    onClick={() => updateCallStatus(activeCall.id, "failed")}
                  >
                    <PhoneOff className="mr-1 h-3.5 w-3.5" />
                    Mark Failed
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-500/30 text-amber-500 hover:bg-amber-500/10 hover:text-amber-400"
                    onClick={() =>
                      updateCallStatus(activeCall.id, "no-answer")
                    }
                  >
                    <PhoneMissed className="mr-1 h-3.5 w-3.5" />
                    No Answer
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
