"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useSettings } from "@/hooks/use-settings";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface TestResult {
  success: boolean;
  message: string;
}

export function WebhookTester() {
  const { settings } = useSettings();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const handleTest = async () => {
    if (!settings.webhookUrl) {
      setResult({
        success: false,
        message: "No webhook URL configured",
      });
      return;
    }

    setLoading(true);
    setResult(null);

    const startTime = performance.now();

    try {
      const response = await fetch(settings.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          test: true,
          timestamp: new Date().toISOString(),
          source: "wavelength-settings",
          payload: {
            phoneNumber: "+1234567890",
            contactName: "Test Contact",
            agentName: "Test Agent",
            companyName: "Test Company",
          },
        }),
      });

      const elapsed = Math.round(performance.now() - startTime);

      if (response.ok) {
        setResult({
          success: true,
          message: `Connection successful (${elapsed}ms)`,
        });
      } else {
        setResult({
          success: false,
          message: `Server responded with status ${response.status}`,
        });
      }
    } catch (error) {
      const elapsed = Math.round(performance.now() - startTime);
      setResult({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : `Connection failed (${elapsed}ms)`,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test Webhook</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={handleTest} disabled={loading} variant="outline">
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Testing...
            </>
          ) : (
            "Test Connection"
          )}
        </Button>

        <AnimatePresence mode="wait">
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className={`flex items-center gap-2 rounded-md border p-3 text-sm ${
                result.success
                  ? "border-green-500/30 bg-green-500/10 text-green-400"
                  : "border-red-500/30 bg-red-500/10 text-red-400"
              }`}
            >
              {result.success ? (
                <CheckCircle className="h-4 w-4 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0" />
              )}
              <span>{result.message}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
