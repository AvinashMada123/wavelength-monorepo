"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface KeywordCategory {
  name: string;
  keywords: string[];
  phrases?: string[];
  hint?: string;
}

interface KeywordConfigEditorProps {
  title: string;
  description: string;
  categories: KeywordCategory[];
  onCategoriesChange: (categories: KeywordCategory[]) => void;
  showPhrases?: boolean;
  showHints?: boolean;
  saving?: boolean;
  onSave: () => void;
}

export function KeywordConfigEditor({
  title,
  description,
  categories,
  onCategoriesChange,
  showPhrases = false,
  showHints = false,
  saving = false,
  onSave,
}: KeywordConfigEditorProps) {
  const [expanded, setExpanded] = useState(false);

  function updateCategory(index: number, updates: Partial<KeywordCategory>) {
    const updated = [...categories];
    updated[index] = { ...updated[index], ...updates };
    onCategoriesChange(updated);
  }

  return (
    <Card>
      <CardContent className="pt-0">
        <button
          type="button"
          className="flex w-full items-center justify-between py-2"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="text-left">
            <p className="font-medium text-sm">{title}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
          {expanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </button>

        {expanded && (
          <div className="space-y-4 mt-3">
            {categories.map((cat, index) => (
              <div key={cat.name || index} className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {cat.name.replace(/_/g, " ")}
                  </Label>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">Keywords (comma-separated)</Label>
                  <Input
                    value={cat.keywords.join(", ")}
                    onChange={(e) =>
                      updateCategory(index, {
                        keywords: e.target.value
                          .split(",")
                          .map((k) => k.trim())
                          .filter(Boolean),
                      })
                    }
                    className="h-8 text-sm"
                    placeholder="keyword1, keyword2, keyword3"
                  />
                </div>

                {showPhrases && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Phrases (comma-separated)</Label>
                    <Input
                      value={(cat.phrases || []).join(", ")}
                      onChange={(e) =>
                        updateCategory(index, {
                          phrases: e.target.value
                            .split(",")
                            .map((p) => p.trim())
                            .filter(Boolean),
                        })
                      }
                      className="h-8 text-sm"
                      placeholder="multi-word phrase 1, phrase 2"
                    />
                  </div>
                )}

                {showHints && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Hint (injected when detected)</Label>
                    <Textarea
                      value={cat.hint || ""}
                      onChange={(e) => updateCategory(index, { hint: e.target.value })}
                      rows={2}
                      className="text-sm"
                      placeholder="System hint text when this is detected..."
                    />
                  </div>
                )}
              </div>
            ))}

            <Button size="sm" onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Save Config
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
