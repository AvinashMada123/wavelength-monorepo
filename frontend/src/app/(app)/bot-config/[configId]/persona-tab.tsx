"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { Persona, Situation } from "@/types/persona";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

async function apiPersonas(
  user: { getIdToken: () => Promise<string> },
  method: "GET" | "POST",
  body?: Record<string, unknown>
) {
  const idToken = await user.getIdToken();
  const res = await fetch("/api/data/personas", {
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

interface PersonaTabProps {
  orgId: string;
  user: { getIdToken: () => Promise<string> };
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export function PersonaTab({ orgId, user, enabled, onToggle }: PersonaTabProps) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [situations, setSituations] = useState<Situation[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiPersonas(user, "GET");
      setPersonas(data.personas || []);
      setSituations(data.situations || []);
    } catch {
      toast.error("Failed to load persona data");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (orgId) loadData();
  }, [orgId, loadData]);

  async function handleSavePersona(persona: Persona) {
    try {
      setSavingId(persona.id);
      const existing = personas.find((p) => p.id === persona.id && p.updatedAt);
      await apiPersonas(user, "POST", existing
        ? { action: "updatePersona", personaId: persona.id, updates: { name: persona.name, content: persona.content, keywords: persona.keywords, phrases: persona.phrases } }
        : { action: "createPersona", persona }
      );
      toast.success("Persona saved");
      loadData();
    } catch {
      toast.error("Failed to save persona");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDeletePersona(id: string) {
    try {
      await apiPersonas(user, "POST", { action: "deletePersona", personaId: id });
      setPersonas((prev) => prev.filter((p) => p.id !== id));
      toast.success("Persona deleted");
    } catch {
      toast.error("Failed to delete persona");
    }
  }

  async function handleSaveSituation(situation: Situation) {
    try {
      setSavingId(situation.id);
      const existing = situations.find((s) => s.id === situation.id && s.updatedAt);
      await apiPersonas(user, "POST", existing
        ? { action: "updateSituation", situationId: situation.id, updates: { name: situation.name, content: situation.content, keywords: situation.keywords, hint: situation.hint } }
        : { action: "createSituation", situation }
      );
      toast.success("Situation saved");
      loadData();
    } catch {
      toast.error("Failed to save situation");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDeleteSituation(id: string) {
    try {
      await apiPersonas(user, "POST", { action: "deleteSituation", situationId: id });
      setSituations((prev) => prev.filter((s) => s.id !== id));
      toast.success("Situation deleted");
    } catch {
      toast.error("Failed to delete situation");
    }
  }

  function handleAddPersona() {
    setPersonas((prev) => [
      ...prev,
      {
        id: `persona_${crypto.randomUUID().slice(0, 8)}`,
        name: "",
        content: "",
        keywords: [],
        phrases: [],
        updatedAt: "",
      },
    ]);
  }

  function handleAddSituation() {
    setSituations((prev) => [
      ...prev,
      {
        id: `sit_${crypto.randomUUID().slice(0, 8)}`,
        name: "",
        content: "",
        keywords: [],
        hint: "",
        updatedAt: "",
      },
    ]);
  }

  function updatePersonaLocal(index: number, updates: Partial<Persona>) {
    setPersonas((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...updates };
      return updated;
    });
  }

  function updateSituationLocal(index: number, updates: Partial<Situation>) {
    setSituations((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...updates };
      return updated;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toggle */}
      <Card>
        <CardContent className="flex items-center justify-between pt-0">
          <div>
            <p className="font-medium">Persona Detection Engine</p>
            <p className="text-sm text-muted-foreground">
              Enable AI-powered persona detection during calls
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={onToggle} />
        </CardContent>
      </Card>

      {/* Personas */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Personas</h3>
        {personas.map((p, index) => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.02 }}
          >
            <Card>
              <CardContent className="space-y-3 pt-0">
                <div className="flex items-start gap-3">
                  <div className="flex-1 space-y-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">Name</Label>
                      <Input
                        value={p.name}
                        onChange={(e) => updatePersonaLocal(index, { name: e.target.value })}
                        className="h-8"
                        placeholder="e.g. Working Professional"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Content</Label>
                      <Textarea
                        value={p.content}
                        onChange={(e) => updatePersonaLocal(index, { content: e.target.value })}
                        rows={3}
                        className="text-sm"
                        placeholder="Persona description and behavior guidelines..."
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Keywords (comma-separated)</Label>
                      <Input
                        value={p.keywords.join(", ")}
                        onChange={(e) =>
                          updatePersonaLocal(index, {
                            keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean),
                          })
                        }
                        className="h-8 text-sm"
                        placeholder="keyword1, keyword2"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Phrases (comma-separated)</Label>
                      <Input
                        value={p.phrases.join(", ")}
                        onChange={(e) =>
                          updatePersonaLocal(index, {
                            phrases: e.target.value.split(",").map((k) => k.trim()).filter(Boolean),
                          })
                        }
                        className="h-8 text-sm"
                        placeholder="phrase1, phrase2"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 mt-5">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={() => handleSavePersona(p)}
                      disabled={savingId === p.id}
                    >
                      {savingId === p.id ? <Loader2 className="size-4 animate-spin" /> : "Save"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeletePersona(p.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
        <Button variant="outline" onClick={handleAddPersona} className="w-full">
          <Plus className="size-4" />
          Add Persona
        </Button>
      </div>

      {/* Situations */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Situations</h3>
        {situations.map((s, index) => (
          <motion.div
            key={s.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.02 }}
          >
            <Card>
              <CardContent className="space-y-3 pt-0">
                <div className="flex items-start gap-3">
                  <div className="flex-1 space-y-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">Name</Label>
                      <Input
                        value={s.name}
                        onChange={(e) => updateSituationLocal(index, { name: e.target.value })}
                        className="h-8"
                        placeholder="e.g. Budget Concern"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Content</Label>
                      <Textarea
                        value={s.content}
                        onChange={(e) => updateSituationLocal(index, { content: e.target.value })}
                        rows={3}
                        className="text-sm"
                        placeholder="Situation description and handling guidelines..."
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Keywords (comma-separated)</Label>
                      <Input
                        value={s.keywords.join(", ")}
                        onChange={(e) =>
                          updateSituationLocal(index, {
                            keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean),
                          })
                        }
                        className="h-8 text-sm"
                        placeholder="keyword1, keyword2"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Hint</Label>
                      <Input
                        value={s.hint}
                        onChange={(e) => updateSituationLocal(index, { hint: e.target.value })}
                        className="h-8 text-sm"
                        placeholder="Short hint for the AI agent"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 mt-5">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={() => handleSaveSituation(s)}
                      disabled={savingId === s.id}
                    >
                      {savingId === s.id ? <Loader2 className="size-4 animate-spin" /> : "Save"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeleteSituation(s.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
        <Button variant="outline" onClick={handleAddSituation} className="w-full">
          <Plus className="size-4" />
          Add Situation
        </Button>
      </div>
    </div>
  );
}
