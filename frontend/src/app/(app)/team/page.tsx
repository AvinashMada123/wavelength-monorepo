"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Users,
  UserPlus,
  Mail,
  Loader2,
  Shield,
  ShieldCheck,
  User,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { RoleGuard } from "@/components/auth/role-guard";
import type { UserProfile } from "@/types/user";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function TeamPage() {
  return (
    <RoleGuard allowedRoles={["super_admin", "client_admin"]}>
      <TeamContent />
    </RoleGuard>
  );
}

const roleConfig: Record<string, { label: string; icon: typeof Shield; color: string }> = {
  super_admin: {
    label: "Super Admin",
    icon: ShieldCheck,
    color: "bg-purple-500/15 text-purple-600 border-purple-500/20",
  },
  client_admin: {
    label: "Admin",
    icon: Shield,
    color: "bg-blue-500/15 text-blue-600 border-blue-500/20",
  },
  client_user: {
    label: "User",
    icon: User,
    color: "bg-zinc-500/15 text-zinc-600 border-zinc-500/20",
  },
};

const statusConfig: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  disabled: "bg-red-500/15 text-red-600 border-red-500/20",
  pending_invite: "bg-amber-500/15 text-amber-600 border-amber-500/20",
};

function TeamContent() {
  const { orgId, user, initialData } = useAuth();
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"client_admin" | "client_user">("client_user");
  const [inviting, setInviting] = useState(false);

  // Use initialData from auth context for instant render
  useEffect(() => {
    if (!orgId) return;
    if (initialData?.team) {
      setMembers(initialData.team as UserProfile[]);
      setLoading(false);
    } else {
      loadMembers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, initialData]);

  const loadMembers = useCallback(async () => {
    if (!orgId || !user) return;
    try {
      setLoading(true);
      const idToken = await user.getIdToken();
      const res = await fetch("/api/data/team", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setMembers(data.members);
    } catch {
      toast.error("Failed to load team members");
    } finally {
      setLoading(false);
    }
  }, [orgId, user]);

  async function handleInvite() {
    if (!user) return;
    if (!inviteEmail.trim()) {
      toast.error("Please enter an email address");
      return;
    }

    try {
      setInviting(true);

      const idToken = await user.getIdToken();
      const res = await fetch("/api/data/team", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "invite",
          email: inviteEmail,
          role: inviteRole,
        }),
      });

      if (!res.ok) throw new Error("Failed");

      toast.success(`Invite sent to ${inviteEmail}`);
      setInviteEmail("");
      setInviteRole("client_user");
      setInviteOpen(false);
    } catch {
      toast.error("Failed to send invite");
    } finally {
      setInviting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Team Management</h1>
          <p className="text-muted-foreground">
            Manage your team members and invitations
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <UserPlus className="size-4" />
          Invite Team Member
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="size-5 text-muted-foreground" />
            <CardTitle>Team Members ({members.length})</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="size-10 mx-auto mb-3 opacity-50" />
              <p>No team members found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Login</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member, index) => {
                  const role = roleConfig[member.role] ?? roleConfig.client_user;
                  const RoleIcon = role.icon;
                  return (
                    <motion.tr
                      key={member.uid}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      className="hover:bg-muted/50 border-b transition-colors"
                    >
                      <TableCell className="font-medium">
                        {member.displayName}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {member.email}
                      </TableCell>
                      <TableCell>
                        <Badge className={role.color}>
                          <RoleIcon className="size-3" />
                          {role.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={statusConfig[member.status] ?? statusConfig.active}>
                          {member.status === "pending_invite"
                            ? "Pending"
                            : member.status.charAt(0).toUpperCase() + member.status.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {member.lastLoginAt
                          ? new Date(member.lastLoginAt).toLocaleDateString()
                          : "Never"}
                      </TableCell>
                    </motion.tr>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>
              Send an invitation to join your organization. The invite link will expire in 7 days.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="colleague@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as "client_admin" | "client_user")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client_admin">Admin - Full management access</SelectItem>
                  <SelectItem value="client_user">User - Standard access</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleInvite} disabled={inviting}>
              {inviting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UserPlus className="size-4" />
              )}
              Send Invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
