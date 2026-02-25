"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Plus, Pencil, Trash2, Zap, Bot, Loader2, Upload, Download, Brain, ShoppingBag, Users, Clock, Mic } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { generateId } from "@/lib/utils";
import { RoleGuard } from "@/components/auth/role-guard";
import { DEFAULT_BOT_CONFIG } from "@/lib/default-bot-config";
import { buildTemplate, validateImportedConfig, downloadJson } from "@/lib/bot-config-io";
import type { BotConfig } from "@/types/bot-config";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function BotConfigPage() {
  return (
    <RoleGuard allowedRoles={["super_admin", "client_admin"]}>
      <BotConfigContent />
    </RoleGuard>
  );
}

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

function BotConfigContent() {
  const router = useRouter();
  const { orgId, user, initialData } = useAuth();
  const [configs, setConfigs] = useState<BotConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Use initialData from auth context for instant render
  useEffect(() => {
    if (!orgId) return;
    if (initialData?.botConfigs) {
      setConfigs(initialData.botConfigs as BotConfig[]);
      setLoading(false);
    } else {
      loadConfigs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, initialData]);

  const loadConfigs = useCallback(async () => {
    if (!orgId || !user) return;
    try {
      setLoading(true);
      const data = await apiBotConfigs(user, "GET");
      setConfigs(data.configs);
    } catch {
      toast.error("Failed to load bot configurations");
    } finally {
      setLoading(false);
    }
  }, [orgId, user]);

  async function handleDelete(configId: string) {
    if (!user) return;
    if (!confirm("Are you sure you want to delete this configuration?")) return;
    try {
      await apiBotConfigs(user, "POST", { action: "delete", configId });
      toast.success("Configuration deleted");
      loadConfigs();
    } catch {
      toast.error("Failed to delete configuration");
    }
  }

  async function handleToggleActive(configId: string) {
    if (!user) return;
    try {
      await apiBotConfigs(user, "POST", { action: "toggleActive", configId });
      toast.success("Configuration status updated");
      loadConfigs();
    } catch {
      toast.error("Failed to update configuration status");
    }
  }

  async function handleCreateNew() {
    if (!user) return;
    try {
      const id = generateId();
      const now = new Date().toISOString();
      const newConfig: BotConfig = {
        ...DEFAULT_BOT_CONFIG,
        id,
        name: `New Config ${configs.length + 1}`,
        isActive: false,
        createdAt: now,
        updatedAt: now,
        createdBy: user.uid,
      };
      await apiBotConfigs(user, "POST", { action: "create", config: newConfig });
      toast.success("New configuration created");
      router.push(`/bot-config/${id}`);
    } catch {
      toast.error("Failed to create configuration");
    }
  }

  function handleDownloadTemplate() {
    downloadJson(buildTemplate(), "bot-config-template.json");
    toast.success("Template downloaded");
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    // Reset input so the same file can be re-selected
    e.target.value = "";

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const { valid, errors, config: importedConfig } = validateImportedConfig(parsed);

      if (!valid) {
        toast.error("Invalid config file", { description: errors.join(". ") });
        return;
      }
      if (errors.length > 0) {
        // Non-blocking warnings
        toast.warning(errors.join(". "));
      }

      const id = generateId();

      // Use server-side import which handles personas, products, social proof too
      await apiBotConfigs(user, "POST", {
        action: "import",
        configId: id,
        config: {
          ...importedConfig,
          name: importedConfig.name || `Imported Config ${configs.length + 1}`,
          createdBy: user.uid,
          // Pass related data from the JSON file
          personas: parsed.personas,
          situations: parsed.situations,
          productSections: parsed.productSections,
          socialProof: parsed.socialProof,
        },
      });
      const parts = [];
      if (parsed.personas?.length) parts.push(`${parsed.personas.length} personas`);
      if (parsed.situations?.length) parts.push(`${parsed.situations.length} situations`);
      if (parsed.productSections?.length) parts.push(`${parsed.productSections.length} product sections`);
      toast.success("Config imported successfully", {
        description: parts.length ? `Includes ${parts.join(", ")}` : undefined,
      });
      router.push(`/bot-config/${id}`);
    } catch {
      toast.error("Failed to import config", { description: "Make sure the file is valid JSON" });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bot Configurations</h1>
          <p className="text-muted-foreground">
            Manage AI bot prompts, personas, and call behavior
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
            <Download className="size-4" />
            Template
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="size-4" />
            Import
          </Button>
          <Button onClick={handleCreateNew}>
            <Plus className="size-4" />
            Create New Config
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleImportFile}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      ) : configs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Bot className="size-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-muted-foreground">
              No configurations yet
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first bot configuration to get started
            </p>
            <Button onClick={handleCreateNew}>
              <Plus className="size-4" />
              Create New Config
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ConfigGrid
          configs={configs}
          onEdit={(id) => router.push(`/bot-config/${id}`)}
          onToggleActive={handleToggleActive}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

function ConfigCard({
  config,
  index,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  config: BotConfig;
  index: number;
  onEdit: (id: string) => void;
  onToggleActive: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const features = [
    config.personaEngineEnabled && { icon: Brain, label: "Personas" },
    config.productIntelligenceEnabled && { icon: ShoppingBag, label: "Products" },
    config.socialProofEnabled && { icon: Users, label: "Social Proof" },
    config.memoryRecallEnabled && { icon: Brain, label: "Memory" },
  ].filter(Boolean) as { icon: typeof Brain; label: string }[];

  const voiceLabel = config.voice || "Default";
  const maxMin = config.maxCallDuration ? Math.round(config.maxCallDuration / 60) : 8;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card className={`h-full transition-colors ${config.isActive ? "border-emerald-500/30" : ""}`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Bot className="size-5 text-muted-foreground shrink-0" />
              <CardTitle className="text-base truncate">{config.name}</CardTitle>
            </div>
            {config.isActive && (
              <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/20 shrink-0">
                Active
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Feature badges */}
          <div className="flex flex-wrap gap-1.5">
            {features.length > 0 ? (
              features.map(({ icon: Icon, label }) => (
                <Badge key={label} variant="secondary" className="text-[10px] gap-1 h-5">
                  <Icon className="size-3" />
                  {label}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">No features enabled</span>
            )}
          </div>

          {/* Meta info row */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Mic className="size-3" />
              {voiceLabel}
            </div>
            <div className="flex items-center gap-1">
              <Clock className="size-3" />
              {maxMin}m max
            </div>
            <div className="ml-auto">
              {new Date(config.updatedAt || config.createdAt).toLocaleDateString()}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(config.id)}
            >
              <Pencil className="size-3.5" />
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onToggleActive(config.id)}
            >
              <Zap className="size-3.5" />
              {config.isActive ? "Deactivate" : "Activate"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(config.id)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ConfigGrid({
  configs,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  configs: BotConfig[];
  onEdit: (id: string) => void;
  onToggleActive: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const active = configs.filter((c) => c.isActive);
  const inactive = configs.filter((c) => !c.isActive);

  return (
    <div className="space-y-6">
      {/* Active configs */}
      {active.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Active
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {active.map((config, i) => (
              <ConfigCard
                key={config.id}
                config={config}
                index={i}
                onEdit={onEdit}
                onToggleActive={onToggleActive}
                onDelete={onDelete}
              />
            ))}
          </div>
        </div>
      )}

      {/* Divider */}
      {active.length > 0 && inactive.length > 0 && (
        <div className="border-t" />
      )}

      {/* Inactive configs */}
      {inactive.length > 0 && (
        <div className="space-y-3">
          {active.length > 0 && (
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Inactive
            </h2>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {inactive.map((config, i) => (
              <ConfigCard
                key={config.id}
                config={config}
                index={i + active.length}
                onEdit={onEdit}
                onToggleActive={onToggleActive}
                onDelete={onDelete}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
