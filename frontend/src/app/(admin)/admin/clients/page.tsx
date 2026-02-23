"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Building2, Search, Loader2, ExternalLink, Plus } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import type { Organization } from "@/types/user";

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

export default function AdminClientsPage() {
  const router = useRouter();
  const { isSuperAdmin, user } = useAuth();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgPlan, setNewOrgPlan] = useState("free");
  const [newOrgEmail, setNewOrgEmail] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;
    loadOrgs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin]);

  async function loadOrgs() {
    try {
      setLoading(true);
      const idToken = await user!.getIdToken();
      const res = await fetch("/api/admin/organizations", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setOrgs(data.organizations || []);
    } catch {
      toast.error("Failed to load organizations");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateOrg() {
    if (!newOrgName.trim()) {
      toast.error("Organization name is required");
      return;
    }
    try {
      setCreating(true);
      const idToken = await user!.getIdToken();
      const res = await fetch("/api/admin/organizations", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          orgName: newOrgName.trim(),
          plan: newOrgPlan,
          adminEmail: newOrgEmail.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create organization");
      }
      const data = await res.json();
      toast.success(`Organization "${newOrgName}" created`);
      if (data.inviteId && newOrgEmail) {
        toast.success(`Invite sent to ${newOrgEmail}`, {
          description: `Invite link: ${window.location.origin}/invite/${data.inviteId}`,
        });
      }
      setCreateOpen(false);
      setNewOrgName("");
      setNewOrgPlan("free");
      setNewOrgEmail("");
      loadOrgs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create organization");
    } finally {
      setCreating(false);
    }
  }

  const filteredOrgs = orgs.filter((org) =>
    org.name.toLowerCase().includes(search.toLowerCase()) ||
    org.slug.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Client Organizations</h1>
          <p className="text-muted-foreground">View and manage all organizations on the platform</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          Add Client
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="size-5 text-muted-foreground" />
              <CardTitle>Organizations ({filteredOrgs.length})</CardTitle>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input placeholder="Search organizations..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredOrgs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Building2 className="size-10 mx-auto mb-3 opacity-50" />
              <p>{search ? "No organizations match your search" : "No organizations found"}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization Name</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created Date</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrgs.map((org, index) => (
                  <motion.tr key={org.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }} className="hover:bg-muted/50 border-b transition-colors cursor-pointer" onClick={() => router.push(`/admin/clients/${org.id}`)}>
                    <TableCell className="font-medium">{org.name}</TableCell>
                    <TableCell><Badge className={planColors[org.plan] ?? planColors.free}>{org.plan.charAt(0).toUpperCase() + org.plan.slice(1)}</Badge></TableCell>
                    <TableCell><Badge className={statusColors[org.status] ?? statusColors.active}>{org.status.charAt(0).toUpperCase() + org.status.slice(1)}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{new Date(org.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/admin/clients/${org.id}`); }}>
                        <ExternalLink className="size-3.5" />View
                      </Button>
                    </TableCell>
                  </motion.tr>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Organization</DialogTitle>
            <DialogDescription>Set up a new client organization. Optionally invite an admin.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="org-name">Organization Name</Label>
              <Input id="org-name" placeholder="Acme Corp" value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Plan</Label>
              <Select value={newOrgPlan} onValueChange={setNewOrgPlan}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-email">Admin Email (optional)</Label>
              <Input id="admin-email" type="email" placeholder="admin@acmecorp.com" value={newOrgEmail} onChange={(e) => setNewOrgEmail(e.target.value)} />
              <p className="text-xs text-muted-foreground">An invite link will be created. Share it with the recipient to let them sign up as the org admin.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateOrg} disabled={creating}>
              {creating && <Loader2 className="size-4 animate-spin" />}
              Create Organization
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
