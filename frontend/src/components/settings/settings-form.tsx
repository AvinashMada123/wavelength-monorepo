"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Brain, CheckCircle2, XCircle } from "lucide-react";
import { useSettings } from "@/hooks/use-settings";
import { VOICE_OPTIONS } from "@/lib/constants";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export function SettingsForm() {
  const { settings, updateSettings, resetToDefaults } = useSettings();

  const [clientName, setClientName] = useState(settings.defaults.clientName);
  const [agentName, setAgentName] = useState(settings.defaults.agentName);
  const [companyName, setCompanyName] = useState(settings.defaults.companyName);
  const [eventName, setEventName] = useState(settings.defaults.eventName);
  const [eventHost, setEventHost] = useState(settings.defaults.eventHost);
  const [location, setLocation] = useState(settings.defaults.location);
  const [voice, setVoice] = useState(settings.defaults.voice);
  const [webhookUrl, setWebhookUrl] = useState(settings.webhookUrl);
  const [ghlWhatsappWebhookUrl, setGhlWhatsappWebhookUrl] = useState(
    settings.ghlWhatsappWebhookUrl || ""
  );
  const [ghlApiKey, setGhlApiKey] = useState(settings.ghlApiKey || "");
  const [ghlLocationId, setGhlLocationId] = useState(
    settings.ghlLocationId || ""
  );
  const [plivoAuthId, setPlivoAuthId] = useState(settings.plivoAuthId || "");
  const [plivoAuthToken, setPlivoAuthToken] = useState(
    settings.plivoAuthToken || ""
  );
  const [plivoPhoneNumber, setPlivoPhoneNumber] = useState(
    settings.plivoPhoneNumber || ""
  );
  const [twilioAccountSid, setTwilioAccountSid] = useState(
    settings.twilioAccountSid || ""
  );
  const [twilioAuthToken, setTwilioAuthToken] = useState(
    settings.twilioAuthToken || ""
  );
  const [twilioPhoneNumber, setTwilioPhoneNumber] = useState(
    settings.twilioPhoneNumber || ""
  );
  const [autoQualify, setAutoQualify] = useState(
    settings.ai?.autoQualify ?? true
  );
  const [animationsEnabled, setAnimationsEnabled] = useState(
    settings.appearance.animationsEnabled
  );
  const [maxConcurrentCalls, setMaxConcurrentCalls] = useState(
    settings.maxConcurrentCalls ?? 40
  );
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(
    null
  );

  const checkGeminiStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/gemini-status");
      const data = await res.json();
      setGeminiConfigured(data.configured);
    } catch {
      setGeminiConfigured(false);
    }
  }, []);

  useEffect(() => {
    checkGeminiStatus();
  }, [checkGeminiStatus]);

  useEffect(() => {
    setClientName(settings.defaults.clientName);
    setAgentName(settings.defaults.agentName);
    setCompanyName(settings.defaults.companyName);
    setEventName(settings.defaults.eventName);
    setEventHost(settings.defaults.eventHost);
    setLocation(settings.defaults.location);
    setVoice(settings.defaults.voice);
    setWebhookUrl(settings.webhookUrl);
    setGhlWhatsappWebhookUrl(settings.ghlWhatsappWebhookUrl || "");
    setGhlApiKey(settings.ghlApiKey || "");
    setGhlLocationId(settings.ghlLocationId || "");
    setPlivoAuthId(settings.plivoAuthId || "");
    setPlivoAuthToken(settings.plivoAuthToken || "");
    setPlivoPhoneNumber(settings.plivoPhoneNumber || "");
    setTwilioAccountSid(settings.twilioAccountSid || "");
    setTwilioAuthToken(settings.twilioAuthToken || "");
    setTwilioPhoneNumber(settings.twilioPhoneNumber || "");
    setAutoQualify(settings.ai?.autoQualify ?? true);
    setAnimationsEnabled(settings.appearance.animationsEnabled);
    setMaxConcurrentCalls(settings.maxConcurrentCalls ?? 40);
  }, [settings]);

  const handleSave = () => {
    updateSettings({
      defaults: {
        clientName,
        agentName,
        companyName,
        eventName,
        eventHost,
        voice,
        location,
      },
      webhookUrl,
      ghlWhatsappWebhookUrl,
      ghlApiKey,
      ghlLocationId,
      plivoAuthId,
      plivoAuthToken,
      plivoPhoneNumber,
      twilioAccountSid,
      twilioAuthToken,
      twilioPhoneNumber,
      ai: {
        autoQualify,
      },
      appearance: {
        ...settings.appearance,
        animationsEnabled,
      },
      maxConcurrentCalls,
    });
    toast.success("Settings saved");
  };

  const handleReset = () => {
    resetToDefaults();
    toast.success("Settings reset to defaults");
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <motion.div
      className="space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Section 1: Default Call Values */}
      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader>
            <CardTitle>Default Call Values</CardTitle>
            <CardDescription>
              These values will pre-fill the call form
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="clientName">Client Name</Label>
                <Input
                  id="clientName"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Client name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agentName">Agent Name</Label>
                <Input
                  id="agentName"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="Agent name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="companyName">Company Name</Label>
                <Input
                  id="companyName"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Company name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="eventName">Event Name</Label>
                <Input
                  id="eventName"
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  placeholder="Event name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="eventHost">Event Host</Label>
                <Input
                  id="eventHost"
                  value={eventHost}
                  onChange={(e) => setEventHost(e.target.value)}
                  placeholder="Event host"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Location"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="voice">Voice</Label>
              <Select value={voice} onValueChange={setVoice}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a voice" />
                </SelectTrigger>
                <SelectContent>
                  {VOICE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label} — {option.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Section 2: CRM & Webhook Configuration */}
      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader>
            <CardTitle>CRM Integration</CardTitle>
            <CardDescription>
              Connect your CRM to enable contact tagging, lead sync, and workflow automations.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ghlApiKey">Private Integration Token</Label>
                <Input
                  id="ghlApiKey"
                  type="password"
                  value={ghlApiKey}
                  onChange={(e) => setGhlApiKey(e.target.value)}
                  placeholder="pit-xxxxxxxx..."
                />
                <p className="text-xs text-muted-foreground">
                  Settings &rarr; Integrations &rarr; Private Integrations &rarr; Create &rarr; Copy Token
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ghlLocationId">CRM Location ID</Label>
                <Input
                  id="ghlLocationId"
                  value={ghlLocationId}
                  onChange={(e) => setGhlLocationId(e.target.value)}
                  placeholder="xxxxxxxx..."
                />
                <p className="text-xs text-muted-foreground">
                  Settings &rarr; Business Profile &rarr; Location ID
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhookUrl">Webhook URL</Label>
              <Input
                id="webhookUrl"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://example.com/webhook"
              />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Section 3: Plivo Configuration */}
      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader>
            <CardTitle>Plivo Configuration</CardTitle>
            <CardDescription>
              Configure your Plivo credentials for voice calling. If not set, system defaults will be used.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="plivoAuthId">Plivo Auth ID</Label>
                <Input
                  id="plivoAuthId"
                  value={plivoAuthId}
                  onChange={(e) => setPlivoAuthId(e.target.value)}
                  placeholder="MAXXXXXXXXXXXXXXXX"
                />
                <p className="text-xs text-muted-foreground">
                  Your Plivo Auth ID from the Plivo dashboard
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="plivoAuthToken">Plivo Auth Token</Label>
                <Input
                  id="plivoAuthToken"
                  type="password"
                  value={plivoAuthToken}
                  onChange={(e) => setPlivoAuthToken(e.target.value)}
                  placeholder="Your auth token"
                />
                <p className="text-xs text-muted-foreground">
                  Your Plivo Auth Token (keep this secure)
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="plivoPhoneNumber">Plivo Phone Number</Label>
              <Input
                id="plivoPhoneNumber"
                value={plivoPhoneNumber}
                onChange={(e) => setPlivoPhoneNumber(e.target.value)}
                placeholder="+1234567890"
              />
              <p className="text-xs text-muted-foreground">
                Your Plivo phone number (E.164 format, e.g., +1234567890)
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Section 3b: Twilio Configuration */}
      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader>
            <CardTitle>Twilio Configuration</CardTitle>
            <CardDescription>
              Configure your Twilio credentials for international voice calling. Set a bot config&apos;s Call Provider to &quot;Twilio&quot; to use these credentials.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="twilioAccountSid">Twilio Account SID</Label>
                <Input
                  id="twilioAccountSid"
                  value={twilioAccountSid}
                  onChange={(e) => setTwilioAccountSid(e.target.value)}
                  placeholder="ACXXXXXXXXXXXXXXXX"
                />
                <p className="text-xs text-muted-foreground">
                  Your Twilio Account SID from the Twilio console
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="twilioAuthToken">Twilio Auth Token</Label>
                <Input
                  id="twilioAuthToken"
                  type="password"
                  value={twilioAuthToken}
                  onChange={(e) => setTwilioAuthToken(e.target.value)}
                  placeholder="Your auth token"
                />
                <p className="text-xs text-muted-foreground">
                  Your Twilio Auth Token (keep this secure)
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="twilioPhoneNumber">Twilio Phone Number</Label>
              <Input
                id="twilioPhoneNumber"
                value={twilioPhoneNumber}
                onChange={(e) => setTwilioPhoneNumber(e.target.value)}
                placeholder="+1234567890"
              />
              <p className="text-xs text-muted-foreground">
                Your Twilio phone number (E.164 format, e.g., +1234567890)
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Section 4: AI Lead Qualification */}
      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              AI Lead Qualification
            </CardTitle>
            <CardDescription>
              Automatically qualify leads as HOT, WARM, or COLD using Gemini AI
              after each call
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border p-3">
              {geminiConfigured === null ? (
                <div className="h-4 w-4 animate-pulse rounded-full bg-muted" />
              ) : geminiConfigured ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500" />
              )}
              <div className="flex-1">
                <p className="text-sm font-medium">
                  Gemini API Key{" "}
                  {geminiConfigured === null
                    ? "Checking..."
                    : geminiConfigured
                      ? "Configured"
                      : "Not Configured"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Set <code className="text-xs">GEMINI_API_KEY</code> in your{" "}
                  <code className="text-xs">.env.local</code> file or Vercel
                  environment variables
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="autoQualify">Auto-qualify leads</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically update lead status after call qualification
                </p>
              </div>
              <Switch
                id="autoQualify"
                checked={autoQualify}
                onCheckedChange={setAutoQualify}
              />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Section 5: Call Concurrency */}
      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader>
            <CardTitle>Call Concurrency</CardTitle>
            <CardDescription>
              Maximum number of simultaneous active calls. Webhook calls
              exceeding this limit are automatically queued and processed when
              slots open up.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="maxConcurrentCalls">Max Concurrent Calls</Label>
              <Input
                id="maxConcurrentCalls"
                type="number"
                min={1}
                max={50}
                value={maxConcurrentCalls}
                onChange={(e) =>
                  setMaxConcurrentCalls(
                    Math.max(1, Math.min(50, parseInt(e.target.value) || 40))
                  )
                }
                placeholder="40"
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                The call server supports up to 50 concurrent sessions. We
                recommend 40 to leave headroom. Default: 40.
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Section 6: Appearance */}
      <motion.div variants={itemVariants}>
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <Label htmlFor="animations">Enable Animations</Label>
              <Switch
                id="animations"
                checked={animationsEnabled}
                onCheckedChange={setAnimationsEnabled}
              />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Footer Buttons */}
      <motion.div variants={itemVariants} className="flex gap-4">
        <Button onClick={handleSave}>Save Settings</Button>
        <Button variant="outline" onClick={handleReset}>
          Reset to Defaults
        </Button>
      </motion.div>
    </motion.div>
  );
}
