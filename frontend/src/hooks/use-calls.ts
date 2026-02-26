"use client";

import { useMemo, useEffect, useRef, useCallback } from "react";
import { useCallsContext } from "@/context/calls-context";
import { useAuthContext } from "@/context/auth-context";
import { triggerCall, hangupCall } from "@/lib/api";
import { generateId, formatDuration } from "@/lib/utils";
import type { CallRequest, CallRecord, CallStatus, CallResponse, CallEndedData } from "@/types/call";
import { toast } from "sonner";

const POLL_INTERVAL_MS = 5000;

export function useCalls() {
  const { state, dispatch } = useCallsContext();
  const { user } = useAuthContext();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track which call UUIDs have already shown a toast — prevents duplicate notifications
  const notifiedRef = useRef<Set<string>>(new Set());

  const hasActiveCalls = useMemo(
    () => state.calls.some((c) => c.status === "initiating" || c.status === "in-progress"),
    [state.calls]
  );

  // Use refs for values accessed inside the polling effect to avoid
  // tearing down and re-creating the interval on every state change
  const stateRef = useRef(state);
  stateRef.current = state;

  const applyCallUpdate = useCallback(
    (data: CallEndedData) => {
      // Read from ref to get latest state without causing effect re-runs
      const currentState = stateRef.current;
      const match = currentState.calls.find((c) => c.callUuid === data.call_uuid);
      if (!match) return;

      // Already notified for this UUID — skip entirely (prevents duplicate dispatches + toasts)
      if (notifiedRef.current.has(data.call_uuid)) return;

      // Don't re-apply if call is already in a terminal state
      if (match.status === "completed" || match.status === "no-answer" || match.status === "failed") return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isNoAnswer = !!(data as any).no_answer || (data.duration_seconds === 0 && data.call_summary === "Call was not answered");
      const newStatus: CallStatus = isNoAnswer ? "no-answer" : "completed";

      // Mark as notified BEFORE dispatching to prevent any race conditions
      notifiedRef.current.add(data.call_uuid);

      dispatch({
        type: "UPDATE_CALL",
        payload: {
          id: match.id,
          updates: {
            status: newStatus,
            endedData: data,
            durationSeconds: data.duration_seconds,
            interestLevel: data.interest_level,
            completionRate: data.completion_rate,
            callSummary: data.call_summary,
          },
        },
      });

      if (currentState.activeCall?.callUuid === data.call_uuid) {
        dispatch({ type: "CLEAR_ACTIVE_CALL" });
      }

      if (isNoAnswer) {
        toast.info("Call not answered", {
          description: `${data.contact_name || "Contact"} did not pick up`,
        });
      } else {
        toast.success("Call completed", {
          description: `${data.contact_name} — ${formatDuration(data.duration_seconds)}`,
          duration: 3000,
        });
      }
    },
    [dispatch]
  );

  // Keep a stable ref for applyCallUpdate so the effect doesn't re-run
  const applyCallUpdateRef = useRef(applyCallUpdate);
  applyCallUpdateRef.current = applyCallUpdate;

  useEffect(() => {
    if (!hasActiveCalls) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    const poll = async () => {
      try {
        // Read latest state from ref
        const currentCalls = stateRef.current.calls;
        const activeUuids = currentCalls
          .filter((c) => (c.status === "initiating" || c.status === "in-progress") && c.callUuid)
          .map((c) => c.callUuid);
        if (activeUuids.length === 0) return;

        const res = await fetch(`/api/call-updates?uuids=${activeUuids.join(",")}`);
        if (!res.ok) return;
        const { updates } = await res.json();

        // Deduplicate by call_uuid — keep last entry for each UUID
        const dedupedUpdates = new Map<string, CallEndedData>();
        for (const update of updates) {
          dedupedUpdates.set(update.data.call_uuid, update.data);
        }

        for (const data of dedupedUpdates.values()) {
          applyCallUpdateRef.current(data);
        }
      } catch {
        // silently ignore polling errors
      }
    };

    poll();
    pollingRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [hasActiveCalls]);

  const stats = useMemo(() => {
    const today = new Date().toDateString();
    const todayCalls = state.calls.filter(
      (c) => new Date(c.initiatedAt).toDateString() === today
    );
    const completed = state.calls.filter((c) => c.status === "completed");
    const failed = state.calls.filter(
      (c) => c.status === "failed" || c.status === "no-answer"
    );
    const finished = completed.length + failed.length;

    const totalDurationSeconds = completed.reduce(
      (sum, c) => sum + (c.durationSeconds || 0),
      0
    );

    return {
      totalCalls: state.calls.length,
      todayCalls: todayCalls.length,
      successfulCalls: completed.length,
      failedCalls: failed.length,
      successRate: finished > 0 ? Math.round((completed.length / finished) * 100) : 0,
      totalDurationMinutes: Math.round(totalDurationSeconds / 60),
    };
  }, [state.calls]);

  const initiateCall = async (
    request: CallRequest,
    leadId?: string
  ): Promise<CallResponse> => {
    console.log("[initiateCall] START — contact:", request.contactName, "phone:", request.phoneNumber, "leadId:", leadId);

    const callRecord: CallRecord = {
      id: generateId(),
      callUuid: "",
      leadId,
      request,
      status: "initiating",
      initiatedAt: new Date().toISOString(),
      botConfigId: request.botConfigId,
      botConfigName: request.botConfigName,
    };

    console.log("[initiateCall] Dispatching ADD_CALL and SET_ACTIVE_CALL");
    dispatch({ type: "ADD_CALL", payload: callRecord });
    dispatch({ type: "SET_ACTIVE_CALL", payload: callRecord });

    try {
      let authToken: string | undefined;
      try {
        console.log("[initiateCall] Getting auth token, user:", user ? "exists" : "null");
        authToken = user ? await user.getIdToken() : undefined;
        console.log("[initiateCall] Auth token:", authToken ? "obtained" : "undefined");
      } catch (tokenErr) {
        console.warn("[initiateCall] getIdToken failed:", tokenErr);
      }

      console.log("[initiateCall] Calling triggerCall...");
      const response = await triggerCall(request, leadId, authToken);
      console.log("[initiateCall] triggerCall returned:", JSON.stringify(response));

      dispatch({
        type: "UPDATE_CALL",
        payload: {
          id: callRecord.id,
          updates: {
            callUuid: response.call_uuid,
            response,
            status: "in-progress",
          },
        },
      });
      toast.success("Call initiated successfully!", {
        description: `Call UUID: ${response.call_uuid}`,
      });
      return response;
    } catch (error) {
      console.error("[initiateCall] CAUGHT ERROR:", error);
      dispatch({
        type: "UPDATE_CALL",
        payload: {
          id: callRecord.id,
          updates: { status: "failed" },
        },
      });
      toast.error("Failed to initiate call", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  };

  const updateCallStatus = (callId: string, status: CallStatus) => {
    // Find the call to get its UUID for hangup
    const call = state.calls.find((c) => c.id === callId);

    dispatch({
      type: "UPDATE_CALL",
      payload: { id: callId, updates: { status } },
    });
    if (status === "completed" || status === "failed" || status === "no-answer") {
      dispatch({ type: "CLEAR_ACTIVE_CALL" });

      // Tell the backend to hang up the Plivo call (prevents silent repeat calls)
      if (call?.callUuid) {
        hangupCall(call.callUuid);
      }
    }
  };

  return {
    calls: state.calls,
    activeCall: state.activeCall,
    loaded: state.loaded,
    initiateCall,
    updateCallStatus,
    clearActiveCall: () => dispatch({ type: "CLEAR_ACTIVE_CALL" }),
    ...stats,
  };
}
