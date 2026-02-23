"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Plus, Trash2, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import type { ProductSection } from "@/types/product";
import { PRODUCT_SECTION_TYPES } from "@/types/product";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

async function apiProducts(
  user: { getIdToken: () => Promise<string> },
  method: "GET" | "POST",
  body?: Record<string, unknown>
) {
  const idToken = await user.getIdToken();
  const res = await fetch("/api/data/products", {
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

interface ProductsTabProps {
  orgId: string;
  user: { getIdToken: () => Promise<string> };
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export function ProductsTab({ orgId, user, enabled, onToggle }: ProductsTabProps) {
  const [sections, setSections] = useState<ProductSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [uploadText, setUploadText] = useState("");
  const [uploading, setUploading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiProducts(user, "GET");
      setSections(data.sections || []);
    } catch {
      toast.error("Failed to load product sections");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (orgId) loadData();
  }, [orgId, loadData]);

  async function handleUpload() {
    if (!uploadText.trim()) {
      toast.error("Please paste some product text first");
      return;
    }
    try {
      setUploading(true);
      const data = await apiProducts(user, "POST", {
        action: "upload",
        text: uploadText,
      });
      setSections(data.sections || []);
      setUploadText("");
      toast.success("Product text processed and sections created");
    } catch {
      toast.error("Failed to process product text");
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveSection(section: ProductSection) {
    try {
      setSavingId(section.id);
      const existing = sections.find((s) => s.id === section.id && s.updatedAt);
      await apiProducts(user, "POST", existing
        ? { action: "updateSection", sectionId: section.id, updates: { name: section.name, content: section.content, keywords: section.keywords } }
        : { action: "createSection", section }
      );
      toast.success("Section saved");
      loadData();
    } catch {
      toast.error("Failed to save section");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDeleteSection(id: string) {
    try {
      await apiProducts(user, "POST", { action: "deleteSection", sectionId: id });
      setSections((prev) => prev.filter((s) => s.id !== id));
      toast.success("Section deleted");
    } catch {
      toast.error("Failed to delete section");
    }
  }

  function handleAddSection() {
    setSections((prev) => [
      ...prev,
      {
        id: `sec_${crypto.randomUUID().slice(0, 8)}`,
        name: "",
        content: "",
        keywords: [],
        updatedAt: "",
      },
    ]);
  }

  function updateSectionLocal(index: number, updates: Partial<ProductSection>) {
    setSections((prev) => {
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
            <p className="font-medium">Product Intelligence Engine</p>
            <p className="text-sm text-muted-foreground">
              Enable AI-powered product knowledge during calls
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={onToggle} />
        </CardContent>
      </Card>

      {/* Upload Area */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Process Product Text with AI</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={uploadText}
            onChange={(e) => setUploadText(e.target.value)}
            rows={6}
            className="text-sm"
            placeholder="Paste your product description, brochure text, or website copy here. The AI will analyze and create structured sections..."
          />
          <Button onClick={handleUpload} disabled={uploading || !uploadText.trim()}>
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {uploading ? "Processing..." : "Process with AI"}
          </Button>
        </CardContent>
      </Card>

      {/* Section Types Reference */}
      <div className="flex flex-wrap gap-1.5">
        {PRODUCT_SECTION_TYPES.map((type) => (
          <Badge key={type} variant="secondary" className="text-xs">
            {type.replace(/_/g, " ")}
          </Badge>
        ))}
      </div>

      {/* Sections */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Product Sections</h3>
        {sections.map((s, index) => (
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
                      <Label className="text-xs text-muted-foreground">Section Name</Label>
                      <Input
                        value={s.name}
                        onChange={(e) => updateSectionLocal(index, { name: e.target.value })}
                        className="h-8"
                        placeholder="e.g. Product Overview"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Content</Label>
                      <Textarea
                        value={s.content}
                        onChange={(e) => updateSectionLocal(index, { content: e.target.value })}
                        rows={4}
                        className="text-sm"
                        placeholder="Section content..."
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Keywords (comma-separated)</Label>
                      <Input
                        value={s.keywords.join(", ")}
                        onChange={(e) =>
                          updateSectionLocal(index, {
                            keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean),
                          })
                        }
                        className="h-8 text-sm"
                        placeholder="keyword1, keyword2"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 mt-5">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={() => handleSaveSection(s)}
                      disabled={savingId === s.id}
                    >
                      {savingId === s.id ? <Loader2 className="size-4 animate-spin" /> : "Save"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeleteSection(s.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
        <Button variant="outline" onClick={handleAddSection} className="w-full">
          <Plus className="size-4" />
          Add Section
        </Button>
      </div>
    </div>
  );
}
