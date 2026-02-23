"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Plus, Pencil, Trash2, Zap, Bot, Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { RoleGuard } from "@/components/auth/role-guard";
import { DEFAULT_BOT_CONFIG } from "@/lib/default-bot-config";
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

  async function handleSetActive(configId: string) {
    if (!user) return;
    try {
      await apiBotConfigs(user, "POST", { action: "setActive", configId });
      toast.success("Active configuration updated");
      loadConfigs();
    } catch {
      toast.error("Failed to set active configuration");
    }
  }

  async function handleCreateNew() {
    if (!user) return;
    try {
      const id = crypto.randomUUID();
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bot Configurations</h1>
          <p className="text-muted-foreground">
            Manage AI bot prompts, questions, and objection handling
          </p>
        </div>
        <Button onClick={handleCreateNew}>
          <Plus className="size-4" />
          Create New Config
        </Button>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {configs.map((config, index) => (
            <motion.div
              key={config.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Card className="h-full">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Bot className="size-5 text-muted-foreground" />
                      <CardTitle className="text-base">{config.name}</CardTitle>
                    </div>
                    {config.isActive && (
                      <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/20">
                        Active
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <MessageSquare className="size-3.5" />
                      {config.questions?.length ?? 0} questions
                    </div>
                    <div>
                      {new Date(config.createdAt).toLocaleDateString()}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.push(`/bot-config/${config.id}`)}
                    >
                      <Pencil className="size-3.5" />
                      Edit
                    </Button>
                    {!config.isActive && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSetActive(config.id)}
                      >
                        <Zap className="size-3.5" />
                        Set Active
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(config.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
