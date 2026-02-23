"use client";

import { useState, useEffect } from "react";
import { Loader2, Trash2, Save } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
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
    objections: "",
    interestAreas: "",
    keyFacts: "",
    lastCallSummary: "",
    lastCallOutcome: "",
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (memory) {
      setForm({
        name: memory.name || "",
        company: memory.company || "",
        role: memory.role || "",
        persona: memory.persona || "",
        objections: (memory.objections || []).join(", "),
        interestAreas: (memory.interestAreas || []).join(", "),
        keyFacts: (memory.keyFacts || []).join(", "),
        lastCallSummary: memory.lastCallSummary || "",
        lastCallOutcome: memory.lastCallOutcome || "",
      });
      setConfirmDelete(false);
    }
  }, [memory]);

  if (!memory) return null;

  async function handleSave() {
    if (!memory) return;
    try {
      setSaving(true);
      await onSave(memory.phone, {
        name: form.name,
        company: form.company,
        role: form.role,
        persona: form.persona,
        objections: form.objections,
        interest_areas: form.interestAreas,
        key_facts: form.keyFacts,
        last_call_summary: form.lastCallSummary,
        last_call_outcome: form.lastCallOutcome,
      });
      toast.success("Memory updated");
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{memory.name || "Unknown Contact"}</DialogTitle>
          <DialogDescription>{formatPhoneNumber(memory.phone)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Read-only info */}
          <div className="flex flex-wrap gap-3">
            <div className="rounded-lg border bg-muted/30 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Calls</p>
              <p className="text-sm font-semibold">{memory.callCount || 0}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Last Called</p>
              <p className="text-sm font-semibold">
                {memory.lastCallDate
                  ? new Date(memory.lastCallDate).toLocaleDateString()
                  : "--"}
              </p>
            </div>
            {memory.allCallUuids && memory.allCallUuids.length > 0 && (
              <div className="rounded-lg border bg-muted/30 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Call UUIDs</p>
                <p className="text-xs text-muted-foreground">{memory.allCallUuids.length} calls</p>
              </div>
            )}
          </div>

          {/* Linguistic Style - read only */}
          <div>
            <Label className="text-xs text-muted-foreground">Linguistic Style</Label>
            <div className="mt-1">
              <LinguisticStyleTags style={memory.linguisticStyle} />
            </div>
          </div>

          <Separator />

          {/* Editable fields */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Company</Label>
              <Input
                value={form.company}
                onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Input
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Persona</Label>
              <Input
                value={form.persona}
                onChange={(e) => setForm((f) => ({ ...f, persona: e.target.value }))}
                className="h-8 text-sm"
                placeholder="e.g. working_professional"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Objections (comma-separated)</Label>
            <Input
              value={form.objections}
              onChange={(e) => setForm((f) => ({ ...f, objections: e.target.value }))}
              className="h-8 text-sm"
              placeholder="price_concern, time_constraint"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Interest Areas (comma-separated)</Label>
            <Input
              value={form.interestAreas}
              onChange={(e) => setForm((f) => ({ ...f, interestAreas: e.target.value }))}
              className="h-8 text-sm"
              placeholder="AI tools, prompt engineering"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Key Facts (comma-separated)</Label>
            <Input
              value={form.keyFacts}
              onChange={(e) => setForm((f) => ({ ...f, keyFacts: e.target.value }))}
              className="h-8 text-sm"
              placeholder="2 years at company, interested in Gold plan"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Last Call Outcome</Label>
            <Input
              value={form.lastCallOutcome}
              onChange={(e) => setForm((f) => ({ ...f, lastCallOutcome: e.target.value }))}
              className="h-8 text-sm"
              placeholder="warm, interested, not_interested"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Last Call Summary</Label>
            <Textarea
              value={form.lastCallSummary}
              onChange={(e) => setForm((f) => ({ ...f, lastCallSummary: e.target.value }))}
              rows={3}
              className="text-sm"
            />
          </div>

          <Separator />

          {/* Actions */}
          <div className="flex items-center justify-between">
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
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Save Changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
