"use client";

import { useEffect, useRef } from "react";
import { useCalls } from "./use-calls";
import { useLeads } from "./use-leads";
import { useSettings } from "./use-settings";

export function useCallQualificationSync() {
  const { calls } = useCalls();
  const { updateLead } = useLeads();
  const { settings } = useSettings();
  const processedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!settings.ai?.autoQualify) return;

    for (const call of calls) {
      if (
        call.status === "completed" &&
        call.endedData?.qualification &&
        call.leadId &&
        !processedRef.current.has(call.id)
      ) {
        processedRef.current.add(call.id);
        const q = call.endedData.qualification;
        updateLead(call.leadId, {
          status: "qualified",
          qualificationLevel: q.level,
          qualificationConfidence: q.confidence,
          lastQualifiedAt: q.qualifiedAt,
        });
      }
    }
  }, [calls, updateLead, settings.ai?.autoQualify]);
}
