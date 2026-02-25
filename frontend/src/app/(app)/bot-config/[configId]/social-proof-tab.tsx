"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Plus, Trash2, Loader2, Upload, FileText } from "lucide-react";
import { toast } from "sonner";

import type { SocialProofCompany, SocialProofCity, SocialProofRole } from "@/types/social-proof";

import { generateShortId } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

async function apiSocialProof(
  user: { getIdToken: () => Promise<string> },
  method: "GET" | "POST",
  body?: Record<string, unknown>,
  configId?: string
) {
  const idToken = await user.getIdToken();
  const url = method === "GET" && configId
    ? `/api/data/social-proof?botConfigId=${configId}`
    : "/api/data/social-proof";
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

interface SocialProofTabProps {
  orgId: string;
  configId: string;
  user: { getIdToken: () => Promise<string> };
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export function SocialProofTab({ orgId, configId, user, enabled, onToggle }: SocialProofTabProps) {
  const [companies, setCompanies] = useState<SocialProofCompany[]>([]);
  const [cities, setCities] = useState<SocialProofCity[]>([]);
  const [roles, setRoles] = useState<SocialProofRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkJson, setBulkJson] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkPreview, setBulkPreview] = useState<{ companies: number; cities: number; roles: number } | null>(null);
  const bulkFileRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiSocialProof(user, "GET", undefined, configId);
      setCompanies(data.companies || []);
      setCities(data.cities || []);
      setRoles(data.roles || []);
    } catch {
      toast.error("Failed to load social proof data");
    } finally {
      setLoading(false);
    }
  }, [user, configId]);

  useEffect(() => {
    if (orgId) loadData();
  }, [orgId, loadData]);

  // Company handlers
  async function handleSaveCompany(company: SocialProofCompany) {
    try {
      setSavingId(company.id);
      await apiSocialProof(user, "POST", { action: "upsertCompany", company, botConfigId: configId });
      toast.success("Company saved");
      loadData();
    } catch {
      toast.error("Failed to save company");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDeleteCompany(id: string) {
    try {
      await apiSocialProof(user, "POST", { action: "deleteCompany", companyId: id });
      setCompanies((prev) => prev.filter((c) => c.id !== id));
      toast.success("Company deleted");
    } catch {
      toast.error("Failed to delete company");
    }
  }

  function handleAddCompany() {
    setCompanies((prev) => [
      ...prev,
      {
        id: generateShortId("comp"),
        companyName: "",
        enrollmentsCount: 0,
        notableOutcomes: "",
        trending: false,
      },
    ]);
  }

  function updateCompanyLocal(index: number, updates: Partial<SocialProofCompany>) {
    setCompanies((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...updates };
      return updated;
    });
  }

  // City handlers
  async function handleSaveCity(city: SocialProofCity) {
    try {
      setSavingId(city.id);
      await apiSocialProof(user, "POST", { action: "upsertCity", city, botConfigId: configId });
      toast.success("City saved");
      loadData();
    } catch {
      toast.error("Failed to save city");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDeleteCity(id: string) {
    try {
      await apiSocialProof(user, "POST", { action: "deleteCity", cityId: id });
      setCities((prev) => prev.filter((c) => c.id !== id));
      toast.success("City deleted");
    } catch {
      toast.error("Failed to delete city");
    }
  }

  function handleAddCity() {
    setCities((prev) => [
      ...prev,
      {
        id: generateShortId("city"),
        cityName: "",
        enrollmentsCount: 0,
        trending: false,
      },
    ]);
  }

  function updateCityLocal(index: number, updates: Partial<SocialProofCity>) {
    setCities((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...updates };
      return updated;
    });
  }

  // Role handlers
  async function handleSaveRole(role: SocialProofRole) {
    try {
      setSavingId(role.id);
      await apiSocialProof(user, "POST", { action: "upsertRole", role, botConfigId: configId });
      toast.success("Role saved");
      loadData();
    } catch {
      toast.error("Failed to save role");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDeleteRole(id: string) {
    try {
      await apiSocialProof(user, "POST", { action: "deleteRole", roleId: id });
      setRoles((prev) => prev.filter((r) => r.id !== id));
      toast.success("Role deleted");
    } catch {
      toast.error("Failed to delete role");
    }
  }

  function handleAddRole() {
    setRoles((prev) => [
      ...prev,
      {
        id: generateShortId("role"),
        roleName: "",
        enrollmentsCount: 0,
        successStories: "",
      },
    ]);
  }

  function updateRoleLocal(index: number, updates: Partial<SocialProofRole>) {
    setRoles((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...updates };
      return updated;
    });
  }

  // Bulk import handlers
  function handleBulkJsonChange(value: string) {
    setBulkJson(value);
    try {
      const parsed = JSON.parse(value);
      setBulkPreview({
        companies: Array.isArray(parsed.companies) ? parsed.companies.length : 0,
        cities: Array.isArray(parsed.cities) ? parsed.cities.length : 0,
        roles: Array.isArray(parsed.roles) ? parsed.roles.length : 0,
      });
    } catch {
      setBulkPreview(null);
    }
  }

  function handleBulkFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => handleBulkJsonChange(reader.result as string);
    reader.readAsText(file);
    if (bulkFileRef.current) bulkFileRef.current.value = "";
  }

  async function handleBulkImport() {
    if (!bulkPreview) {
      toast.error("Please provide valid JSON");
      return;
    }
    try {
      setBulkImporting(true);
      const parsed = JSON.parse(bulkJson);
      await apiSocialProof(user, "POST", { action: "bulkImport", data: parsed, botConfigId: configId });
      toast.success(`Imported ${bulkPreview.companies} companies, ${bulkPreview.cities} cities, ${bulkPreview.roles} roles`);
      setBulkDialogOpen(false);
      setBulkJson("");
      setBulkPreview(null);
      loadData();
    } catch {
      toast.error("Bulk import failed");
    } finally {
      setBulkImporting(false);
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
            <p className="font-medium">Social Proof Engine</p>
            <p className="text-sm text-muted-foreground">
              Enable social proof data during calls
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={onToggle} />
        </CardContent>
      </Card>

      {/* Sub-tabs */}
      <Tabs defaultValue="companies">
        <div className="flex items-center justify-between">
          <TabsList variant="line">
            <TabsTrigger value="companies">Companies</TabsTrigger>
            <TabsTrigger value="cities">Cities</TabsTrigger>
            <TabsTrigger value="roles">Roles</TabsTrigger>
          </TabsList>
          <Button variant="outline" size="sm" onClick={() => setBulkDialogOpen(true)}>
            <Upload className="size-3.5" />
            Bulk Import
          </Button>
        </div>

        {/* Bulk Import Dialog */}
        <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Bulk Import Social Proof</DialogTitle>
              <DialogDescription>
                Paste JSON or upload a .json file with companies, cities, and roles data.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => bulkFileRef.current?.click()}>
                  <FileText className="size-3.5" />
                  Upload JSON File
                </Button>
                <input
                  ref={bulkFileRef}
                  type="file"
                  accept=".json"
                  onChange={handleBulkFileSelect}
                  className="hidden"
                />
              </div>
              <Textarea
                value={bulkJson}
                onChange={(e) => handleBulkJsonChange(e.target.value)}
                rows={10}
                className="text-xs font-mono"
                placeholder={`{\n  "companies": [{"company_name": "TCS", "enrollments_count": 150}],\n  "cities": [{"city_name": "Mumbai", "enrollments_count": 500}],\n  "roles": [{"role_name": "Developer", "enrollments_count": 200}]\n}`}
              />
              {bulkPreview && (
                <div className="flex gap-3 text-sm">
                  <span className="text-muted-foreground">Preview:</span>
                  <span>{bulkPreview.companies} companies</span>
                  <span>{bulkPreview.cities} cities</span>
                  <span>{bulkPreview.roles} roles</span>
                </div>
              )}
              {bulkJson && !bulkPreview && (
                <p className="text-xs text-red-500">Invalid JSON format</p>
              )}
              <Button
                onClick={handleBulkImport}
                disabled={bulkImporting || !bulkPreview}
                className="w-full"
              >
                {bulkImporting ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {bulkImporting ? "Importing..." : "Import Data"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Companies */}
        <TabsContent value="companies" className="space-y-4 mt-4">
          {companies.map((c, index) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.02 }}
            >
              <Card>
                <CardContent className="space-y-3 pt-0">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Company Name</Label>
                          <Input
                            value={c.companyName}
                            onChange={(e) => updateCompanyLocal(index, { companyName: e.target.value })}
                            className="h-8"
                            placeholder="e.g. TCS"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Enrollments Count</Label>
                          <Input
                            type="number"
                            value={c.enrollmentsCount}
                            onChange={(e) => updateCompanyLocal(index, { enrollmentsCount: parseInt(e.target.value) || 0 })}
                            className="h-8"
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Notable Outcomes</Label>
                        <Textarea
                          value={c.notableOutcomes || ""}
                          onChange={(e) => updateCompanyLocal(index, { notableOutcomes: e.target.value })}
                          rows={2}
                          className="text-sm"
                          placeholder="Notable outcomes from this company..."
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={c.trending || false}
                          onCheckedChange={(checked) => updateCompanyLocal(index, { trending: checked })}
                          size="sm"
                        />
                        <Label className="text-xs text-muted-foreground">Trending</Label>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 mt-5">
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => handleSaveCompany(c)}
                        disabled={savingId === c.id}
                      >
                        {savingId === c.id ? <Loader2 className="size-4 animate-spin" /> : "Save"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDeleteCompany(c.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
          <Button variant="outline" onClick={handleAddCompany} className="w-full">
            <Plus className="size-4" />
            Add Company
          </Button>
        </TabsContent>

        {/* Cities */}
        <TabsContent value="cities" className="space-y-4 mt-4">
          {cities.map((c, index) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.02 }}
            >
              <Card>
                <CardContent className="space-y-3 pt-0">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">City Name</Label>
                          <Input
                            value={c.cityName}
                            onChange={(e) => updateCityLocal(index, { cityName: e.target.value })}
                            className="h-8"
                            placeholder="e.g. Hyderabad"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Enrollments Count</Label>
                          <Input
                            type="number"
                            value={c.enrollmentsCount}
                            onChange={(e) => updateCityLocal(index, { enrollmentsCount: parseInt(e.target.value) || 0 })}
                            className="h-8"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={c.trending || false}
                          onCheckedChange={(checked) => updateCityLocal(index, { trending: checked })}
                          size="sm"
                        />
                        <Label className="text-xs text-muted-foreground">Trending</Label>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 mt-5">
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => handleSaveCity(c)}
                        disabled={savingId === c.id}
                      >
                        {savingId === c.id ? <Loader2 className="size-4 animate-spin" /> : "Save"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDeleteCity(c.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
          <Button variant="outline" onClick={handleAddCity} className="w-full">
            <Plus className="size-4" />
            Add City
          </Button>
        </TabsContent>

        {/* Roles */}
        <TabsContent value="roles" className="space-y-4 mt-4">
          {roles.map((r, index) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.02 }}
            >
              <Card>
                <CardContent className="space-y-3 pt-0">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Role Name</Label>
                          <Input
                            value={r.roleName}
                            onChange={(e) => updateRoleLocal(index, { roleName: e.target.value })}
                            className="h-8"
                            placeholder="e.g. Software Engineer"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Enrollments Count</Label>
                          <Input
                            type="number"
                            value={r.enrollmentsCount}
                            onChange={(e) => updateRoleLocal(index, { enrollmentsCount: parseInt(e.target.value) || 0 })}
                            className="h-8"
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Success Stories</Label>
                        <Textarea
                          value={r.successStories || ""}
                          onChange={(e) => updateRoleLocal(index, { successStories: e.target.value })}
                          rows={2}
                          className="text-sm"
                          placeholder="Success stories for this role..."
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 mt-5">
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => handleSaveRole(r)}
                        disabled={savingId === r.id}
                      >
                        {savingId === r.id ? <Loader2 className="size-4 animate-spin" /> : "Save"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDeleteRole(r.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
          <Button variant="outline" onClick={handleAddRole} className="w-full">
            <Plus className="size-4" />
            Add Role
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}
