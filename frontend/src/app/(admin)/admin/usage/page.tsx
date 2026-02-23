"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  BarChart3,
  Phone,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import type { Organization } from "@/types/user";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface OrgUsageRow {
  orgId: string;
  orgName: string;
  totalCalls: number;
  totalMinutes: number;
  completedCalls: number;
  failedCalls: number;
}

export default function AdminUsagePage() {
  const { isSuperAdmin, user } = useAuth();
  const [rows, setRows] = useState<OrgUsageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const totals = rows.reduce(
    (acc, r) => ({
      totalCalls: acc.totalCalls + r.totalCalls,
      totalMinutes: acc.totalMinutes + r.totalMinutes,
      completedCalls: acc.completedCalls + r.completedCalls,
      failedCalls: acc.failedCalls + r.failedCalls,
    }),
    { totalCalls: 0, totalMinutes: 0, completedCalls: 0, failedCalls: 0 }
  );

  useEffect(() => {
    if (!isSuperAdmin || !user) return;
    loadUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, user]);

  async function loadUsage() {
    try {
      setLoading(true);
      const idToken = await user!.getIdToken();
      const res = await fetch("/api/admin/organizations", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      const orgs: Organization[] = data.organizations || [];

      const result: OrgUsageRow[] = orgs.map((org) => {
        const u = (org as unknown as Record<string, Record<string, number>>).usage || {};
        return {
          orgId: org.id,
          orgName: org.name,
          totalCalls: u.totalCalls ?? 0,
          totalMinutes: Math.round((u.totalMinutes ?? 0) * 100) / 100,
          completedCalls: u.completedCalls ?? 0,
          failedCalls: u.failedCalls ?? 0,
        };
      });

      result.sort((a, b) => b.totalCalls - a.totalCalls);
      setRows(result);
    } catch {
      toast.error("Failed to load usage data");
    } finally {
      setLoading(false);
    }
  }

  const summaryCards = [
    { title: "Total Calls", value: totals.totalCalls.toLocaleString(), icon: Phone, color: "text-blue-600", bgColor: "bg-blue-500/10" },
    { title: "Total Minutes", value: Math.round(totals.totalMinutes * 100) / 100, icon: Clock, color: "text-emerald-600", bgColor: "bg-emerald-500/10" },
    { title: "Completed", value: totals.completedCalls.toLocaleString(), icon: CheckCircle, color: "text-green-600", bgColor: "bg-green-500/10" },
    { title: "Failed", value: totals.failedCalls.toLocaleString(), icon: XCircle, color: "text-red-600", bgColor: "bg-red-500/10" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Usage Analytics</h1>
        <p className="text-muted-foreground">Platform-wide usage statistics for the current month</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {summaryCards.map((card, index) => {
              const Icon = card.icon;
              return (
                <motion.div key={card.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.08 }}>
                  <Card>
                    <CardContent className="flex items-center gap-4 pt-0">
                      <div className={`rounded-lg p-2.5 ${card.bgColor}`}>
                        <Icon className={`size-5 ${card.color}`} />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">{card.title}</p>
                        <p className="text-2xl font-bold">{card.value}</p>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <BarChart3 className="size-5 text-muted-foreground" />
                  <CardTitle>Usage by Organization</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {rows.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">No usage data for this month</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Organization</TableHead>
                        <TableHead className="text-right">Total Calls</TableHead>
                        <TableHead className="text-right">Total Minutes</TableHead>
                        <TableHead className="text-right">Completed</TableHead>
                        <TableHead className="text-right">Failed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={row.orgId}>
                          <TableCell className="font-medium">{row.orgName}</TableCell>
                          <TableCell className="text-right">{row.totalCalls.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{row.totalMinutes.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{row.completedCalls.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{row.failedCalls.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </>
      )}
    </div>
  );
}
