"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import type { ContactMemory } from "@/types/memory";
import { useAuth } from "@/hooks/use-auth";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MemoryDetailDialog } from "@/components/memory/memory-detail-dialog";
import { LinguisticStyleTags } from "@/components/memory/linguistic-style-tags";
import { formatPhoneNumber } from "@/lib/utils";

async function apiMemory(
  user: { getIdToken: () => Promise<string> },
  method: "GET" | "POST",
  body?: Record<string, unknown>,
  params?: string
) {
  const idToken = await user.getIdToken();
  const url = `/api/data/memory${params ? `?${params}` : ""}`;
  const res = await fetch(url, {
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

const outcomeBadgeColor: Record<string, string> = {
  high: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  low: "bg-red-500/10 text-red-400 border-red-500/20",
  unknown: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

export default function MemoryPage() {
  const { user } = useAuth();
  const [memories, setMemories] = useState<ContactMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedMemory, setSelectedMemory] = useState<ContactMemory | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const data = await apiMemory(user, "GET");
      setMemories(data.memories || []);
    } catch {
      toast.error("Failed to load contact memories");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filtered = memories.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (m.name || "").toLowerCase().includes(q) ||
      (m.phone || "").includes(q) ||
      (m.company || "").toLowerCase().includes(q) ||
      (m.persona || "").toLowerCase().includes(q) ||
      (m.role || "").toLowerCase().includes(q) ||
      (m.keyFacts || []).some((f) => f.toLowerCase().includes(q)) ||
      (m.interestAreas || []).some((a) => a.toLowerCase().includes(q))
    );
  });

  // Sort by last call date (most recent first), then by call count
  const sorted = [...filtered].sort((a, b) => {
    const dateA = a.lastCallDate ? new Date(a.lastCallDate).getTime() : 0;
    const dateB = b.lastCallDate ? new Date(b.lastCallDate).getTime() : 0;
    if (dateB !== dateA) return dateB - dateA;
    return (b.callCount || 0) - (a.callCount || 0);
  });

  function openDetail(memory: ContactMemory) {
    setSelectedMemory(memory);
    setDetailOpen(true);
  }

  async function handleUpdate(phone: string, updates: Record<string, unknown>) {
    if (!user) return;
    await apiMemory(user, "POST", { action: "update", phone, updates });
    loadData();
  }

  async function handleDelete(phone: string) {
    if (!user) return;
    await apiMemory(user, "POST", { action: "delete", phone });
    setMemories((prev) => prev.filter((m) => m.phone !== phone));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Contact Memory</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cross-call memory for all contacts. {memories.length} contacts stored.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by name, phone, company, interests..."
              className="w-80 pl-8 h-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" size="sm" onClick={loadData}>
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <p className="text-sm">
                {search ? "No contacts match your search" : "No contact memories yet"}
              </p>
              <p className="text-xs mt-1">
                {search
                  ? "Try a different search term"
                  : "Memories are created automatically after calls"}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Profile</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead className="text-center">Calls</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Last Called</TableHead>
                  <TableHead>Style</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((m) => (
                  <TableRow
                    key={m.phone}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => openDetail(m)}
                  >
                    <TableCell className="font-medium">
                      {m.name || "--"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatPhoneNumber(m.phone)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1 max-w-[200px]">
                        {m.company && (
                          <span className="text-xs text-muted-foreground">{m.company}</span>
                        )}
                        {m.company && m.role && <span className="text-muted-foreground/50 text-xs">·</span>}
                        {m.role && (
                          <span className="text-xs text-muted-foreground">{m.role}</span>
                        )}
                        {m.persona && (
                          <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-400 border-purple-500/20 h-5">
                            {m.persona.replace(/_/g, " ")}
                          </Badge>
                        )}
                        {!m.company && !m.role && !m.persona && (
                          <span className="text-xs text-muted-foreground">--</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-[220px]">
                        {(m.interestAreas || []).slice(0, 2).map((area, i) => (
                          <Badge key={`i-${i}`} variant="outline" className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/20 h-5">
                            {area}
                          </Badge>
                        ))}
                        {(m.objections || []).slice(0, 1).map((obj, i) => (
                          <Badge key={`o-${i}`} variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/20 h-5">
                            {obj}
                          </Badge>
                        ))}
                        {((m.interestAreas?.length || 0) + (m.objections?.length || 0)) > 3 && (
                          <Badge variant="secondary" className="text-[10px] h-5">
                            +{(m.interestAreas?.length || 0) + (m.objections?.length || 0) - 3}
                          </Badge>
                        )}
                        {!(m.interestAreas?.length || 0) && !(m.objections?.length || 0) && (
                          <span className="text-xs text-muted-foreground">--</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {m.callCount || 0}
                    </TableCell>
                    <TableCell>
                      {m.lastCallOutcome ? (
                        <Badge
                          variant="outline"
                          className={`text-xs ${outcomeBadgeColor[m.lastCallOutcome.toLowerCase()] || outcomeBadgeColor.unknown}`}
                        >
                          {m.lastCallOutcome}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {m.lastCallDate
                        ? new Date(m.lastCallDate).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        : "--"}
                    </TableCell>
                    <TableCell>
                      <LinguisticStyleTags style={m.linguisticStyle} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <MemoryDetailDialog
        memory={selectedMemory}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onSave={handleUpdate}
        onDelete={handleDelete}
      />
    </motion.div>
  );
}
