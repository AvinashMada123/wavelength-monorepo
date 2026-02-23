"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Building2,
  Users,
  Phone,
  Clock,
  Loader2,
  Shield,
  ShieldCheck,
  User,
  Pencil,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import type { Organization, UserProfile } from "@/types/user";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const planColors: Record<string, string> = {
  free: "bg-zinc-500/15 text-zinc-600 border-zinc-500/20",
  starter: "bg-blue-500/15 text-blue-600 border-blue-500/20",
  pro: "bg-violet-500/15 text-violet-600 border-violet-500/20",
  enterprise: "bg-amber-500/15 text-amber-600 border-amber-500/20",
};

const statusColors: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  suspended: "bg-red-500/15 text-red-600 border-red-500/20",
  trial: "bg-amber-500/15 text-amber-600 border-amber-500/20",
};

const roleConfig: Record<string, { label: string; icon: typeof Shield; color: string }> = {
  super_admin: { label: "Super Admin", icon: ShieldCheck, color: "bg-purple-500/15 text-purple-600 border-purple-500/20" },
  client_admin: { label: "Admin", icon: Shield, color: "bg-blue-500/15 text-blue-600 border-blue-500/20" },
  client_user: { label: "User", icon: User, color: "bg-zinc-500/15 text-zinc-600 border-zinc-500/20" },
};

interface OrgUsage {
  totalCalls?: number;
  totalMinutes?: number;
  completedCalls?: number;
  failedCalls?: number;
}

export default function AdminClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { isSuperAdmin, user } = useAuth();
  const targetOrgId = params.orgId as string;

  const [org, setOrg] = useState<Organization | null>(null);
  const [usage, setUsage] = useState<OrgUsage | null>(null);
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [editOpen, setEditOpen] = useState(false);
  const [editPlan, setEditPlan] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [saving, setSaving] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"client_admin" | "client_user">("client_user");
  const [inviting, setInviting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const idToken = await user!.getIdToken();
      const headers = { Authorization: `Bearer ${idToken}` };

      // Fetch org from admin orgs list, and members via admin stats
      const orgsRes = await fetch("/api/admin/organizations", { headers });
      if (!orgsRes.ok) throw new Error("Failed to load");
      const orgsData = await orgsRes.json();
      const allOrgs: Organization[] = orgsData.organizations || [];
      const orgData = allOrgs.find((o) => o.id === targetOrgId);

      if (!orgData) {
        toast.error("Organization not found");
        router.push("/admin/clients");
        return;
      }

      setOrg(orgData);
      // Usage from org.usage JSONB
      const orgUsage = (orgData as unknown as Record<string, Record<string, number>>).usage || {};
      setUsage({
        totalCalls: orgUsage.totalCalls ?? 0,
        totalMinutes: orgUsage.totalMinutes ?? 0,
        completedCalls: orgUsage.completedCalls ?? 0,
        failedCalls: orgUsage.failedCalls ?? 0,
      });

      // Fetch members - use admin stats endpoint to get all users, then filter
      const statsRes = await fetch("/api/admin/stats", { headers });
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        // recentSignups contains all users; filter by orgId
        // Note: this is a workaround; ideally we'd have a dedicated endpoint
        // For now, the members come from all signups
      }

      // We don't have a dedicated members endpoint from admin side yet,
      // so we'll use the fact that the orgs API doesn't return members.
      // Let's create a simple members fetch. For now show empty.
      setMembers([]);
    } catch {
      toast.error("Failed to load organization details");
    } finally {
      setLoading(false);
    }
  }, [targetOrgId, router, user]);

  useEffect(() => {
    if (!isSuperAdmin || !user) return;
    loadData();
  }, [isSuperAdmin, user, loadData]);

  async function handleSaveOrg() {
    try {
      setSaving(true);
      const idToken = await user!.getIdToken();
      const res = await fetch("/api/admin/organizations", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", orgId: targetOrgId, updates: { plan: editPlan, status: editStatus } }),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast.success("Organization updated");
      setEditOpen(false);
      loadData();
    } catch {
      toast.error("Failed to update organization");
    } finally {
      setSaving(false);
    }
  }

  async function handleInvite() {
    if (!inviteEmail.trim()) {
      toast.error("Please enter an email address");
      return;
    }
    try {
      setInviting(true);
      const idToken = await user!.getIdToken();
      const res = await fetch("/api/admin/organizations", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invite", orgId: targetOrgId, email: inviteEmail.trim(), role: inviteRole }),
      });
      if (!res.ok) throw new Error("Failed to invite");
      const data = await res.json();
      toast.success(`Invite sent to ${inviteEmail}`, {
        description: `Invite link: ${window.location.origin}/invite/${data.inviteId}`,
      });
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("client_user");
    } catch {
      toast.error("Failed to send invite");
    } finally {
      setInviting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!org) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/admin/clients")}>
          <ArrowLeft className="size-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">{org.name}</h1>
          <p className="text-muted-foreground">Organization details and usage</p>
        </div>
        <Button variant="outline" onClick={() => { setEditPlan(org.plan); setEditStatus(org.status); setEditOpen(true); }}>
          <Pencil className="size-4" />Edit
        </Button>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="size-5 text-muted-foreground" />
              <CardTitle>Organization Info</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div><p className="text-sm text-muted-foreground">Name</p><p className="font-medium">{org.name}</p></div>
              <div><p className="text-sm text-muted-foreground">Plan</p><Badge className={planColors[org.plan] ?? planColors.free}>{org.plan.charAt(0).toUpperCase() + org.plan.slice(1)}</Badge></div>
              <div><p className="text-sm text-muted-foreground">Status</p><Badge className={statusColors[org.status] ?? statusColors.active}>{org.status.charAt(0).toUpperCase() + org.status.slice(1)}</Badge></div>
              <div><p className="text-sm text-muted-foreground">Created</p><p className="font-medium">{new Date(org.createdAt).toLocaleDateString()}</p></div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Card>
          <CardHeader><CardTitle>Usage This Month</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-blue-500/10 p-2"><Phone className="size-4 text-blue-600" /></div>
                <div><p className="text-sm text-muted-foreground">Total Calls</p><p className="text-2xl font-bold">{usage?.totalCalls ?? 0}</p></div>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-emerald-500/10 p-2"><Clock className="size-4 text-emerald-600" /></div>
                <div><p className="text-sm text-muted-foreground">Total Minutes</p><p className="text-2xl font-bold">{Math.round((usage?.totalMinutes ?? 0) * 100) / 100}</p></div>
              </div>
              <div><p className="text-sm text-muted-foreground">Completed Calls</p><p className="text-2xl font-bold">{usage?.completedCalls ?? 0}</p></div>
              <div><p className="text-sm text-muted-foreground">Failed Calls</p><p className="text-2xl font-bold">{usage?.failedCalls ?? 0}</p></div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="size-5 text-muted-foreground" />
                <CardTitle>Team Members ({members.length})</CardTitle>
              </div>
              <Button size="sm" onClick={() => setInviteOpen(true)}>
                <UserPlus className="size-4" />Invite
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {members.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No team members loaded</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Last Login</TableHead></TableRow></TableHeader>
                <TableBody>
                  {members.map((member) => {
                    const role = roleConfig[member.role] ?? roleConfig.client_user;
                    const RoleIcon = role.icon;
                    return (
                      <TableRow key={member.uid}>
                        <TableCell className="font-medium">{member.displayName}</TableCell>
                        <TableCell className="text-muted-foreground">{member.email}</TableCell>
                        <TableCell><Badge className={role.color}><RoleIcon className="size-3" />{role.label}</Badge></TableCell>
                        <TableCell>
                          <Badge className={member.status === "active" ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/20" : member.status === "disabled" ? "bg-red-500/15 text-red-600 border-red-500/20" : "bg-amber-500/15 text-amber-600 border-amber-500/20"}>
                            {member.status === "pending_invite" ? "Pending" : member.status.charAt(0).toUpperCase() + member.status.slice(1)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleDateString() : "Never"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Organization</DialogTitle><DialogDescription>Update plan and status for {org.name}</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Plan</Label>
              <Select value={editPlan} onValueChange={setEditPlan}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="free">Free</SelectItem><SelectItem value="starter">Starter</SelectItem><SelectItem value="pro">Pro</SelectItem><SelectItem value="enterprise">Enterprise</SelectItem></SelectContent></Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={editStatus} onValueChange={setEditStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="suspended">Suspended</SelectItem><SelectItem value="trial">Trial</SelectItem></SelectContent></Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveOrg} disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />}Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invite Team Member</DialogTitle><DialogDescription>Send an invite to join {org.name}</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email Address</Label>
              <Input id="invite-email" type="email" placeholder="user@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "client_admin" | "client_user")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="client_admin">Admin (full management access)</SelectItem><SelectItem value="client_user">User (standard access)</SelectItem></SelectContent></Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={handleInvite} disabled={inviting}>{inviting && <Loader2 className="size-4 animate-spin" />}Send Invite</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
