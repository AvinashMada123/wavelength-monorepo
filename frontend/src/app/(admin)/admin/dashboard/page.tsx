"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Building2,
  Users,
  Phone,
  Clock,
  Loader2,
  Plus,
  ArrowRight,
  Activity,
  BarChart3,
  CreditCard,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import type { Organization } from "@/types/user";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface PlatformStats {
  totalOrgs: number;
  totalUsers: number;
  totalCallsThisMonth: number;
  totalMinutesThisMonth: number;
}

interface RecentSignup {
  uid: string;
  email: string;
  displayName: string;
  orgId: string;
  orgName: string;
  createdAt: string;
}

interface RecentCall {
  id: string;
  orgId: string;
  orgName: string;
  contactName: string;
  phoneNumber: string;
  status: string;
  initiatedAt: string;
  durationSeconds?: number;
}

interface TopClient {
  orgId: string;
  name: string;
  totalCalls: number;
  totalMinutes: number;
  plan: string;
}

const statusColors: Record<string, string> = {
  completed: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  ended: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  failed: "bg-red-500/15 text-red-600 border-red-500/20",
  "in-progress": "bg-blue-500/15 text-blue-600 border-blue-500/20",
  initiated: "bg-amber-500/15 text-amber-600 border-amber-500/20",
};

const planColors: Record<string, string> = {
  free: "bg-zinc-500/15 text-zinc-600 border-zinc-500/20",
  starter: "bg-blue-500/15 text-blue-600 border-blue-500/20",
  pro: "bg-violet-500/15 text-violet-600 border-violet-500/20",
  enterprise: "bg-amber-500/15 text-amber-600 border-amber-500/20",
};

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function AdminDashboardPage() {
  const { isSuperAdmin, user } = useAuth();
  const [stats, setStats] = useState<PlatformStats>({
    totalOrgs: 0,
    totalUsers: 0,
    totalCallsThisMonth: 0,
    totalMinutesThisMonth: 0,
  });
  const [recentSignups, setRecentSignups] = useState<RecentSignup[]>([]);
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([]);
  const [topClients, setTopClients] = useState<TopClient[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSuperAdmin || !user) return;
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, user]);

  async function loadStats() {
    try {
      setLoading(true);

      const idToken = await user!.getIdToken();
      const headers = { Authorization: `Bearer ${idToken}` };

      const fetchPromise = Promise.all([
        fetch("/api/admin/organizations", { headers }).then((r) => r.ok ? r.json() : null),
        fetch("/api/admin/stats", { headers }).then((r) => r.ok ? r.json() : null),
      ]);

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Request timeout")), 30000)
      );

      const [orgsRes, statsRes] = await Promise.race([fetchPromise, timeoutPromise]);

      const orgs: Organization[] = orgsRes?.organizations || [];

      // Build usage from org.usage JSONB
      const totalCalls = orgs.reduce((sum, o) => sum + ((o as unknown as Record<string, Record<string, number>>).usage?.totalCalls ?? 0), 0);
      const totalMinutes = orgs.reduce((sum, o) => sum + ((o as unknown as Record<string, Record<string, number>>).usage?.totalMinutes ?? 0), 0);

      setStats({
        totalOrgs: orgs.length,
        totalUsers: statsRes?.totalUsers ?? 0,
        totalCallsThisMonth: totalCalls,
        totalMinutesThisMonth: Math.round(totalMinutes * 100) / 100,
      });

      if (statsRes) {
        setRecentSignups(statsRes.recentSignups || []);
        setRecentCalls(statsRes.recentCalls || []);
      }

      // Build top clients from usage
      const topClientsData: TopClient[] = orgs
        .filter((o) => ((o as unknown as Record<string, Record<string, number>>).usage?.totalCalls ?? 0) > 0)
        .sort((a, b) =>
          ((b as unknown as Record<string, Record<string, number>>).usage?.totalCalls ?? 0) -
          ((a as unknown as Record<string, Record<string, number>>).usage?.totalCalls ?? 0)
        )
        .slice(0, 5)
        .map((o) => ({
          orgId: o.id,
          name: o.name,
          totalCalls: (o as unknown as Record<string, Record<string, number>>).usage?.totalCalls ?? 0,
          totalMinutes: Math.round(((o as unknown as Record<string, Record<string, number>>).usage?.totalMinutes ?? 0) * 100) / 100,
          plan: o.plan,
        }));
      setTopClients(topClientsData);
    } catch (error) {
      console.error("[Admin Dashboard] Error loading stats:", error);
      const errorMessage =
        error instanceof Error && error.message === "Request timeout"
          ? "Request timed out. Please try again."
          : "Failed to load platform stats";
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  const cards = [
    { title: "Total Organizations", value: stats.totalOrgs, icon: Building2, color: "text-blue-600", bgColor: "bg-blue-500/10" },
    { title: "Total Users", value: stats.totalUsers, icon: Users, color: "text-violet-600", bgColor: "bg-violet-500/10" },
    { title: "Calls This Month", value: stats.totalCallsThisMonth.toLocaleString(), icon: Phone, color: "text-emerald-600", bgColor: "bg-emerald-500/10" },
    { title: "Minutes This Month", value: stats.totalMinutesThisMonth.toLocaleString(), icon: Clock, color: "text-amber-600", bgColor: "bg-amber-500/10" },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="text-muted-foreground">Platform-wide overview and statistics</p>
        </div>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
        <p className="text-muted-foreground">Platform-wide overview and statistics</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card, index) => {
          const Icon = card.icon;
          return (
            <motion.div key={card.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.08 }}>
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
                    <div className={`rounded-lg p-2 ${card.bgColor}`}>
                      <Icon className={`size-4 ${card.color}`} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{card.value}</div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Phone className="size-5 text-muted-foreground" />
                    <CardTitle>Recent Calls</CardTitle>
                  </div>
                  <Link href="/admin/usage"><Button variant="ghost" size="sm">View All <ArrowRight className="size-4" /></Button></Link>
                </div>
              </CardHeader>
              <CardContent>
                {recentCalls.length === 0 ? (
                  <p className="text-muted-foreground text-center py-6">No recent calls</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Contact</TableHead><TableHead>Organization</TableHead><TableHead>Status</TableHead><TableHead>When</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {recentCalls.map((call) => (
                        <TableRow key={call.id}>
                          <TableCell className="font-medium">{call.contactName}</TableCell>
                          <TableCell><Link href={`/admin/clients/${call.orgId}`} className="text-muted-foreground hover:text-foreground transition-colors">{call.orgName}</Link></TableCell>
                          <TableCell><Badge className={statusColors[call.status] ?? "bg-zinc-500/15 text-zinc-600 border-zinc-500/20"}>{call.status.charAt(0).toUpperCase() + call.status.slice(1)}</Badge></TableCell>
                          <TableCell className="text-muted-foreground">{timeAgo(call.initiatedAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="size-5 text-muted-foreground" />
                    <CardTitle>Top Clients This Month</CardTitle>
                  </div>
                  <Link href="/admin/clients"><Button variant="ghost" size="sm">View All <ArrowRight className="size-4" /></Button></Link>
                </div>
              </CardHeader>
              <CardContent>
                {topClients.length === 0 ? (
                  <p className="text-muted-foreground text-center py-6">No usage data this month</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Organization</TableHead><TableHead>Plan</TableHead><TableHead className="text-right">Calls</TableHead><TableHead className="text-right">Minutes</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {topClients.map((client) => (
                        <TableRow key={client.orgId}>
                          <TableCell><Link href={`/admin/clients/${client.orgId}`} className="font-medium hover:underline">{client.name}</Link></TableCell>
                          <TableCell><Badge className={planColors[client.plan] ?? planColors.free}>{client.plan.charAt(0).toUpperCase() + client.plan.slice(1)}</Badge></TableCell>
                          <TableCell className="text-right font-medium">{client.totalCalls.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{client.totalMinutes.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <div className="space-y-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Activity className="size-5 text-muted-foreground" />
                  <CardTitle>Quick Actions</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <Link href="/admin/clients" className="block"><Button variant="outline" className="w-full justify-start gap-2"><Plus className="size-4" />Add New Client</Button></Link>
                <Link href="/admin/clients" className="block"><Button variant="outline" className="w-full justify-start gap-2"><Building2 className="size-4" />View All Clients</Button></Link>
                <Link href="/admin/usage" className="block"><Button variant="outline" className="w-full justify-start gap-2"><BarChart3 className="size-4" />Usage Analytics</Button></Link>
                <Link href="/admin/billing" className="block"><Button variant="outline" className="w-full justify-start gap-2"><CreditCard className="size-4" />Billing Overview</Button></Link>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <UserPlus className="size-5 text-muted-foreground" />
                  <CardTitle>Recent Signups</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {recentSignups.length === 0 ? (
                  <p className="text-muted-foreground text-center py-6">No recent signups</p>
                ) : (
                  <div className="space-y-3">
                    {recentSignups.slice(0, 8).map((signup) => (
                      <div key={signup.uid} className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{signup.displayName || signup.email}</p>
                          <p className="text-xs text-muted-foreground truncate">{signup.orgName}</p>
                        </div>
                        <p className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(signup.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
