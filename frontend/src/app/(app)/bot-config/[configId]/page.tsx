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
  Download,
  Check,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { generateId } from "@/lib/utils";
import { downloadJson } from "@/lib/bot-config-io";
import { LANGUAGE_OPTIONS, TTS_PROVIDER_OPTIONS, GOOGLE_CLOUD_VOICES } from "@/lib/constants";
import type { BotConfig, BotContextVariables, GhlWorkflow, MicroMomentsConfig, RetryConfig } from "@/types/bot-config";

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
import { ConversationFlowTab } from "./conversation-flow-tab";

type TabId = "prompt" | "context" | "persona" | "products" | "social-proof" | "ghl-workflows" | "options" | "conversation-flow";

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
  const [justSaved, setJustSaved] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("prompt");

  // Local editable state
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [contextVariables, setContextVariables] = useState<BotContextVariables>({});
  const [personaEngineEnabled, setPersonaEngineEnabled] = useState(false);
  const [productIntelligenceEnabled, setProductIntelligenceEnabled] = useState(false);
  const [socialProofEnabled, setSocialProofEnabled] = useState(false);
  const [socialProofMinTurn, setSocialProofMinTurn] = useState(0);
  const [preResearchEnabled, setPreResearchEnabled] = useState(false);
  const [memoryRecallEnabled, setMemoryRecallEnabled] = useState(false);
  const [maxCallDuration, setMaxCallDuration] = useState(480);
  const [ghlWorkflows, setGhlWorkflows] = useState<GhlWorkflow[]>([]);
  const [voice, setVoice] = useState("");
  const [callProvider, setCallProvider] = useState("plivo");
  const [pipelineMode, setPipelineMode] = useState("live_api");
  const [language, setLanguage] = useState("");
  const [ttsProvider, setTtsProvider] = useState("");
  const [conversationFlowMermaid, setConversationFlowMermaid] = useState("");
  const [microMomentsConfig, setMicroMomentsConfig] = useState<MicroMomentsConfig | null>(null);
  const [retryConfig, setRetryConfig] = useState<RetryConfig | null>(null);
  const hasLoadedRef = useRef(false);

  const populateConfig = useCallback((found: BotConfig) => {
    setConfig(found);
    setName(found.name);
    setPrompt(found.prompt);
    setContextVariables(found.contextVariables || {});
    setPersonaEngineEnabled(found.personaEngineEnabled || false);
    setProductIntelligenceEnabled(found.productIntelligenceEnabled || false);
    setSocialProofEnabled(found.socialProofEnabled || false);
    setSocialProofMinTurn(found.socialProofMinTurn ?? 0);
    setPreResearchEnabled(found.preResearchEnabled || false);
    setMemoryRecallEnabled(found.memoryRecallEnabled || false);
    setMaxCallDuration(found.maxCallDuration ?? 480);
    setGhlWorkflows(found.ghlWorkflows || []);
    setVoice(found.voice || "");
    setCallProvider(found.callProvider || "plivo");
    setPipelineMode(found.pipelineMode || "live_api");
    setLanguage(found.language || "");
    setTtsProvider(found.ttsProvider || "");
    setConversationFlowMermaid(found.conversationFlowMermaid || "");
    setMicroMomentsConfig(found.microMomentsConfig || null);
    setRetryConfig(found.retryConfig || null);
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

  async function saveConfig() {
    if (!user || !config) return;
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
        socialProofMinTurn,
        preResearchEnabled,
        memoryRecallEnabled,
        maxCallDuration,
        ghlWorkflows,
        voice,
        callProvider,
        pipelineMode,
        language,
        ttsProvider,
        conversationFlowMermaid,
        microMomentsConfig,
        retryConfig,
      },
    });
    refreshProfile();
  }

  async function handleSave() {
    if (!user || !config) return;
    try {
      setSaving(true);
      await saveConfig();
      toast.success("Configuration saved successfully");
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch {
      toast.error("Failed to save configuration");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveQuiet() {
    if (!user || !config) return;
    try {
      await saveConfig();
    } catch {
      toast.error("Failed to save configuration");
      throw new Error("save failed");
    }
  }

  // After prompt optimization is applied, auto-generate the conversation flowchart
  async function handlePromptOptimized(optimizedPrompt: string) {
    if (!user || !optimizedPrompt?.trim()) return;
    try {
      toast.info("Generating conversation flowchart...");
      const idToken = await user.getIdToken();
      const res = await fetch("/api/data/generate-flow", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ systemPrompt: optimizedPrompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate flow");
      setConversationFlowMermaid(data.mermaidCode);
      toast.success("Conversation flowchart generated!");
    } catch (err) {
      console.error("[auto-generate-flow]", err);
      toast.error("Flowchart generation failed — you can generate it manually in the Conversation Flow tab.");
    }
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: "prompt", label: "Prompt" },
    { id: "context", label: "Variables" },
    { id: "persona", label: "Persona" },
    { id: "products", label: "Products" },
    { id: "social-proof", label: "Social Proof" },
    { id: "ghl-workflows", label: "CRM Workflows" },
    { id: "conversation-flow", label: "Conversation Flow" },
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
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => router.push("/bot-config")}>
            <ArrowLeft className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-2xl font-bold border-none shadow-none px-0 h-auto focus-visible:ring-0 w-full"
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
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              if (!config || !user) return;
              try {
                const data = await apiBotConfigs(user, "POST", { action: "export", configId });
                const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                downloadJson(data, `${slug || "bot-config"}.json`);
                toast.success("Config exported (includes personas, products, social proof)");
              } catch {
                toast.error("Failed to export config");
              }
            }}
          >
            <Download className="size-4" />
            Export JSON
          </Button>
          <Button onClick={handleSave} disabled={saving || justSaved}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : justSaved ? (
              <Check className="size-4" />
            ) : (
              <Save className="size-4" />
            )}
            {saving ? "Saving..." : justSaved ? "Saved" : "Save Changes"}
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
          <PromptTab prompt={prompt} onPromptChange={setPrompt} onPromptOptimized={handlePromptOptimized} user={user} />
        )}
        {activeTab === "context" && (
          <ContextTab
            contextVariables={contextVariables}
            onContextChange={setContextVariables}
            voice={voice}
            onVoiceChange={setVoice}
            callProvider={callProvider}
            onCallProviderChange={setCallProvider}
            pipelineMode={pipelineMode}
            onPipelineModeChange={setPipelineMode}
            language={language}
            onLanguageChange={setLanguage}
            ttsProvider={ttsProvider}
            onTtsProviderChange={setTtsProvider}
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
            minTurn={socialProofMinTurn}
            onMinTurnChange={setSocialProofMinTurn}
          />
        )}
        {activeTab === "ghl-workflows" && (
          <GhlWorkflowsTab
            workflows={ghlWorkflows}
            onChange={setGhlWorkflows}
            onSave={handleSaveQuiet}
            saving={saving}
          />
        )}
        {activeTab === "conversation-flow" && user && (
          <ConversationFlowTab
            user={user}
            prompt={prompt}
            savedMermaidCode={conversationFlowMermaid}
            onMermaidCodeChange={setConversationFlowMermaid}
            onSave={handleSaveQuiet}
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
            microMomentsConfig={microMomentsConfig}
            onMicroMomentsConfigChange={setMicroMomentsConfig}
            retryConfig={retryConfig}
            onRetryConfigChange={setRetryConfig}
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
  onPromptOptimized,
  user,
}: {
  prompt: string;
  onPromptChange: (v: string) => void;
  onPromptOptimized?: (newPrompt: string) => void;
  user: { getIdToken: () => Promise<string> } | null;
}) {
  const [converting, setConverting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewPrompt, setPreviewPrompt] = useState("");

  const handleConvert = async () => {
    if (!prompt?.trim() || !user) return;
    setConverting(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/data/convert-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ systemPrompt: prompt }),
      });
      const data = await res.json();
      if (data.convertedPrompt) {
        setPreviewPrompt(data.convertedPrompt);
        setShowPreview(true);
        toast.success("Prompt optimized! Review and apply above.");
      } else {
        toast.error(data.error || "Conversion failed");
      }
    } catch {
      toast.error("Failed to convert prompt");
    } finally {
      setConverting(false);
    }
  };

  const applyConverted = () => {
    onPromptChange(previewPrompt);
    setShowPreview(false);
    const appliedPrompt = previewPrompt;
    setPreviewPrompt("");
    toast.success("Converted prompt applied! Remember to save.");
    onPromptOptimized?.(appliedPrompt);
  };

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
        <div className="flex items-center justify-between">
          <CardTitle>Bot System Prompt</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleConvert}
            disabled={converting || !prompt?.trim()}
          >
            {converting ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Converting...
              </>
            ) : (
              <>
                <Workflow className="size-4 mr-2" />
                Optimize Prompt
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showPreview && (
          <div className="rounded-lg border-2 border-primary/50 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Compare: Original vs Optimized</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setShowPreview(false)}>
                  <X className="size-4 mr-1" /> Dismiss
                </Button>
                <Button size="sm" onClick={applyConverted}>
                  <Check className="size-4 mr-1" /> Apply Optimized
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-xs font-medium text-muted-foreground mb-1 block">Original Prompt</span>
                <Textarea
                  value={prompt}
                  readOnly
                  rows={18}
                  className="font-mono text-sm bg-muted/30 opacity-80"
                />
              </div>
              <div>
                <span className="text-xs font-medium text-primary mb-1 block">Optimized Prompt</span>
                <Textarea
                  value={previewPrompt}
                  onChange={(e) => setPreviewPrompt(e.target.value)}
                  rows={18}
                  className="font-mono text-sm"
                />
              </div>
            </div>
          </div>
        )}

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

const LIVE_API_VOICE_OPTIONS = [
  { value: "", label: "Auto-detect from prompt" },
  { value: "Puck", label: "Puck (Male)" },
  { value: "Kore", label: "Kore (Female)" },
];

function ContextTab({
  contextVariables,
  onContextChange,
  voice,
  onVoiceChange,
  callProvider,
  onCallProviderChange,
  pipelineMode,
  onPipelineModeChange,
  language,
  onLanguageChange,
  ttsProvider,
  onTtsProviderChange,
}: {
  contextVariables: BotContextVariables;
  onContextChange: (v: BotContextVariables) => void;
  voice: string;
  onVoiceChange: (v: string) => void;
  callProvider: string;
  onCallProviderChange: (v: string) => void;
  pipelineMode: string;
  onPipelineModeChange: (v: string) => void;
  language: string;
  onLanguageChange: (v: string) => void;
  ttsProvider: string;
  onTtsProviderChange: (v: string) => void;
}) {
  const fields: { key: Exclude<keyof BotContextVariables, "customVariables" | "customVariableMappings">; label: string; placeholder: string; variable: string }[] = [
    { key: "agentName", label: "Agent Name", placeholder: "e.g. Priya", variable: "{agent_name}" },
    { key: "companyName", label: "Company Name", placeholder: "e.g. FutureWorks AI", variable: "{company_name}" },
    { key: "eventName", label: "Event Name", placeholder: "e.g. AI Masterclass", variable: "{event_name}" },
    { key: "eventHost", label: "Event Host", placeholder: "e.g. Avinash", variable: "{event_host}" },
    { key: "location", label: "Location", placeholder: "e.g. Hyderabad", variable: "{location}" },
    { key: "superCoachNames", label: "Super Coach Names", placeholder: "e.g. Anita, Meera", variable: "{super_coach_names}" },
  ];

  const customVars = contextVariables.customVariables || {};
  const customMappings = contextVariables.customVariableMappings || {};
  const customKeys = Object.keys(customVars);

  const LEAD_FIELD_OPTIONS = [
    { value: "", label: "Manual" },
    { value: "contactName", label: "Contact Name" },
    { value: "email", label: "Email" },
    { value: "company", label: "Company" },
    { value: "location", label: "Location" },
  ];

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
    const updatedVars: Record<string, string> = {};
    for (const [k, v] of Object.entries(customVars)) {
      updatedVars[k === oldKey ? cleaned : k] = v;
    }
    // Also rename in mappings
    const updatedMappings = { ...customMappings };
    if (oldKey in updatedMappings) {
      updatedMappings[cleaned] = updatedMappings[oldKey];
      delete updatedMappings[oldKey];
    }
    onContextChange({ ...contextVariables, customVariables: updatedVars, customVariableMappings: updatedMappings });
  };

  const updateCustomValue = (key: string, value: string) => {
    onContextChange({
      ...contextVariables,
      customVariables: { ...customVars, [key]: value },
    });
  };

  const updateCustomMapping = (key: string, leadField: string) => {
    const updated = { ...customMappings, [key]: leadField };
    if (!leadField) delete updated[key];
    onContextChange({ ...contextVariables, customVariableMappings: updated });
  };

  const removeCustomVar = (key: string) => {
    const updatedVars = { ...customVars };
    delete updatedVars[key];
    const updatedMappings = { ...customMappings };
    delete updatedMappings[key];
    onContextChange({ ...contextVariables, customVariables: updatedVars, customVariableMappings: updatedMappings });
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
                  Link to lead fields to auto-populate when making calls.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addCustomVar}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Variable
              </Button>
            </div>
            {customKeys.length > 0 && (
              <div className="space-y-3">
                {/* Header row */}
                <div className="grid grid-cols-[1fr_1fr_140px_28px] gap-2 text-xs text-muted-foreground font-medium px-0.5">
                  <span>Variable Name</span>
                  <span>Default Value</span>
                  <span>Lead Field</span>
                  <span />
                </div>
                {customKeys.map((key) => (
                  <div key={key} className="grid grid-cols-[1fr_1fr_140px_28px] gap-2 items-center group">
                    <div className="space-y-0.5">
                      <Input
                        value={key}
                        onChange={(e) => updateCustomKey(key, e.target.value)}
                        onBlur={(e) => updateCustomKey(key, e.target.value)}
                        className="h-8 text-sm font-mono"
                        placeholder="variable_name"
                      />
                      <span className="text-[10px] text-muted-foreground font-mono pl-1">{`{${key}}`}</span>
                    </div>
                    <Input
                      value={customVars[key]}
                      onChange={(e) => updateCustomValue(key, e.target.value)}
                      className="h-8 text-sm"
                      placeholder="Default value"
                    />
                    <select
                      value={customMappings[key] || ""}
                      onChange={(e) => updateCustomMapping(key, e.target.value)}
                      className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {LEAD_FIELD_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeCustomVar(key)}
                      className="h-8 w-7 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Voice & Provider</CardTitle>
          <p className="text-sm text-muted-foreground">
            Choose the voice pipeline, speaking voice, and telephony provider for calls made with this bot configuration.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Pipeline Mode Toggle */}
          <div className="space-y-2">
            <Label className="text-sm">Pipeline Mode</Label>
            <div className="inline-flex rounded-lg border border-input p-1 gap-1">
              {[
                { value: "live_api", label: "Live API" },
                { value: "traditional", label: "Traditional" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onPipelineModeChange(opt.value)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    pipelineMode === opt.value
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {pipelineMode === "traditional"
                ? "Traditional: separate STT + LLM + TTS pipeline. Lower latency with Google Cloud TTS."
                : "Live API: Gemini multimodal live session. Simpler, single-model approach."}
            </p>
          </div>

          {/* TTS Provider + Language (Traditional only) */}
          {pipelineMode === "traditional" && (
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm">TTS Provider</Label>
                <select
                  value={ttsProvider}
                  onChange={(e) => onTtsProviderChange(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">Default (from server config)</option>
                  {TTS_PROVIDER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Language</Label>
                <select
                  value={language}
                  onChange={(e) => onLanguageChange(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">Default (en-IN)</option>
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Voice Selection */}
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-sm">Voice</Label>
              {pipelineMode === "traditional" && (ttsProvider === "google_cloud" || !ttsProvider) ? (
                <select
                  value={voice}
                  onChange={(e) => onVoiceChange(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">Auto-detect from prompt</option>
                  <optgroup label="Female">
                    {GOOGLE_CLOUD_VOICES.female.map((v) => (
                      <option key={v.value} value={v.value}>{v.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Male">
                    {GOOGLE_CLOUD_VOICES.male.map((v) => (
                      <option key={v.value} value={v.value}>{v.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Neutral">
                    {GOOGLE_CLOUD_VOICES.neutral.map((v) => (
                      <option key={v.value} value={v.value}>{v.label}</option>
                    ))}
                  </optgroup>
                </select>
              ) : (
                <select
                  value={voice}
                  onChange={(e) => onVoiceChange(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {LIVE_API_VOICE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Call Provider</Label>
              <select
                value={callProvider}
                onChange={(e) => onCallProviderChange(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="plivo">Plivo (Domestic)</option>
                <option value="twilio">Twilio (International)</option>
              </select>
              <p className="text-xs text-muted-foreground">
                {callProvider === "twilio"
                  ? "Twilio credentials must be configured in Settings."
                  : "Plivo credentials must be configured in Settings."}
              </p>
            </div>
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
  microMomentsConfig,
  onMicroMomentsConfigChange,
  retryConfig,
  onRetryConfigChange,
}: {
  user: { getIdToken: () => Promise<string> };
  preResearchEnabled: boolean;
  onPreResearchToggle: (v: boolean) => void;
  memoryRecallEnabled: boolean;
  onMemoryRecallToggle: (v: boolean) => void;
  maxCallDuration: number;
  onMaxCallDurationChange: (v: number) => void;
  microMomentsConfig: MicroMomentsConfig | null;
  onMicroMomentsConfigChange: (v: MicroMomentsConfig | null) => void;
  retryConfig: RetryConfig | null;
  onRetryConfigChange: (v: RetryConfig | null) => void;
}) {
  const ALL_MOMENTS = ["buying_signal", "resistance", "price_shock", "interest_spike", "last_chance"] as const;
  const MOMENT_LABELS: Record<string, string> = {
    buying_signal: "Buying Signal",
    resistance: "Resistance",
    price_shock: "Price Shock",
    interest_spike: "Interest Spike",
    last_chance: "Last Chance",
  };
  const MOMENT_DESCRIPTIONS: Record<string, string> = {
    buying_signal: "Detects when customer shifts from 'why' to 'how' questions — triggers closing mode",
    resistance: "Detects declining engagement over multiple turns — triggers rapport rebuilding",
    price_shock: "Detects hesitation right after price is mentioned — triggers value reframing",
    interest_spike: "Detects sudden jump in engagement — triggers momentum riding",
    last_chance: "Detects 'I'll think about it' signals — triggers last-chance value bomb",
  };

  const mmEnabled = microMomentsConfig?.enabled ?? true;
  const disabledMoments = new Set(microMomentsConfig?.disabled_moments ?? []);

  function updateMmConfig(updates: Partial<MicroMomentsConfig>) {
    const current: MicroMomentsConfig = microMomentsConfig ?? { enabled: true };
    onMicroMomentsConfigChange({ ...current, ...updates });
  }

  function toggleMoment(moment: string) {
    const current = new Set(microMomentsConfig?.disabled_moments ?? []);
    if (current.has(moment)) {
      current.delete(moment);
    } else {
      current.add(moment);
    }
    updateMmConfig({ disabled_moments: Array.from(current) });
  }

  function updateHint(moment: string, hint: string) {
    const currentHints = { ...(microMomentsConfig?.hints ?? {}) };
    if (hint.trim()) {
      currentHints[moment] = hint;
    } else {
      delete currentHints[moment];
    }
    updateMmConfig({ hints: currentHints });
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

      {/* Per-Bot Micro-Moments Config */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Micro-Moment Detection</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Real-time behavioral detection during calls. Enable/disable individual moments and customize hints.
              </p>
            </div>
            <Switch
              checked={mmEnabled}
              onCheckedChange={(v) => updateMmConfig({ enabled: v })}
            />
          </div>
        </CardHeader>
        {mmEnabled && (
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Min Turns Before Detection</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  className="h-8 text-sm"
                  value={microMomentsConfig?.min_turns_for_detection ?? 3}
                  onChange={(e) =>
                    updateMmConfig({ min_turns_for_detection: Math.max(1, parseInt(e.target.value) || 3) })
                  }
                />
                <p className="text-[10px] text-muted-foreground">No moments detected before this many turns</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Cooldown Between Detections</Label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  className="h-8 text-sm"
                  value={microMomentsConfig?.strategy_cooldown_turns ?? 2}
                  onChange={(e) =>
                    updateMmConfig({ strategy_cooldown_turns: Math.max(1, parseInt(e.target.value) || 2) })
                  }
                />
                <p className="text-[10px] text-muted-foreground">Min turns between same moment type</p>
              </div>
            </div>

            <div className="space-y-3">
              <Label className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                Moment Types
              </Label>
              {ALL_MOMENTS.map((moment) => {
                const isEnabled = !disabledMoments.has(moment);
                return (
                  <div key={moment} className={`rounded-lg border p-3 space-y-2 ${!isEnabled ? "opacity-50" : ""}`}>
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-xs font-medium">{MOMENT_LABELS[moment]}</Label>
                        <p className="text-[10px] text-muted-foreground">{MOMENT_DESCRIPTIONS[moment]}</p>
                      </div>
                      <Switch
                        checked={isEnabled}
                        onCheckedChange={() => toggleMoment(moment)}
                      />
                    </div>
                    {isEnabled && (
                      <Textarea
                        value={microMomentsConfig?.hints?.[moment] ?? ""}
                        onChange={(e) => updateHint(moment, e.target.value)}
                        rows={2}
                        className="text-sm"
                        placeholder="Custom hint override (leave empty to use default)..."
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Call Retry Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Call Retry Settings</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Automatically retry calls that go unanswered or fail during campaigns. Configure the number of retries and delay between each.
              </p>
            </div>
            <Switch
              checked={retryConfig?.enabled ?? false}
              onCheckedChange={(v) =>
                onRetryConfigChange({ enabled: v, intervals: retryConfig?.intervals ?? [10] })
              }
            />
          </div>
        </CardHeader>
        {retryConfig?.enabled && (
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {(retryConfig.intervals ?? []).map((interval, idx) => (
                <div key={idx} className="flex items-center gap-3 rounded-lg border p-3">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">Retry {idx + 1}</span>
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-xs text-muted-foreground">after</span>
                    <Input
                      type="number"
                      min={1}
                      max={1440}
                      className="h-8 w-24 text-sm"
                      value={interval}
                      onChange={(e) => {
                        const newIntervals = [...(retryConfig.intervals ?? [])];
                        newIntervals[idx] = Math.max(1, parseInt(e.target.value) || 10);
                        onRetryConfigChange({ ...retryConfig, intervals: newIntervals });
                      }}
                    />
                    <span className="text-xs text-muted-foreground">minutes</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => {
                      const newIntervals = (retryConfig.intervals ?? []).filter((_, i) => i !== idx);
                      onRetryConfigChange({
                        ...retryConfig,
                        intervals: newIntervals.length > 0 ? newIntervals : [10],
                      });
                    }}
                    disabled={(retryConfig.intervals ?? []).length <= 1}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onRetryConfigChange({
                  ...retryConfig,
                  intervals: [...(retryConfig.intervals ?? []), 10],
                })
              }
              disabled={(retryConfig.intervals ?? []).length >= 10}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Retry
            </Button>
            <p className="text-[10px] text-muted-foreground">
              {(retryConfig.intervals ?? []).length} {(retryConfig.intervals ?? []).length === 1 ? "retry" : "retries"}:{" "}
              {(retryConfig.intervals ?? []).map((m, i) => `${m} min${i < (retryConfig.intervals ?? []).length - 1 ? " → " : ""}`).join("")}
            </p>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

/* ========== CRM Workflows Tab ========== */

const TIMING_OPTIONS: { value: GhlWorkflow["timing"]; label: string; description: string }[] = [
  { value: "pre_call", label: "Pre-Call", description: "Triggers before the call connects" },
  { value: "during_call", label: "During Call", description: "AI decides when to trigger based on conversation" },
  { value: "post_call", label: "Post-Call", description: "Triggers automatically when the call ends" },
];

function GhlWorkflowsTab({
  workflows,
  onChange,
  onSave,
  saving,
}: {
  workflows: GhlWorkflow[];
  onChange: (v: GhlWorkflow[]) => void;
  onSave: () => Promise<void>;
  saving: boolean;
}) {
  const [savingWfId, setSavingWfId] = useState<string | null>(null);
  const [savedWfId, setSavedWfId] = useState<string | null>(null);

  async function handleWfSave(wfId: string) {
    setSavingWfId(wfId);
    setSavedWfId(null);
    await onSave();
    setSavingWfId(null);
    setSavedWfId(wfId);
    setTimeout(() => setSavedWfId(null), 2000);
  }

  function addWorkflow() {
    onChange([
      ...workflows,
      {
        id: `wf_${generateId().slice(0, 8)}`,
        name: "",
        description: "",
        tag: "",
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
                CRM Workflow Triggers
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Each workflow adds a tag to the contact in your CRM. Set up CRM automations to trigger on &quot;tag added&quot;.
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
              <p className="text-xs mt-1">Add a workflow to let the AI trigger CRM automations</p>
            </div>
          ) : (
            workflows.map((wf) => (
              <div
                key={wf.id}
                className={`rounded-lg border p-4 space-y-3 transition-opacity ${wf.enabled ? "" : "opacity-50"}`}
              >
                {/* Row 1: Name, Tag, Enable toggle, Save, Delete */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Workflow Name</Label>
                      <Input
                        value={wf.name || ""}
                        onChange={(e) => updateWorkflow(wf.id, { name: e.target.value })}
                        placeholder="e.g. Send Welcome WhatsApp"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">CRM Tag</Label>
                      <Input
                        value={wf.tag || ""}
                        onChange={(e) => updateWorkflow(wf.id, { tag: e.target.value })}
                        placeholder="e.g. ai-interested"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Trigger Timing</Label>
                      <div className="flex gap-1">
                        {TIMING_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => updateWorkflow(wf.id, { timing: opt.value })}
                            className={`flex-1 rounded-md border px-2 py-1.5 text-center text-xs font-medium transition-colors ${
                              wf.timing === opt.value
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border text-muted-foreground hover:border-primary/50"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-5">
                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={wf.enabled}
                        onCheckedChange={(v) => updateWorkflow(wf.id, { enabled: v })}
                      />
                      <span className={`text-xs ${wf.enabled ? "text-green-500" : "text-muted-foreground"}`}>
                        {wf.enabled ? "On" : "Off"}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`h-7 text-xs px-2 ${savedWfId === wf.id ? "border-green-500 text-green-500" : ""}`}
                      onClick={() => handleWfSave(wf.id)}
                      disabled={savingWfId !== null || savedWfId === wf.id}
                    >
                      {savingWfId === wf.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : savedWfId === wf.id ? (
                        <Check className="size-3" />
                      ) : (
                        <Save className="size-3" />
                      )}
                      <span className="ml-1">{savingWfId === wf.id ? "Saving" : savedWfId === wf.id ? "Saved" : "Save"}</span>
                    </Button>
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

                {/* Row 2: AI Trigger Description — only for during_call */}
                {wf.timing === "during_call" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      AI Trigger Description
                      <span className="text-muted-foreground ml-1 font-normal">
                        (tells the AI when to trigger this workflow)
                      </span>
                    </Label>
                    <Textarea
                      value={wf.description || ""}
                      onChange={(e) => updateWorkflow(wf.id, { description: e.target.value })}
                      placeholder="e.g. Trigger when the customer confirms they want more information about the course."
                      rows={2}
                      className="text-sm"
                    />
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
