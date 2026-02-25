"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Save,
  Loader2,
  Info,
  Plus,
  X,
  Trash2,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { generateId } from "@/lib/utils";
import type { BotConfig, BotContextVariables, GhlWorkflow } from "@/types/bot-config";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import { PersonaTab } from "./persona-tab";
import { ProductsTab } from "./products-tab";
import { SocialProofTab } from "./social-proof-tab";

type TabId = "prompt" | "context" | "persona" | "products" | "social-proof" | "ghl-workflows" | "options";

async function apiBotConfigs(
  user: { getIdToken: () => Promise<string> },
  method: "GET" | "POST",
  body?: Record<string, unknown>
) {
  const idToken = await user.getIdToken();
  const res = await fetch("/api/data/bot-configs", {
    method,
    headers: {
      Authorization: `Bearer ${idToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error("Request failed");
  return res.json();
}

export default function BotConfigEditorPage() {
  const params = useParams();
  const router = useRouter();
  const { orgId, user, initialData, refreshProfile } = useAuth();

  const configId = params.configId as string;

  const [config, setConfig] = useState<BotConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("prompt");

  // Local editable state
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [contextVariables, setContextVariables] = useState<BotContextVariables>({});
  const [personaEngineEnabled, setPersonaEngineEnabled] = useState(false);
  const [productIntelligenceEnabled, setProductIntelligenceEnabled] = useState(false);
  const [socialProofEnabled, setSocialProofEnabled] = useState(false);
  const [preResearchEnabled, setPreResearchEnabled] = useState(false);
  const [memoryRecallEnabled, setMemoryRecallEnabled] = useState(false);
  const [maxCallDuration, setMaxCallDuration] = useState(480);
  const [ghlWorkflows, setGhlWorkflows] = useState<GhlWorkflow[]>([]);
  const [voice, setVoice] = useState("");
  const hasLoadedRef = useRef(false);

  const populateConfig = useCallback((found: BotConfig) => {
    setConfig(found);
    setName(found.name);
    setPrompt(found.prompt);
    setContextVariables(found.contextVariables || {});
    setPersonaEngineEnabled(found.personaEngineEnabled || false);
    setProductIntelligenceEnabled(found.productIntelligenceEnabled || false);
    setSocialProofEnabled(found.socialProofEnabled || false);
    setPreResearchEnabled(found.preResearchEnabled || false);
    setMemoryRecallEnabled(found.memoryRecallEnabled || false);
    setMaxCallDuration(found.maxCallDuration ?? 480);
    setGhlWorkflows(found.ghlWorkflows || []);
    setVoice(found.voice || "");
    setLoading(false);
    hasLoadedRef.current = true;
  }, []);

  // Load config once — use initialData for instant render, fall back to API
  useEffect(() => {
    if (!orgId || hasLoadedRef.current) return;

    if (initialData?.botConfigs) {
      const found = (initialData.botConfigs as BotConfig[]).find((c) => c.id === configId);
      if (found) {
        populateConfig(found);
        return;
      }
    }

    // Fallback: fetch from server
    if (!user) return;
    (async () => {
      try {
        setLoading(true);
        const data = await apiBotConfigs(user, "GET");
        const found = (data.configs as BotConfig[]).find((c) => c.id === configId);
        if (!found) {
          toast.error("Configuration not found");
          router.push("/bot-config");
          return;
        }
        populateConfig(found);
      } catch {
        toast.error("Failed to load configuration");
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, configId, initialData]);

  async function handleSeedDemoData() {
    if (!user) return;
    try {
      setSeeding(true);
      const idToken = await user.getIdToken();
      const res = await fetch("/api/data/seed-demo", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ botConfigId: configId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(
          `Seeded demo data: ${data.seeded.personas} personas, ${data.seeded.productSections} products, ${data.seeded.companies + data.seeded.cities + data.seeded.roles} social proof entries. Refresh tabs to see data.`
        );
      } else {
        toast.error("Failed to seed demo data");
      }
    } catch {
      toast.error("Failed to seed demo data");
    } finally {
      setSeeding(false);
    }
  }

  async function handleSave() {
    if (!user || !config) return;
    try {
      setSaving(true);

      await apiBotConfigs(user, "POST", {
        action: "update",
        configId,
        updates: {
          name,
          prompt,
          contextVariables,
          personaEngineEnabled,
          productIntelligenceEnabled,
          socialProofEnabled,
          preResearchEnabled,
          memoryRecallEnabled,
          maxCallDuration,
          ghlWorkflows,
          voice,
        },
      });
      toast.success("Configuration saved successfully");
      // Refresh auth context so initialData/cache has the updated bot config
      refreshProfile();
    } catch {
      toast.error("Failed to save configuration");
    } finally {
      setSaving(false);
    }
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: "prompt", label: "Prompt" },
    { id: "context", label: "Variables" },
    { id: "persona", label: "Persona" },
    { id: "products", label: "Products" },
    { id: "social-proof", label: "Social Proof" },
    { id: "ghl-workflows", label: "GHL Workflows" },
    { id: "options", label: "Additional Options" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push("/bot-config")}>
            <ArrowLeft className="size-5" />
          </Button>
          <div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-2xl font-bold border-none shadow-none px-0 h-auto focus-visible:ring-0"
              placeholder="Config name"
            />
            <p className="text-sm text-muted-foreground ml-0.5">
              {config.isActive ? "Active configuration" : "Inactive configuration"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSeedDemoData} disabled={seeding}>
            {seeding ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
            {seeding ? "Seeding..." : "Seed Demo Data"}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save Changes
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors relative ${
              activeTab === tab.id
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <motion.div
                layoutId="botConfigTab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {activeTab === "prompt" && (
          <PromptTab prompt={prompt} onPromptChange={setPrompt} />
        )}
        {activeTab === "context" && (
          <ContextTab
            contextVariables={contextVariables}
            onContextChange={setContextVariables}
            voice={voice}
            onVoiceChange={setVoice}
          />
        )}
        {activeTab === "persona" && user && (
          <PersonaTab
            orgId={orgId!}
            configId={configId}
            user={user}
            enabled={personaEngineEnabled}
            onToggle={setPersonaEngineEnabled}
          />
        )}
        {activeTab === "products" && user && (
          <ProductsTab
            orgId={orgId!}
            configId={configId}
            user={user}
            enabled={productIntelligenceEnabled}
            onToggle={setProductIntelligenceEnabled}
          />
        )}
        {activeTab === "social-proof" && user && (
          <SocialProofTab
            orgId={orgId!}
            configId={configId}
            user={user}
            enabled={socialProofEnabled}
            onToggle={setSocialProofEnabled}
          />
        )}
        {activeTab === "ghl-workflows" && (
          <GhlWorkflowsTab
            workflows={ghlWorkflows}
            onChange={setGhlWorkflows}
          />
        )}
        {activeTab === "options" && user && (
          <AdditionalOptionsTab
            user={user}
            preResearchEnabled={preResearchEnabled}
            onPreResearchToggle={setPreResearchEnabled}
            memoryRecallEnabled={memoryRecallEnabled}
            onMemoryRecallToggle={setMemoryRecallEnabled}
            maxCallDuration={maxCallDuration}
            onMaxCallDurationChange={setMaxCallDuration}
          />
        )}
      </motion.div>
    </div>
  );
}

/* ========== Prompt Tab ========== */
function PromptTab({
  prompt,
  onPromptChange,
}: {
  prompt: string;
  onPromptChange: (v: string) => void;
}) {
  const variables = [
    { name: "{agent_name}", desc: "The AI agent's name" },
    { name: "{customer_name}", desc: "The customer's name" },
    { name: "{company_name}", desc: "Your company name" },
    { name: "{event_host}", desc: "Name of the event host" },
    { name: "{location}", desc: "Office location" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bot System Prompt</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          rows={14}
          className="font-mono text-sm"
          placeholder="Enter the bot system prompt..."
        />
        <div className="rounded-lg border bg-muted/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Info className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Available Variables</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {variables.map((v) => (
              <div key={v.name} className="flex items-center gap-2 text-sm">
                <Badge variant="secondary" className="font-mono text-xs">
                  {v.name}
                </Badge>
                <span className="text-muted-foreground">{v.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ========== Context Tab ========== */

const VOICE_OPTIONS = [
  { value: "", label: "Auto-detect from prompt" },
  { value: "Puck", label: "Puck (Male)" },
  { value: "Kore", label: "Kore (Female)" },
];

function ContextTab({
  contextVariables,
  onContextChange,
  voice,
  onVoiceChange,
}: {
  contextVariables: BotContextVariables;
  onContextChange: (v: BotContextVariables) => void;
  voice: string;
  onVoiceChange: (v: string) => void;
}) {
  const fields: { key: Exclude<keyof BotContextVariables, "customVariables">; label: string; placeholder: string; variable: string }[] = [
    { key: "agentName", label: "Agent Name", placeholder: "e.g. Priya", variable: "{agent_name}" },
    { key: "companyName", label: "Company Name", placeholder: "e.g. FutureWorks AI", variable: "{company_name}" },
    { key: "eventName", label: "Event Name", placeholder: "e.g. AI Masterclass", variable: "{event_name}" },
    { key: "eventHost", label: "Event Host", placeholder: "e.g. Avinash", variable: "{event_host}" },
    { key: "location", label: "Location", placeholder: "e.g. Hyderabad", variable: "{location}" },
  ];

  const customVars = contextVariables.customVariables || {};
  const customKeys = Object.keys(customVars);

  const addCustomVar = () => {
    const updated = { ...customVars };
    // Generate a unique placeholder key
    let i = customKeys.length + 1;
    while (updated[`variable_${i}`] !== undefined) i++;
    updated[`variable_${i}`] = "";
    onContextChange({ ...contextVariables, customVariables: updated });
  };

  const updateCustomKey = (oldKey: string, newKey: string) => {
    const cleaned = newKey.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
    if (!cleaned || cleaned === oldKey) return;
    if (customVars[cleaned] !== undefined) return; // duplicate key
    const updated: Record<string, string> = {};
    for (const [k, v] of Object.entries(customVars)) {
      updated[k === oldKey ? cleaned : k] = v;
    }
    onContextChange({ ...contextVariables, customVariables: updated });
  };

  const updateCustomValue = (key: string, value: string) => {
    onContextChange({
      ...contextVariables,
      customVariables: { ...customVars, [key]: value },
    });
  };

  const removeCustomVar = (key: string) => {
    const updated = { ...customVars };
    delete updated[key];
    onContextChange({ ...contextVariables, customVariables: updated });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Context Variables</CardTitle>
          <p className="text-sm text-muted-foreground">
            These values replace the {"{variable}"} placeholders in your prompt and questions.
            When set here, callers won&apos;t need to fill them in the call form.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {fields.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label className="text-sm">
                  {f.label}
                  <Badge variant="secondary" className="ml-2 font-mono text-xs">
                    {f.variable}
                  </Badge>
                </Label>
                <Input
                  value={contextVariables[f.key] || ""}
                  onChange={(e) =>
                    onContextChange({ ...contextVariables, [f.key]: e.target.value })
                  }
                  placeholder={f.placeholder}
                />
              </div>
            ))}
          </div>

          {/* Custom Variables */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="text-sm font-medium">Custom Variables</h4>
                <p className="text-xs text-muted-foreground">
                  Add your own variables to use as {"{variable_name}"} in prompts.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addCustomVar}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Variable
              </Button>
            </div>
            {customKeys.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {customKeys.map((key) => (
                  <div key={key} className="space-y-1.5 relative group">
                    <Label className="text-sm flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{key}</span>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {`{${key}}`}
                      </Badge>
                      <button
                        type="button"
                        onClick={() => removeCustomVar(key)}
                        className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </Label>
                    <Input
                      value={customVars[key]}
                      onChange={(e) => updateCustomValue(key, e.target.value)}
                      placeholder={`Value for ${key}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Voice</CardTitle>
          <p className="text-sm text-muted-foreground">
            Choose the speaking voice for calls made with this bot configuration.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label className="text-sm">Voice</Label>
            <select
              value={voice}
              onChange={(e) => onVoiceChange(e.target.value)}
              className="flex h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {VOICE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ========== Additional Options Tab ========== */

function AdditionalOptionsTab({
  user,
  preResearchEnabled,
  onPreResearchToggle,
  memoryRecallEnabled,
  onMemoryRecallToggle,
  maxCallDuration,
  onMaxCallDurationChange,
}: {
  user: { getIdToken: () => Promise<string> };
  preResearchEnabled: boolean;
  onPreResearchToggle: (v: boolean) => void;
  memoryRecallEnabled: boolean;
  onMemoryRecallToggle: (v: boolean) => void;
  maxCallDuration: number;
  onMaxCallDurationChange: (v: number) => void;
}) {
  const [mmConfig, setMmConfig] = useState<Record<string, unknown> | null>(null);
  const [mmSaving, setMmSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch("/api/data/keyword-config", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "getMicroMomentsConfig" }),
        });
        if (res.ok) {
          setMmConfig(await res.json());
        }
      } catch {
        // Non-critical
      }
    })();
  }, [user]);

  async function handleSaveMmConfig() {
    if (!mmConfig) return;
    try {
      setMmSaving(true);
      const idToken = await user.getIdToken();
      const res = await fetch("/api/data/keyword-config", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "updateMicroMomentsConfig", config: mmConfig }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Micro-moments config saved");
    } catch {
      toast.error("Failed to save micro-moments config");
    } finally {
      setMmSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Advanced Features</CardTitle>
          <p className="text-sm text-muted-foreground">
            Enable or disable advanced bot capabilities for this configuration.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Pre-Research</Label>
              <p className="text-sm text-muted-foreground">
                Bot researches lead data (company, industry) before a call to personalize the conversation
              </p>
            </div>
            <Switch
              checked={preResearchEnabled}
              onCheckedChange={onPreResearchToggle}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Memory Recall</Label>
              <p className="text-sm text-muted-foreground">
                Bot remembers past conversations with a lead across calls
              </p>
            </div>
            <Switch
              checked={memoryRecallEnabled}
              onCheckedChange={onMemoryRecallToggle}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Max Call Duration</Label>
              <p className="text-sm text-muted-foreground">
                Maximum duration (in minutes) before the bot wraps up the call
              </p>
            </div>
            <Input
              type="number"
              min={1}
              max={60}
              className="w-20 text-center"
              value={Math.round(maxCallDuration / 60)}
              onChange={(e) => {
                const mins = parseInt(e.target.value) || 1;
                onMaxCallDurationChange(Math.max(1, Math.min(60, mins)) * 60);
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Micro-Moments Config */}
      {mmConfig && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Micro-Moment Detection Config</CardTitle>
            <p className="text-sm text-muted-foreground">
              Configure thresholds and hints for real-time micro-moment detection during calls.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Cooldown Turns</Label>
                <Input
                  type="number"
                  className="h-8 text-sm"
                  value={(mmConfig.cooldown_turns as number) ?? 3}
                  onChange={(e) =>
                    setMmConfig((c) => c ? { ...c, cooldown_turns: parseInt(e.target.value) || 0 } : c)
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Lock Turns</Label>
                <Input
                  type="number"
                  className="h-8 text-sm"
                  value={(mmConfig.lock_turns as number) ?? 3}
                  onChange={(e) =>
                    setMmConfig((c) => c ? { ...c, lock_turns: parseInt(e.target.value) || 0 } : c)
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Min Turns for Detection</Label>
                <Input
                  type="number"
                  className="h-8 text-sm"
                  value={(mmConfig.min_turns_for_detection as number) ?? 3}
                  onChange={(e) =>
                    setMmConfig((c) => c ? { ...c, min_turns_for_detection: parseInt(e.target.value) || 0 } : c)
                  }
                />
              </div>
            </div>

            {mmConfig.moments && typeof mmConfig.moments === "object" ? (
              <div className="space-y-3">
                <Label className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                  Moment Hints
                </Label>
                {Object.entries(mmConfig.moments as Record<string, { hint?: string }>).map(
                  ([momentName, momentData]) => (
                    <div key={momentName} className="rounded-lg border p-3 space-y-2">
                      <Label className="text-xs font-medium">
                        {momentName.replace(/_/g, " ")}
                      </Label>
                      <Textarea
                        value={momentData.hint || ""}
                        onChange={(e) =>
                          setMmConfig((c) => {
                            if (!c) return c;
                            const moments = { ...(c.moments as Record<string, unknown>) };
                            moments[momentName] = { ...(moments[momentName] as Record<string, unknown>), hint: e.target.value };
                            return { ...c, moments };
                          })
                        }
                        rows={2}
                        className="text-sm"
                        placeholder="System hint when this moment is detected..."
                      />
                    </div>
                  )
                )}
              </div>
            ) : null}

            <Button size="sm" onClick={handleSaveMmConfig} disabled={mmSaving}>
              {mmSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Save Micro-Moments Config
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ========== GHL Workflows Tab ========== */

const TIMING_OPTIONS: { value: GhlWorkflow["timing"]; label: string; description: string }[] = [
  { value: "pre_call", label: "Pre-Call", description: "Triggers before the call connects" },
  { value: "during_call", label: "During Call", description: "AI decides when to trigger based on conversation" },
  { value: "post_call", label: "Post-Call", description: "Triggers automatically when the call ends" },
];

function GhlWorkflowsTab({
  workflows,
  onChange,
}: {
  workflows: GhlWorkflow[];
  onChange: (v: GhlWorkflow[]) => void;
}) {
  function addWorkflow() {
    onChange([
      ...workflows,
      {
        id: `wf_${generateId().slice(0, 8)}`,
        name: "",
        description: "",
        webhookUrl: "",
        timing: "during_call",
        enabled: true,
      },
    ]);
  }

  function updateWorkflow(id: string, updates: Partial<GhlWorkflow>) {
    onChange(workflows.map((w) => (w.id === id ? { ...w, ...updates } : w)));
  }

  function removeWorkflow(id: string) {
    onChange(workflows.filter((w) => w.id !== id));
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Workflow className="size-5" />
                GHL Workflow Triggers
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Configure GoHighLevel workflows that the AI can trigger during calls.
                Each workflow is a webhook URL that gets called with the contact&apos;s details.
              </p>
            </div>
            <Button onClick={addWorkflow} size="sm">
              <Plus className="size-4" />
              Add Workflow
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {workflows.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Workflow className="size-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No workflows configured yet</p>
              <p className="text-xs mt-1">Add a workflow to let the AI trigger GHL automations</p>
            </div>
          ) : (
            workflows.map((wf) => (
              <div key={wf.id} className="rounded-lg border p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Workflow Name</Label>
                      <Input
                        value={wf.name}
                        onChange={(e) => updateWorkflow(wf.id, { name: e.target.value })}
                        placeholder="e.g. Send Welcome WhatsApp"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Webhook URL</Label>
                      <Input
                        value={wf.webhookUrl}
                        onChange={(e) => updateWorkflow(wf.id, { webhookUrl: e.target.value })}
                        placeholder="https://services.leadconnectorhq.com/hooks/..."
                        className="h-8 text-sm font-mono"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-5">
                    <Switch
                      checked={wf.enabled}
                      onCheckedChange={(v) => updateWorkflow(wf.id, { enabled: v })}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      onClick={() => removeWorkflow(wf.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">
                    AI Trigger Description
                    <span className="text-muted-foreground ml-1 font-normal">
                      (tells the AI when to trigger this workflow)
                    </span>
                  </Label>
                  <Textarea
                    value={wf.description}
                    onChange={(e) => updateWorkflow(wf.id, { description: e.target.value })}
                    placeholder="e.g. Trigger when the customer confirms they want more information about the course. Send them a WhatsApp with details."
                    rows={2}
                    className="text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Trigger Timing</Label>
                  <div className="flex gap-2">
                    {TIMING_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => updateWorkflow(wf.id, { timing: opt.value })}
                        className={`flex-1 rounded-md border px-3 py-2 text-left transition-colors ${
                          wf.timing === opt.value
                            ? "border-primary bg-primary/5 text-foreground"
                            : "border-border text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        <div className="text-xs font-medium">{opt.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
