"use client";

import { useState, useEffect, useCallback } from "react";
import { Copy, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import type { BotContextVariables } from "@/types/bot-config";

interface WebhookInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  botConfigId: string;
  botConfigName: string;
  contextVariables?: BotContextVariables;
}

export function WebhookInfoDialog({
  open,
  onOpenChange,
  botConfigId,
  botConfigName,
  contextVariables,
}: WebhookInfoDialogProps) {
  const { user } = useAuth();
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = `${baseUrl}/api/webhook/trigger-call`;

  // Auto-fetch or generate API key on open
  const ensureApiKey = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();

      // Try fetching existing key
      const res = await fetch("/api/data/api-key", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.apiKey) {
          setApiKey(data.apiKey);
          setLoading(false);
          return;
        }
      }

      // No key exists — generate one
      const genRes = await fetch("/api/data/api-key", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (genRes.ok) {
        const data = await genRes.json();
        setApiKey(data.apiKey);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (open && !apiKey) ensureApiKey();
  }, [open, apiKey, ensureApiKey]);

  // Build the variable overrides from this config's context variables
  const buildOverrides = (): Record<string, string> => {
    const overrides: Record<string, string> = {};
    if (contextVariables?.agentName) overrides.agent_name = contextVariables.agentName;
    if (contextVariables?.companyName) overrides.company_name = contextVariables.companyName;
    if (contextVariables?.eventName) overrides.event_name = contextVariables.eventName;
    if (contextVariables?.eventHost) overrides.event_host = contextVariables.eventHost;
    if (contextVariables?.location) overrides.location = contextVariables.location;
    if (contextVariables?.customVariables) {
      for (const [k, v] of Object.entries(contextVariables.customVariables)) {
        if (k && v) overrides[k] = v;
      }
    }
    return overrides;
  };

  const overrides = buildOverrides();
  const hasOverrides = Object.keys(overrides).length > 0;

  const payloadObj: Record<string, unknown> = {
    phoneNumber: "+1234567890",
    contactName: "John Doe",
    botConfigId,
  };
  if (hasOverrides) {
    payloadObj.customVariableOverrides = overrides;
  }

  const payloadJson = JSON.stringify(payloadObj, null, 2);

  const curlExample = `curl -X POST '${webhookUrl}' \\
  -H 'Content-Type: application/json' \\
  -H 'x-api-key: ${apiKey || "..."}' \\
  -d '${payloadJson}'`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(curlExample);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>API Trigger — {botConfigName}</DialogTitle>
          <DialogDescription>
            Use this cURL to trigger calls from external systems like GoHighLevel.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3 mt-1">
            <div className="relative">
              <pre className="rounded-md bg-muted p-4 text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed">
                {curlExample}
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="absolute top-2.5 right-2.5 gap-1.5"
                onClick={copyToClipboard}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            <div className="text-xs text-muted-foreground space-y-0.5">
              <p><strong>phoneNumber</strong> — Contact phone number with country code</p>
              <p><strong>contactName</strong> — Contact&apos;s name</p>
              {hasOverrides && (
                <p><strong>customVariableOverrides</strong> — Variables used in this bot&apos;s prompt (pre-filled with current defaults, override as needed)</p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
