"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Phone, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/use-settings";
import { useCalls } from "@/hooks/use-calls";
import { useLeads } from "@/hooks/use-leads";
import { validateCallRequest } from "@/lib/validators";
import { VoiceSelector } from "@/components/calls/voice-selector";
import { BotConfigSelector } from "@/components/calls/bot-config-selector";
import { LeadSelector } from "@/components/calls/lead-selector";
import type { CallRequest } from "@/types/call";
import type { Lead } from "@/types/lead";
import type { BotConfig } from "@/types/bot-config";

export function CallForm() {
  const { settings } = useSettings();
  const { initiateCall } = useCalls();
  const { leads, addLead, incrementCallCount } = useLeads();
  const searchParams = useSearchParams();

  const [form, setForm] = useState<CallRequest>({
    phoneNumber: "",
    contactName: "",
    clientName: settings.defaults.clientName,
    agentName: settings.defaults.agentName,
    companyName: settings.defaults.companyName,
    eventName: settings.defaults.eventName,
    eventHost: settings.defaults.eventHost,
    voice: settings.defaults.voice,
    location: settings.defaults.location,
    botConfigId: "",
  });

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  // Read URL params (from leads table "Call" action)
  useEffect(() => {
    const phone = searchParams.get("phone");
    const name = searchParams.get("name");
    const leadId = searchParams.get("leadId");

    if (phone || name) {
      setForm((prev) => ({
        ...prev,
        ...(phone && { phoneNumber: phone }),
        ...(name && { contactName: name }),
      }));

      if (leadId) {
        setSelectedLeadId(leadId);
      }

      // Look up lead for additional fields
      if (phone) {
        const matchingLead = leads.find((l) => l.phoneNumber === phone);
        if (matchingLead) {
          if (!leadId) setSelectedLeadId(matchingLead.id);
          setForm((prev) => ({
            ...prev,
            ...(matchingLead.location && { location: matchingLead.location }),
            ...(matchingLead.company && { companyName: matchingLead.company }),
          }));
        }
      }

      // Clean URL params after reading
      window.history.replaceState({}, "", "/call-center");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateField = (field: keyof CallRequest, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleLeadSelect = (lead: Lead) => {
    setSelectedLeadId(lead.id);
    setForm((prev) => ({
      ...prev,
      phoneNumber: lead.phoneNumber,
      contactName: lead.contactName,
      ...(lead.location && { location: lead.location }),
      ...(lead.company && { companyName: lead.company }),
    }));
    setErrors({});
  };

  const handleClearLead = () => {
    setSelectedLeadId(null);
    setForm((prev) => ({
      ...prev,
      phoneNumber: "",
      contactName: "",
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validation = validateCallRequest(form, { hasBotConfig: !!form.botConfigId });
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }

    setErrors({});
    setLoading(true);

    try {
      // Resolve the lead ID
      let leadId = selectedLeadId;

      if (!leadId) {
        // Check if a lead already exists with this phone number
        const existingLead = leads.find(
          (l) => l.phoneNumber === form.phoneNumber
        );
        if (existingLead) {
          leadId = existingLead.id;
        } else {
          // Auto-create a new lead
          leadId = addLead({
            phoneNumber: form.phoneNumber,
            contactName: form.contactName,
            company: form.companyName || undefined,
            location: form.location || undefined,
            source: "manual",
          });
          toast.success("New lead created", {
            description: `${form.contactName} saved to leads`,
          });
        }
      }

      await initiateCall(form, leadId);
      incrementCallCount(leadId);

      setForm((prev) => ({
        ...prev,
        phoneNumber: "",
        contactName: "",
      }));
      setSelectedLeadId(null);
    } catch {
      // Error is already handled by the hook with toast
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Initiate Call</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Lead selector */}
          <div className="space-y-2">
            <Label>Select Lead</Label>
            <LeadSelector
              onSelectLead={handleLeadSelect}
              selectedLeadId={selectedLeadId}
            />
            {selectedLeadId && (
              <div className="flex items-center gap-1.5">
                <Badge variant="secondary" className="text-xs gap-1">
                  Lead linked
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 p-0 hover:bg-transparent"
                    onClick={handleClearLead}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              </div>
            )}
          </div>

          {/* Primary fields */}
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="contactName">Contact Name</Label>
              <Input
                id="contactName"
                placeholder="Enter contact name"
                value={form.contactName}
                onChange={(e) => updateField("contactName", e.target.value)}
              />
              {errors.contactName && (
                <p className="text-xs text-red-500">{errors.contactName}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="phoneNumber">Phone Number</Label>
              <Input
                id="phoneNumber"
                placeholder="Enter phone number"
                value={form.phoneNumber}
                onChange={(e) => updateField("phoneNumber", e.target.value)}
              />
              {errors.phoneNumber && (
                <p className="text-xs text-red-500">{errors.phoneNumber}</p>
              )}
            </div>
          </div>

          {/* Client name — always required */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="clientName" className="text-xs">
                Client Name
              </Label>
              <Input
                id="clientName"
                className="h-8 text-sm"
                value={form.clientName}
                onChange={(e) => updateField("clientName", e.target.value)}
              />
              {errors.clientName && (
                <p className="text-xs text-red-500">{errors.clientName}</p>
              )}
            </div>
          </div>

          {/* Context fields — pre-filled from bot config but always editable */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="agentName" className="text-xs">
                Agent Name
              </Label>
              <Input
                id="agentName"
                className="h-8 text-sm"
                value={form.agentName}
                onChange={(e) => updateField("agentName", e.target.value)}
              />
              {errors.agentName && (
                <p className="text-xs text-red-500">{errors.agentName}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="companyName" className="text-xs">
                Company Name
              </Label>
              <Input
                id="companyName"
                className="h-8 text-sm"
                value={form.companyName}
                onChange={(e) => updateField("companyName", e.target.value)}
              />
              {errors.companyName && (
                <p className="text-xs text-red-500">{errors.companyName}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="eventName" className="text-xs">
                Event Name
              </Label>
              <Input
                id="eventName"
                className="h-8 text-sm"
                value={form.eventName}
                onChange={(e) => updateField("eventName", e.target.value)}
              />
              {errors.eventName && (
                <p className="text-xs text-red-500">{errors.eventName}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="eventHost" className="text-xs">
                Event Host
              </Label>
              <Input
                id="eventHost"
                className="h-8 text-sm"
                value={form.eventHost}
                onChange={(e) => updateField("eventHost", e.target.value)}
              />
              {errors.eventHost && (
                <p className="text-xs text-red-500">{errors.eventHost}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="location" className="text-xs">
                Location
              </Label>
              <Input
                id="location"
                className="h-8 text-sm"
                value={form.location}
                onChange={(e) => updateField("location", e.target.value)}
              />
              {errors.location && (
                <p className="text-xs text-red-500">{errors.location}</p>
              )}
            </div>
          </div>

          {/* Voice selector */}
          <VoiceSelector
            value={form.voice}
            onChange={(value) => updateField("voice", value)}
          />
          {errors.voice && (
            <p className="text-xs text-red-500">{errors.voice}</p>
          )}

          {/* Bot config selector */}
          <BotConfigSelector
            value={form.botConfigId || ""}
            onChange={(value: string, config?: BotConfig) => {
              setForm((prev) => ({
                ...prev,
                botConfigId: value,
                ...(config?.contextVariables?.agentName && { agentName: config.contextVariables.agentName }),
                ...(config?.contextVariables?.companyName && { companyName: config.contextVariables.companyName }),
                ...(config?.contextVariables?.eventName && { eventName: config.contextVariables.eventName }),
                ...(config?.contextVariables?.eventHost && { eventHost: config.contextVariables.eventHost }),
                ...(config?.contextVariables?.location && { location: config.contextVariables.location }),
                ...(config?.voice && { voice: config.voice }),
              }));
            }}
          />

          {/* Submit button */}
          <motion.button
            type="submit"
            disabled={loading}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-all hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Initiating Call...
              </>
            ) : (
              <>
                <Phone className="h-4 w-4" />
                Initiate Call
              </>
            )}
          </motion.button>
        </form>
      </CardContent>
    </Card>
  );
}
