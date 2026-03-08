"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Loader2, Upload, RefreshCw, FileText, ChevronDown, ChevronUp, Save, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import Papa from "papaparse";
import * as XLSX from "xlsx";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ConversationFlowTab({
  user,
  prompt,
  savedMermaidCode,
  onMermaidCodeChange,
  onSave,
}: {
  user: { getIdToken: () => Promise<string> };
  prompt: string;
  savedMermaidCode: string;
  onMermaidCodeChange: (v: string) => void;
  onSave: () => Promise<void>;
}) {
  const [mermaidCode, setMermaidCode] = useState(savedMermaidCode || "");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [zoom, setZoom] = useState(100);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInnerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const renderCountRef = useRef(0);

  const handleZoomIn = () => setZoom((z) => Math.min(z + 25, 200));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 25, 25));
  const handleZoomReset = () => setZoom(100);

  const renderMermaid = useCallback(async (code: string) => {
    if (!chartInnerRef.current || !code) return;
    try {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "loose",
        flowchart: {
          useMaxWidth: false,
          htmlLabels: true,
          curve: "basis",
          nodeSpacing: 30,
          rankSpacing: 40,
        },
        themeVariables: {
          primaryColor: "#6366f1",
          primaryTextColor: "#e2e8f0",
          primaryBorderColor: "#818cf8",
          lineColor: "#94a3b8",
          secondaryColor: "#1e293b",
          tertiaryColor: "#0f172a",
          background: "transparent",
          mainBkg: "#1e293b",
          nodeBorder: "#818cf8",
          clusterBkg: "#0f172a",
          clusterBorder: "#334155",
          titleColor: "#e2e8f0",
          fontSize: "14px",
        },
      });

      chartInnerRef.current.innerHTML = "";
      const container = document.createElement("div");
      chartInnerRef.current.appendChild(container);

      // Client-side sanitize: fix Mermaid syntax issues
      const sanitized = code
        .split("\n")
        .flatMap((line) => {
          // Escape special characters inside node labels [...] that break Mermaid
          line = line.replace(/\[([^\]]+)\]/g, (_match, label: string) => {
            let clean = label
              .replace(/\bend\b/gi, "End")  // Reserved word
              .replace(/[()]/g, " ")         // Parentheses break syntax
              .replace(/[#&;]/g, " ")        // Special chars
              .replace(/"/g, "'")            // Double quotes
              .replace(/\s{2,}/g, " ")       // Collapse whitespace
              .trim();
            return `[${clean}]`;
          });
          // Escape inside decision node labels {...}
          line = line.replace(/\{([^}]+)\}/g, (_match, label: string) => {
            let clean = label
              .replace(/\bend\b/gi, "End")
              .replace(/[()]/g, " ")
              .replace(/[#&;]/g, " ")
              .replace(/"/g, "'")
              .replace(/\s{2,}/g, " ")
              .trim();
            return `{${clean}}`;
          });
          // Escape inside edge labels |...|
          line = line.replace(/\|([^|]+)\|/g, (_match, label: string) => {
            return `|${label.replace(/[()#&;"]/g, " ").trim()}|`;
          });
          // Split trailing "end" keyword onto its own line
          const m = line.match(/^(.+\S)\s+end\s*$/);
          if (m && !line.trim().startsWith("subgraph") && !line.trim().startsWith("%%")) {
            return [m[1], "    end"];
          }
          return [line];
        })
        .join("\n");

      renderCountRef.current += 1;
      const id = `flow-chart-${renderCountRef.current}-${Date.now()}`;
      const { svg } = await mermaid.render(id, sanitized);
      container.innerHTML = svg;
    } catch (err) {
      console.error("[mermaid] Render error:", err);
      if (chartInnerRef.current) {
        chartInnerRef.current.innerHTML = `<p class="text-sm text-destructive">Failed to render flowchart. Click "Show Mermaid Source" below to inspect the generated code.</p>
          <pre class="mt-2 text-xs text-muted-foreground bg-muted/50 p-2 rounded overflow-x-auto max-h-32 overflow-y-auto">${String(err).slice(0, 500)}</pre>`;
      }
      setShowSource(true);
    }
  }, []);

  useEffect(() => {
    if (mermaidCode) {
      renderMermaid(mermaidCode);
    }
  }, [mermaidCode, renderMermaid]);

  // Load saved code on mount
  useEffect(() => {
    if (savedMermaidCode && !mermaidCode) {
      setMermaidCode(savedMermaidCode);
    }
  }, [savedMermaidCode, mermaidCode]);

  async function handleGenerate() {
    if (!prompt?.trim()) {
      setError("No system prompt found. Add a prompt in the Prompt tab first.");
      return;
    }
    setGenerating(true);
    setError("");
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/data/generate-flow", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemPrompt: prompt,
          fileContent: fileContent || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate");
      setMermaidCode(data.mermaidCode);
      onMermaidCodeChange(data.mermaidCode);
      setZoom(100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate flow");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveFlow() {
    setSaving(true);
    try {
      onMermaidCodeChange(mermaidCode);
      await new Promise((r) => setTimeout(r, 50));
      await onSave();
      toast.success("Conversation flow saved");
    } catch {
      toast.error("Failed to save flow");
    } finally {
      setSaving(false);
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    setFileName(file.name);

    if (ext === "csv") {
      Papa.parse(file, {
        complete: (results) => {
          const text = (results.data as string[][])
            .map((row) => row.join(", "))
            .join("\n");
          setFileContent(text.slice(0, 10000));
        },
        error: () => setError("Failed to parse CSV file"),
      });
    } else if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const wb = XLSX.read(evt.target?.result, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const text = XLSX.utils.sheet_to_csv(ws);
          setFileContent(text.slice(0, 10000));
        } catch {
          setError("Failed to parse Excel file");
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (evt) => {
        setFileContent((evt.target?.result as string)?.slice(0, 10000) || "");
      };
      reader.readAsText(file);
    }

    e.target.value = "";
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Conversation Flow</CardTitle>
          <p className="text-sm text-muted-foreground">
            Generate an AI-powered visualization of your bot&apos;s conversation flow from its system prompt.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleGenerate} disabled={generating}>
              {generating ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : mermaidCode ? (
                <RefreshCw className="size-4 mr-2" />
              ) : null}
              {mermaidCode ? "Regenerate Flow" : "Generate Flow"}
            </Button>

            {mermaidCode && (
              <Button variant="outline" onClick={handleSaveFlow} disabled={saving}>
                {saving ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Save className="size-4 mr-2" />
                )}
                Save Flow
              </Button>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,.txt"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-4 mr-2" />
              Upload File
            </Button>

            {fileName && (
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <FileText className="size-3.5" />
                {fileName}
                <button
                  type="button"
                  onClick={() => { setFileName(""); setFileContent(""); }}
                  className="text-xs hover:text-destructive ml-1"
                >
                  remove
                </button>
              </span>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </CardContent>
      </Card>

      {mermaidCode && (
        <Card>
          <CardContent className="pt-6">
            {/* Zoom controls */}
            <div className="flex items-center gap-2 mb-3">
              <Button variant="outline" size="sm" onClick={handleZoomOut} disabled={zoom <= 25}>
                <ZoomOut className="size-4" />
              </Button>
              <span className="text-xs text-muted-foreground w-12 text-center font-mono">{zoom}%</span>
              <Button variant="outline" size="sm" onClick={handleZoomIn} disabled={zoom >= 200}>
                <ZoomIn className="size-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={handleZoomReset}>
                <Maximize2 className="size-4 mr-1" />
                <span className="text-xs">Fit</span>
              </Button>
            </div>

            {/* Chart container with scroll and zoom */}
            <div
              ref={chartRef}
              className="overflow-auto max-h-[75vh] border border-border/50 rounded-lg bg-background/50"
            >
              <div
                ref={chartInnerRef}
                className="p-4 origin-top-left transition-transform duration-200"
                style={{
                  transform: `scale(${zoom / 100})`,
                  transformOrigin: "top center",
                  minWidth: zoom > 100 ? `${zoom}%` : undefined,
                }}
              />
            </div>

            <div className="mt-4 border-t pt-3">
              <button
                type="button"
                onClick={() => setShowSource(!showSource)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showSource ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                {showSource ? "Hide" : "Show"} Mermaid Source
              </button>
              {showSource && (
                <pre className="mt-2 rounded-md bg-muted/50 p-3 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto">
                  {mermaidCode}
                </pre>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
