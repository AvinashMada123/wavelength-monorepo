"use client";

import { useState, useEffect } from "react";
import { Loader2, Trash2, Save, Phone, Building2, Briefcase, User, MessageSquare, Target, Brain, Clock, Hash, Plus, X, Check } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinguisticStyleTags } from "./linguistic-style-tags";
import type { ContactMemory } from "@/types/memory";
import { formatPhoneNumber } from "@/lib/utils";

interface MemoryDetailDialogProps {
  memory: ContactMemory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (phone: string, updates: Record<string, unknown>) => Promise<void>;
  onDelete: (phone: string) => Promise<void>;
}

export function MemoryDetailDialog({
  memory,
  open,
  onOpenChange,
  onSave,
  onDelete,
}: MemoryDetailDialogProps) {
  const [form, setForm] = useState({
    name: "",
    company: "",
    role: "",
    persona: "",
    objections: [] as string[],
    interestAreas: [] as string[],
    keyFacts: [] as string[],
    lastCallSummary: "",
    lastCallOutcome: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newObjection, setNewObjection] = useState("");
  const [newInterest, setNewInterest] = useState("");
  const [newFact, setNewFact] = useState("");

  useEffect(() => {
    if (memory) {
      setForm({
        name: memory.name || "",
        company: memory.company || "",
        role: memory.role || "",
        persona: memory.persona || "",
        objections: memory.objections || [],
        interestAreas: memory.interestAreas || [],
        keyFacts: memory.keyFacts || [],
        lastCallSummary: memory.lastCallSummary || "",
        lastCallOutcome: memory.lastCallOutcome || "",
      });
      setConfirmDelete(false);
      setSaved(false);
    }
  }, [memory]);

  if (!memory) return null;

  async function handleSave() {
    if (!memory) return;
    try {
      setSaving(true);
      setSaved(false);
      await onSave(memory.phone, {
        name: form.name,
        company: form.company,
        role: form.role,
        persona: form.persona,
        objections: form.objections.join(", "),
        interest_areas: form.interestAreas.join(", "),
        key_facts: form.keyFacts.join(", "),
        last_call_summary: form.lastCallSummary,
        last_call_outcome: form.lastCallOutcome,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      toast.error("Failed to update memory");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!memory) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      setDeleting(true);
      await onDelete(memory.phone);
      toast.success("Memory deleted");
      onOpenChange(false);
    } catch {
      toast.error("Failed to delete memory");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  function addTag(field: "objections" | "interestAreas" | "keyFacts", value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setForm((f) => {
      if (f[field].includes(trimmed)) return f;
      return { ...f, [field]: [...f[field], trimmed] };
    });
  }

  function removeTag(field: "objections" | "interestAreas" | "keyFacts", index: number) {
    setForm((f) => ({
      ...f,
      [field]: f[field].filter((_, i) => i !== index),
    }));
  }

  const lastCalledFormatted = memory.lastCallDate
    ? new Date(memory.lastCallDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "--";

  const outcomeBg: Record<string, string> = {
    high: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    low: "bg-red-500/10 text-red-400 border-red-500/20",
    unknown: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        {/* Header Section */}
        <div className="p-6 pb-0">
          <DialogHeader>
            <div className="flex items-start justify-between">
              <div>
                <DialogTitle className="text-xl">
                  {memory.name || "Unknown Contact"}
                </DialogTitle>
                <DialogDescription className="flex items-center gap-1.5 mt-1">
                  <Phone className="size-3" />
                  {formatPhoneNumber(memory.phone)}
                </DialogDescription>
              </div>
              {/* Quick Stats */}
              <div className="flex items-center gap-2">
                <div className="rounded-lg border bg-muted/30 px-3 py-1.5 text-center">
                  <p className="text-lg font-bold">{memory.callCount || 0}</p>
                  <p className="text-[10px] text-muted-foreground">Calls</p>
                </div>
                <div className="rounded-lg border bg-muted/30 px-3 py-1.5 text-center">
                  <p className="text-sm font-semibold">{lastCalledFormatted}</p>
                  <p className="text-[10px] text-muted-foreground">Last Called</p>
                </div>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="px-6 pb-6 space-y-5">
          {/* Contact Info - Compact Row */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 rounded-lg border bg-muted/20">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <User className="size-3" /> Name
              </Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="h-8 text-sm"
                placeholder="Contact name"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Building2 className="size-3" /> Company
              </Label>
              <Input
                value={form.company}
                onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                className="h-8 text-sm"
                placeholder="Company name"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Briefcase className="size-3" /> Role
              </Label>
              <Input
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                className="h-8 text-sm"
                placeholder="Job role"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Brain className="size-3" /> Persona
              </Label>
              <Input
                value={form.persona}
                onChange={(e) => setForm((f) => ({ ...f, persona: e.target.value }))}
                className="h-8 text-sm"
                placeholder="e.g. Working Professional"
              />
            </div>
          </div>

          {/* Last Call Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Last Call</h3>
              {form.lastCallOutcome && (
                <Badge
                  variant="outline"
                  className={`text-xs ml-auto ${outcomeBg[form.lastCallOutcome.toLowerCase()] || outcomeBg.unknown}`}
                >
                  {form.lastCallOutcome} interest
                </Badge>
              )}
            </div>
            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Outcome</Label>
                <Input
                  value={form.lastCallOutcome}
                  onChange={(e) => setForm((f) => ({ ...f, lastCallOutcome: e.target.value }))}
                  className="h-8 text-sm"
                  placeholder="High, Medium, Low"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Summary</Label>
                <Textarea
                  value={form.lastCallSummary}
                  onChange={(e) => setForm((f) => ({ ...f, lastCallSummary: e.target.value }))}
                  rows={3}
                  className="text-sm"
                  placeholder="AI-generated call summary"
                />
              </div>
            </div>
          </div>

          {/* Tags Sections - Flexible */}
          <div className="space-y-4">
            {/* Key Facts */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Hash className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Key Facts</h3>
                <span className="text-[10px] text-muted-foreground">What we know about this contact</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {form.keyFacts.map((fact, i) => (
                  <Badge
                    key={i}
                    variant="secondary"
                    className="text-xs gap-1 pr-1 max-w-[300px]"
                  >
                    <span className="truncate">{fact}</span>
                    <button
                      type="button"
                      onClick={() => removeTag("keyFacts", i)}
                      className="ml-0.5 hover:text-destructive shrink-0"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-1.5">
                <Input
                  value={newFact}
                  onChange={(e) => setNewFact(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag("keyFacts", newFact);
                      setNewFact("");
                    }
                  }}
                  className="h-7 text-xs flex-1"
                  placeholder="Add a key fact and press Enter"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={() => { addTag("keyFacts", newFact); setNewFact(""); }}
                  disabled={!newFact.trim()}
                >
                  <Plus className="size-3" />
                </Button>
              </div>
            </div>

            {/* Interest Areas */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Target className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Interest Areas</h3>
                <span className="text-[10px] text-muted-foreground">Topics they&apos;re interested in</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {form.interestAreas.map((area, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="text-xs gap-1 pr-1 bg-blue-500/10 text-blue-400 border-blue-500/20"
                  >
                    {area}
                    <button
                      type="button"
                      onClick={() => removeTag("interestAreas", i)}
                      className="ml-0.5 hover:text-destructive"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-1.5">
                <Input
                  value={newInterest}
                  onChange={(e) => setNewInterest(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag("interestAreas", newInterest);
                      setNewInterest("");
                    }
                  }}
                  className="h-7 text-xs flex-1"
                  placeholder="Add an interest and press Enter"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={() => { addTag("interestAreas", newInterest); setNewInterest(""); }}
                  disabled={!newInterest.trim()}
                >
                  <Plus className="size-3" />
                </Button>
              </div>
            </div>

            {/* Objections */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Clock className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Objections</h3>
                <span className="text-[10px] text-muted-foreground">Concerns they&apos;ve raised</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {form.objections.map((obj, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="text-xs gap-1 pr-1 bg-amber-500/10 text-amber-400 border-amber-500/20"
                  >
                    {obj}
                    <button
                      type="button"
                      onClick={() => removeTag("objections", i)}
                      className="ml-0.5 hover:text-destructive"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-1.5">
                <Input
                  value={newObjection}
                  onChange={(e) => setNewObjection(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag("objections", newObjection);
                      setNewObjection("");
                    }
                  }}
                  className="h-7 text-xs flex-1"
                  placeholder="Add an objection and press Enter"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={() => { addTag("objections", newObjection); setNewObjection(""); }}
                  disabled={!newObjection.trim()}
                >
                  <Plus className="size-3" />
                </Button>
              </div>
            </div>
          </div>

          {/* Linguistic Style */}
          {memory.linguisticStyle && Object.keys(memory.linguisticStyle).length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Brain className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Communication Style</h3>
              </div>
              <LinguisticStyleTags style={memory.linguisticStyle} />
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              {confirmDelete ? "Confirm Delete" : "Delete Memory"}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || saved}
              className={saved ? "border-green-500 text-green-500" : ""}
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : saved ? (
                <Check className="size-3.5" />
              ) : (
                <Save className="size-3.5" />
              )}
              {saving ? "Saving..." : saved ? "Saved" : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
