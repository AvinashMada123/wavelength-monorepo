"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Plus, Trash2, Loader2, Upload, FileText, X } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { KeywordConfigEditor, type KeywordCategory } from "@/components/shared/keyword-config-editor";

const ACCEPTED_TYPES = [".txt", ".pdf", ".docx"];
const ACCEPTED_MIME: Record<string, string> = {
  "text/plain": "text",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

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
  const [productKeywords, setProductKeywords] = useState<KeywordCategory[]>([]);
  const [savingConfig, setSavingConfig] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiProducts(user, "GET");
      setSections(data.sections || []);

      // Load product keyword config
      try {
        const idToken = await user.getIdToken();
        const configRes = await fetch("/api/data/keyword-config", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "getProductConfig" }),
        });
        if (configRes.ok) {
          const config = await configRes.json();
          setProductKeywords(
            Object.entries(config).map(([name, val]) => ({
              name,
              keywords: (val as { keywords?: string[] }).keywords || [],
            }))
          );
        }
      } catch {
        // Non-critical
      }
    } catch {
      toast.error("Failed to load product sections");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (orgId) loadData();
  }, [orgId, loadData]);

  function readFileAsContent(file: File): Promise<{ content: string; contentType: string }> {
    return new Promise((resolve, reject) => {
      const ext = file.name.split(".").pop()?.toLowerCase();
      const mimeType = ACCEPTED_MIME[file.type] || (ext === "txt" ? "text" : ext === "pdf" ? "pdf" : ext === "docx" ? "docx" : null);
      if (!mimeType) { reject(new Error("Unsupported file type")); return; }
      const reader = new FileReader();
      if (mimeType === "text") {
        reader.onload = () => resolve({ content: reader.result as string, contentType: "text" });
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      } else {
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          resolve({ content: base64, contentType: mimeType });
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      }
    });
  }

  async function handleUpload() {
    try {
      setUploading(true);
      let content: string;
      let contentType = "text";

      if (selectedFile) {
        const result = await readFileAsContent(selectedFile);
        content = result.content;
        contentType = result.contentType;
      } else if (uploadText.trim()) {
        content = uploadText;
      } else {
        toast.error("Please paste some text or drop a file");
        setUploading(false);
        return;
      }

      const data = await apiProducts(user, "POST", {
        action: "upload",
        text: content,
        contentType,
      });
      setSections(data.sections || []);
      setUploadText("");
      setSelectedFile(null);
      toast.success("Product content processed and sections created");
    } catch {
      toast.error("Failed to process product content");
    } finally {
      setUploading(false);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const ext = "." + (file.name.split(".").pop()?.toLowerCase() || "");
      if (ACCEPTED_TYPES.includes(ext)) {
        setSelectedFile(file);
      } else {
        toast.error("Unsupported file type. Use PDF, TXT, or DOCX.");
      }
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
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

  async function handleSaveProductConfig() {
    try {
      setSavingConfig(true);
      const config: Record<string, { keywords: string[] }> = {};
      for (const cat of productKeywords) {
        config[cat.name] = { keywords: cat.keywords };
      }
      const idToken = await user.getIdToken();
      const res = await fetch("/api/data/keyword-config", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "updateProductConfig", config }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Product detection keywords saved");
    } catch {
      toast.error("Failed to save product config");
    } finally {
      setSavingConfig(false);
    }
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
          <CardTitle className="text-base">Process Product Content with AI</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Drag-and-drop zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "rounded-lg border-2 border-dashed p-6 text-center transition-colors cursor-pointer",
              dragActive
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50"
            )}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              Drag & drop a PDF, TXT, or DOCX file here, or click to browse
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.docx"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* Selected file indicator */}
          {selectedFile && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1.5 text-xs">
                <FileText className="size-3" />
                {selectedFile.name}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                  className="ml-1 hover:text-destructive"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            </div>
          )}

          {/* Text paste area (alternative) */}
          {!selectedFile && (
            <>
              <div className="relative flex items-center">
                <div className="flex-1 border-t border-border" />
                <span className="px-3 text-xs text-muted-foreground">or paste text</span>
                <div className="flex-1 border-t border-border" />
              </div>
              <Textarea
                value={uploadText}
                onChange={(e) => setUploadText(e.target.value)}
                rows={4}
                className="text-sm"
                placeholder="Paste your product description, brochure text, or website copy here..."
              />
            </>
          )}

          <Button
            onClick={handleUpload}
            disabled={uploading || (!selectedFile && !uploadText.trim())}
          >
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

      {/* Product Detection Keywords Config */}
      {productKeywords.length > 0 && (
        <KeywordConfigEditor
          title="Product Detection Keywords"
          description="Keywords that trigger which product sections are loaded during calls"
          categories={productKeywords}
          onCategoriesChange={setProductKeywords}
          saving={savingConfig}
          onSave={handleSaveProductConfig}
        />
      )}
    </div>
  );
}
