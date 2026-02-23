"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Clock,
  MessageSquare,
  FileText,
  Gauge,
  AlertTriangle,
  Activity,
  Zap,
  Timer,
  Target,
  Brain,
  CheckCircle,
  HelpCircle,
} from "lucide-react";
import type { CallRecord } from "@/types/call";
import { CallStatusBadge } from "@/components/shared/status-badge";
import { QualificationBadge } from "@/components/shared/qualification-badge";
import { formatPhoneNumber, formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface CallDetailModalProps {
  call: CallRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function InterestBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    High: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    Medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    Low: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  return (
    <Badge variant="outline" className={cn("text-xs font-medium", colors[level] || colors.Medium)}>
      {level} Interest
    </Badge>
  );
}

function MetricCard({ label, value, unit, icon: Icon }: { label: string; value: string | number; unit?: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold">
          {value}{unit && <span className="text-xs text-muted-foreground ml-0.5">{unit}</span>}
        </p>
      </div>
    </div>
  );
}

type Tab = "summary" | "transcript" | "metrics" | "qualification" | "intelligence";

export function CallDetailModal({ call, open, onOpenChange }: CallDetailModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("summary");

  if (!call) return null;

  const data = call.endedData || null;
  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "summary", label: "Summary", icon: FileText },
    { id: "qualification", label: "Qualification", icon: Target },
    { id: "intelligence", label: "Intelligence", icon: Brain },
    { id: "transcript", label: "Transcript", icon: MessageSquare },
    { id: "metrics", label: "Metrics", icon: Gauge },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="text-xl truncate">{call.request.contactName}</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground mt-1">
                {formatPhoneNumber(call.request.phoneNumber)}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
              {data?.qualification && (
                <QualificationBadge
                  level={data.qualification.level}
                  confidence={data.qualification.confidence}
                />
              )}
              {data && <InterestBadge level={data.interest_level} />}
              <CallStatusBadge status={call.status} />
            </div>
          </div>

          {data && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3 mt-4"
            >
              <div className="grid grid-cols-3 gap-3">
                <MetricCard icon={Clock} label="Duration" value={data.duration_seconds || 0} unit="s" />
                <MetricCard icon={Activity} label="Completion" value={`${Math.round((typeof data.completion_rate === 'number' ? (data.completion_rate > 1 ? data.completion_rate : data.completion_rate * 100) : 0))}%`} />
                <MetricCard icon={MessageSquare} label="Questions" value={`${data.questions_completed || 0}/${data.total_questions || 0}`} />
              </div>
              {call.status === "completed" && call.callUuid && (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-2">Recording</p>
                  <audio
                    controls
                    className="w-full h-8"
                    src={`/api/calls/${call.callUuid}/recording`}
                    preload="none"
                  />
                </div>
              )}
            </motion.div>
          )}
        </DialogHeader>

        {data ? (
          <>
            <div className="flex border-b px-6 overflow-x-auto shrink-0">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap",
                    activeTab === tab.id
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <tab.icon className="h-3.5 w-3.5" />
                  {tab.label}
                  {activeTab === tab.id && (
                    <motion.div
                      layoutId="call-detail-tab"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                    />
                  )}
                </button>
              ))}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                  className="p-6"
                >
                  {/* ── SUMMARY TAB ── */}
                  {activeTab === "summary" && (
                    <div className="space-y-5">
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Call Summary</h4>
                        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                          {data.call_summary || "No summary available for this call."}
                        </p>
                      </div>

                      {/* AI Intelligence highlights */}
                      {(data.triggered_persona || (data.triggered_product_sections && data.triggered_product_sections.length > 0) || data.social_proof_used) && (
                        <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-4 space-y-3">
                          <h4 className="text-sm font-semibold flex items-center gap-1.5">
                            <Brain className="h-3.5 w-3.5 text-violet-400" />
                            AI Intelligence
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="rounded-md border bg-background/60 p-3">
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Persona</p>
                              {data.triggered_persona && typeof data.triggered_persona === 'string' ? (
                                <Badge className="bg-purple-500/15 text-purple-400 border-purple-500/20 text-xs">
                                  {data.triggered_persona.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">Not detected</span>
                              )}
                            </div>
                            <div className="rounded-md border bg-background/60 p-3">
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Products Triggered</p>
                              {data.triggered_product_sections && data.triggered_product_sections.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {data.triggered_product_sections.map((s, i) => (
                                    <Badge key={i} variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                                      {s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                                    </Badge>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">None</span>
                              )}
                            </div>
                            {data.social_proof_used && (
                              <div className="rounded-md border bg-background/60 p-3">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Social Proof</p>
                                <div className="flex items-center gap-1">
                                  <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                                  <span className="text-xs text-emerald-400">Used</span>
                                </div>
                              </div>
                            )}
                          </div>
                          {data.triggered_situations && data.triggered_situations.length > 0 && (
                            <div>
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Situations Detected</p>
                              <div className="flex flex-wrap gap-1.5">
                                {data.triggered_situations.map((s, i) => (
                                  <Badge key={i} variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/20">
                                    {s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {data.objections_raised && Array.isArray(data.objections_raised) && data.objections_raised.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                            Objections Raised
                          </h4>
                          <div className="space-y-1.5">
                            {data.objections_raised.map((obj, i) => (
                              <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                                {obj}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {data.collected_responses && typeof data.collected_responses === 'object' && Object.keys(data.collected_responses).length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold mb-2">Collected Responses</h4>
                          <div className="space-y-2">
                            {Object.entries(data.collected_responses).map(([key, value]) => (
                              <div key={key} className="rounded-lg border bg-muted/30 p-3">
                                <p className="text-xs text-muted-foreground mb-0.5">{key}</p>
                                <p className="text-sm font-medium">{value}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── TRANSCRIPT TAB ── */}
                  {activeTab === "transcript" && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold">Full Transcript</h4>

                      {data.transcript_entries && data.transcript_entries.length > 0 ? (
                        <div className="rounded-lg border overflow-hidden">
                          <table className="w-full text-sm border-collapse">
                            <thead>
                              <tr className="border-b bg-muted/50">
                                <th className="text-left text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2 w-8 font-medium">#</th>
                                <th className="text-left text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2 w-28 font-medium">Speaker</th>
                                <th className="text-left text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2 font-medium">Message</th>
                                <th className="text-left text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2 w-20 font-medium">Time</th>
                              </tr>
                            </thead>
                            <tbody>
                              {data.transcript_entries.map((entry, i) => {
                                const isAgent = entry.role === "agent" || entry.role === "model" || entry.role === "assistant";
                                let timeLabel = "—";
                                if (entry.timestamp) {
                                  const d = new Date(entry.timestamp);
                                  timeLabel = isNaN(d.getTime())
                                    ? "—"
                                    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                                }
                                return (
                                  <tr
                                    key={i}
                                    className={cn(
                                      "border-b last:border-0 align-top",
                                      isAgent ? "bg-background" : "bg-muted/20"
                                    )}
                                  >
                                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{i + 1}</td>
                                    <td className="px-3 py-2.5">
                                      <span className={cn(
                                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                                        isAgent
                                          ? "bg-primary/10 text-primary"
                                          : "bg-muted text-muted-foreground border border-border"
                                      )}>
                                        {isAgent ? "Agent" : "Customer"}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2.5 text-sm leading-relaxed">{entry.text}</td>
                                    <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{timeLabel}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : data.transcript ? (
                        (() => {
                          const rows: { isAgent: boolean; text: string }[] = [];
                          data.transcript.split("\n").filter(Boolean).forEach((line) => {
                            const agentMatch = line.match(/^(Agent|Bot|AI|Model|Assistant)\s*:/i);
                            const userMatch = line.match(/^(User|Customer|Caller|Human)\s*:/i);
                            if (agentMatch || userMatch) {
                              rows.push({ isAgent: !!agentMatch, text: line.replace(/^[^:]+:\s*/, "") });
                            } else {
                              rows.push({ isAgent: false, text: line });
                            }
                          });
                          return (
                            <div className="rounded-lg border overflow-hidden">
                              <table className="w-full text-sm border-collapse">
                                <thead>
                                  <tr className="border-b bg-muted/50">
                                    <th className="text-left text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2 w-8 font-medium">#</th>
                                    <th className="text-left text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2 w-28 font-medium">Speaker</th>
                                    <th className="text-left text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2 font-medium">Message</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {rows.map((row, i) => (
                                    <tr key={i} className={cn("border-b last:border-0 align-top", row.isAgent ? "bg-background" : "bg-muted/20")}>
                                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{i + 1}</td>
                                      <td className="px-3 py-2.5">
                                        <span className={cn(
                                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                                          row.isAgent
                                            ? "bg-primary/10 text-primary"
                                            : "bg-muted text-muted-foreground border border-border"
                                        )}>
                                          {row.isAgent ? "Agent" : "Customer"}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2.5 text-sm leading-relaxed">{row.text}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          );
                        })()
                      ) : data.question_pairs && data.question_pairs.length > 0 ? (
                        // Fallback: reconstruct conversation from question_pairs
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground italic mb-3">Reconstructed from question/response pairs</p>
                          <div className="rounded-lg border overflow-hidden">
                            <table className="w-full text-sm border-collapse">
                              <thead>
                                <tr className="border-b bg-muted/50">
                                  <th className="text-left text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2 w-8 font-medium">#</th>
                                  <th className="text-left text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2 w-28 font-medium">Speaker</th>
                                  <th className="text-left text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2 font-medium">Message</th>
                                </tr>
                              </thead>
                              <tbody>
                                {data.question_pairs.flatMap((pair, i) => {
                                  const rows = [];
                                  if (pair.agent_said) {
                                    rows.push(
                                      <tr key={`a-${i}`} className="border-b align-top bg-background">
                                        <td className="px-3 py-2.5 text-xs text-muted-foreground">{i * 2 + 1}</td>
                                        <td className="px-3 py-2.5">
                                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-primary/10 text-primary">Agent</span>
                                        </td>
                                        <td className="px-3 py-2.5 text-sm leading-relaxed">{pair.agent_said}</td>
                                      </tr>
                                    );
                                  }
                                  if (pair.user_said) {
                                    rows.push(
                                      <tr key={`u-${i}`} className="border-b last:border-0 align-top bg-muted/20">
                                        <td className="px-3 py-2.5 text-xs text-muted-foreground">{i * 2 + 2}</td>
                                        <td className="px-3 py-2.5">
                                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground border border-border">Customer</span>
                                        </td>
                                        <td className="px-3 py-2.5 text-sm leading-relaxed">{pair.user_said}</td>
                                      </tr>
                                    );
                                  }
                                  return rows;
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No transcript available.</p>
                      )}
                    </div>
                  )}

                  {/* ── METRICS TAB ── */}
                  {activeTab === "metrics" && (
                    <div className="space-y-5">
                      <h4 className="text-sm font-semibold mb-2">Call Performance Metrics</h4>
                      <div className="grid grid-cols-2 gap-3">
                        <MetricCard icon={Clock} label="Total Duration" value={data.call_metrics.total_duration_s} unit="s" />
                        <MetricCard icon={MessageSquare} label="Questions Completed" value={data.call_metrics.questions_completed} />
                        <MetricCard icon={Zap} label="Avg Latency" value={data.call_metrics.avg_latency_ms} unit="ms" />
                        <MetricCard icon={Activity} label="P90 Latency" value={data.call_metrics.p90_latency_ms} unit="ms" />
                        <MetricCard icon={Gauge} label="Min Latency" value={data.call_metrics.min_latency_ms} unit="ms" />
                        <MetricCard icon={Timer} label="Max Latency" value={data.call_metrics.max_latency_ms} unit="ms" />
                      </div>

                      {data.call_metrics.total_nudges > 0 && (
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                          <p className="text-sm text-amber-400">
                            <AlertTriangle className="inline h-3.5 w-3.5 mr-1.5" />
                            {data.call_metrics.total_nudges} nudge{data.call_metrics.total_nudges > 1 ? "s" : ""} were needed during this call
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── QUALIFICATION TAB ── */}
                  {activeTab === "qualification" && data.qualification && (
                    <div className="space-y-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <QualificationBadge level={data.qualification.level} />
                          <span className="text-sm text-muted-foreground">
                            Confidence: {data.qualification.confidence}%
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(data.qualification.qualifiedAt)}
                        </span>
                      </div>

                      <Progress value={data.qualification.confidence} className="h-2" />

                      <div>
                        <h4 className="text-sm font-semibold mb-2">Reasoning</h4>
                        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                          {data.qualification.reasoning}
                        </p>
                      </div>

                      {data.qualification.painPoints.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold mb-2">Pain Points Identified</h4>
                          <div className="space-y-1.5">
                            {data.qualification.painPoints.map((point, i) => (
                              <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
                                {point}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {data.qualification.keyInsights.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold mb-2">Key Insights</h4>
                          <div className="space-y-1.5">
                            {data.qualification.keyInsights.map((insight, i) => (
                              <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                {insight}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                        <h4 className="text-sm font-semibold mb-1">Recommended Next Action</h4>
                        <p className="text-sm text-muted-foreground">{data.qualification.recommendedAction}</p>
                      </div>

                      {data.qualification.objectionAnalysis.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold mb-2">Objection Analysis</h4>
                          <div className="space-y-3">
                            {data.qualification.objectionAnalysis.map((obj, i) => (
                              <div key={i} className="rounded-lg border p-3 space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium">{obj.objection}</span>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "text-[10px]",
                                      obj.severity === "high"
                                        ? "text-red-400 border-red-500/20"
                                        : obj.severity === "medium"
                                          ? "text-amber-400 border-amber-500/20"
                                          : "text-green-400 border-green-500/20"
                                    )}
                                  >
                                    {obj.severity}
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">{obj.suggestedResponse}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === "qualification" && !data.qualification && (
                    <div className="text-center py-8 text-sm text-muted-foreground">
                      <Target className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      <p>No qualification data available for this call.</p>
                    </div>
                  )}

                  {/* ── INTELLIGENCE TAB ── */}
                  {activeTab === "intelligence" && (
                    <div className="space-y-6">

                      {/* Engagement Overview */}
                      <div>
                        <h4 className="text-sm font-semibold mb-3">Engagement Overview</h4>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="rounded-lg border bg-muted/30 p-3">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Interest Level</p>
                            <p className="text-sm font-semibold">{data.interest_level || "—"}</p>
                          </div>
                          <div className="rounded-lg border bg-muted/30 p-3">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Completion</p>
                            <p className="text-sm font-semibold">
                              {Math.round(data.completion_rate > 1 ? data.completion_rate : data.completion_rate * 100)}%
                            </p>
                          </div>
                          <div className="rounded-lg border bg-muted/30 p-3">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Objections</p>
                            <p className="text-sm font-semibold">{data.objections_raised.length}</p>
                          </div>
                          <div className="rounded-lg border bg-muted/30 p-3">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Avg Response</p>
                            <p className="text-sm font-semibold">{data.call_metrics.avg_latency_ms}<span className="text-xs text-muted-foreground ml-0.5">ms</span></p>
                          </div>
                        </div>
                      </div>

                      {/* Question & Response Breakdown */}
                      {data.question_pairs && data.question_pairs.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                            <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                            Question & Response Breakdown
                          </h4>
                          <div className="rounded-lg border overflow-hidden">
                            <table className="w-full text-sm border-collapse">
                              <thead>
                                <tr className="border-b bg-muted/50">
                                  <th className="text-left text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2 w-6 font-medium">#</th>
                                  <th className="text-left text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2 font-medium">Question</th>
                                  <th className="text-left text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2 font-medium">Customer Response</th>
                                  <th className="text-left text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2 w-16 font-medium">Duration</th>
                                </tr>
                              </thead>
                              <tbody>
                                {data.question_pairs.map((pair, i) => (
                                  <tr key={i} className="border-b last:border-0 align-top">
                                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{i + 1}</td>
                                    <td className="px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">{pair.question_text}</td>
                                    <td className="px-3 py-2.5 text-xs leading-relaxed">{pair.user_said || <span className="text-muted-foreground italic">No response</span>}</td>
                                    <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{pair.duration_seconds}s</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Collected Responses */}
                      {Object.keys(data.collected_responses).length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold mb-3">Collected Data Points</h4>
                          <div className="rounded-lg border overflow-hidden">
                            <table className="w-full text-sm border-collapse">
                              <thead>
                                <tr className="border-b bg-muted/50">
                                  <th className="text-left text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2 font-medium">Field</th>
                                  <th className="text-left text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2 font-medium">Value</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(data.collected_responses).map(([key, value]) => (
                                  <tr key={key} className="border-b last:border-0 align-top">
                                    <td className="px-3 py-2.5 text-xs text-muted-foreground font-medium whitespace-nowrap">{key}</td>
                                    <td className="px-3 py-2.5 text-sm">{value}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* AI Behaviour Triggers */}
                      {(data.triggered_persona || (data.triggered_situations && data.triggered_situations.length > 0) || (data.triggered_product_sections && data.triggered_product_sections.length > 0) || data.social_proof_used) && (
                        <div>
                          <h4 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                            <Brain className="h-3.5 w-3.5 text-violet-400" />
                            AI Behaviour Triggers
                          </h4>
                          <div className="space-y-3">
                            {data.triggered_persona && typeof data.triggered_persona === 'string' && (
                              <div className="rounded-lg border p-3">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Detected Persona</p>
                                <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/20">
                                  {data.triggered_persona.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                                </Badge>
                                <p className="text-xs text-muted-foreground mt-2">
                                  The AI identified this prospect&apos;s profile and adapted its conversation style accordingly.
                                </p>
                              </div>
                            )}

                            {data.triggered_situations && data.triggered_situations.length > 0 && (
                              <div className="rounded-lg border p-3">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                                  Situations Handled ({data.triggered_situations.length})
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {data.triggered_situations.map((s, i) => (
                                    <Badge key={i} variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/20">
                                      {s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                                    </Badge>
                                  ))}
                                </div>
                                <p className="text-xs text-muted-foreground mt-2">
                                  These conversational situations were detected and handled using predefined response strategies.
                                </p>
                              </div>
                            )}

                            {data.triggered_product_sections && data.triggered_product_sections.length > 0 && (
                              <div className="rounded-lg border p-3">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                                  Products Discussed ({data.triggered_product_sections.length})
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {data.triggered_product_sections.map((s, i) => (
                                    <Badge key={i} variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                                      {s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                                    </Badge>
                                  ))}
                                </div>
                                <p className="text-xs text-muted-foreground mt-2">
                                  Product knowledge from these sections was surfaced based on the conversation context.
                                </p>
                              </div>
                            )}

                            {data.social_proof_used && (
                              <div className="rounded-lg border p-3 flex items-start gap-3">
                                <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                                <div>
                                  <p className="text-sm font-medium">Social Proof Used</p>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    The AI used social proof examples (companies, cities, or roles) to build credibility during the call.
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Empty state */}
                      {!data.triggered_persona &&
                        !data.triggered_situations?.length &&
                        !data.triggered_product_sections?.length &&
                        !data.social_proof_used &&
                        !data.question_pairs?.length &&
                        (!data.collected_responses || typeof data.collected_responses !== 'object' || Object.keys(data.collected_responses).length === 0) && (
                          <div className="text-center py-8 text-sm text-muted-foreground">
                            <Brain className="h-10 w-10 mx-auto mb-3 opacity-30" />
                            <p>No intelligence data available for this call.</p>
                          </div>
                        )}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </>
        ) : (
          <div className="p-6 text-center text-sm text-muted-foreground">
            <p>No detailed call data available yet.</p>
            <p className="mt-1">Call data will appear here once the call ends.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
