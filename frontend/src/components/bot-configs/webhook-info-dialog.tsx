"use client";

import { useState, useEffect, useCallback } from "react";
import { Copy, Check, RefreshCw, Key } from "lucide-react";
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

interface WebhookInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  botConfigId: string;
  botConfigName: string;
}

export function WebhookInfoDialog({
  open,
  onOpenChange,
  botConfigId,
  botConfigName,
}: WebhookInfoDialogProps) {
  const { user } = useAuth();
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = `${baseUrl}/api/webhook/trigger-call`;

  const fetchApiKey = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/data/api-key", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setApiKey(data.apiKey || "");
      }
    } catch {
      // ignore
    }
  }, [user]);

  useEffect(() => {
    if (open) fetchApiKey();
  }, [open, fetchApiKey]);

  const generateApiKey = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/data/api-key", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setApiKey(data.apiKey);
        toast.success("API key generated");
      }
    } catch {
      toast.error("Failed to generate API key");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedField(null), 2000);
  };

  const examplePayload = JSON.stringify(
    {
      phoneNumber: "+1234567890",
      contactName: "John Doe",
      botConfigId,
      ...(true ? {} : { leadId: "optional-lead-uuid" }),
      ...(true ? {} : { customVariableOverrides: { company_name: "Acme Corp" } }),
    },
    null,
    2
  );

  const fullPayload = JSON.stringify(
    {
      phoneNumber: "+1234567890",
      contactName: "John Doe",
      botConfigId,
      leadId: "optional-lead-uuid",
      customVariableOverrides: {
        company_name: "Acme Corp",
        agent_name: "Custom Agent Name",
      },
    },
    null,
    2
  );

  const curlExample = `curl -X POST '${webhookUrl}' \\
  -H 'Content-Type: application/json' \\
  -H 'x-api-key: ${apiKey || "<your-api-key>"}' \\
  -d '${examplePayload}'`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>API Trigger — {botConfigName}</DialogTitle>
          <DialogDescription>
            Use this endpoint to trigger calls with this bot config from external systems like GoHighLevel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* API Key */}
          <div className="space-y-2">
            <label className="text-sm font-medium">API Key</label>
            {apiKey ? (
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono break-all">
                  {apiKey}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(apiKey, "key")}
                >
                  {copiedField === "key" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={generateApiKey}
                  disabled={loading}
                  title="Regenerate key"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-sm text-muted-foreground">No API key generated yet.</p>
                <Button size="sm" onClick={generateApiKey} disabled={loading} className="gap-1.5">
                  <Key className="h-3.5 w-3.5" />
                  {loading ? "Generating..." : "Generate API Key"}
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              This key is shared across all bot configs in your organization. Regenerating will invalidate the previous key.
            </p>
          </div>

          {/* Webhook URL */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Webhook URL</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono break-all">
                POST {webhookUrl}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(webhookUrl, "url")}
              >
                {copiedField === "url" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          {/* Bot Config ID */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Bot Config ID</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono break-all">
                {botConfigId}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(botConfigId, "configId")}
              >
                {copiedField === "configId" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          {/* Request Structure */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Request Body</label>
            <div className="relative">
              <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto whitespace-pre">
                {fullPayload}
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="absolute top-2 right-2"
                onClick={() => copyToClipboard(fullPayload, "payload")}
              >
                {copiedField === "payload" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p><strong>phoneNumber</strong> (required) — Contact phone number with country code</p>
              <p><strong>contactName</strong> (required) — Contact&apos;s name</p>
              <p><strong>botConfigId</strong> (required) — Pre-filled for this config</p>
              <p><strong>leadId</strong> (optional) — Lead UUID for memory recall</p>
              <p><strong>customVariableOverrides</strong> (optional) — Override any context variables</p>
            </div>
          </div>

          {/* Headers */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Required Headers</label>
            <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto whitespace-pre">{`Content-Type: application/json
x-api-key: ${apiKey || "<your-api-key>"}`}</pre>
          </div>

          {/* cURL Example */}
          <div className="space-y-2">
            <label className="text-sm font-medium">cURL Example</label>
            <div className="relative">
              <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto whitespace-pre">
                {curlExample}
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="absolute top-2 right-2"
                onClick={() => copyToClipboard(curlExample, "curl")}
              >
                {copiedField === "curl" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          {/* Response */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Response</label>
            <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto whitespace-pre">{`// Success (200)
{
  "success": true,
  "callUuid": "uuid-...",
  "message": "Call initiated"
}

// Error (4xx/5xx)
{
  "success": false,
  "message": "Error description"
}`}</pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
