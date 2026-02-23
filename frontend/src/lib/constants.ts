import type { AppSettings } from "@/types/settings";

export const VOICE_OPTIONS = [
  { value: "Puck", label: "Puck", description: "Natural and conversational" },
  { value: "Alloy", label: "Alloy", description: "Neutral and balanced" },
  { value: "Echo", label: "Echo", description: "Warm and rounded" },
  { value: "Nova", label: "Nova", description: "Friendly and upbeat" },
  { value: "Shimmer", label: "Shimmer", description: "Clear and crisp" },
  { value: "Onyx", label: "Onyx", description: "Deep and authoritative" },
] as const;

export const LEAD_STATUS_CONFIG = {
  new: {
    label: "New",
    color: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  },
  contacted: {
    label: "Contacted",
    color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  },
  qualified: {
    label: "Qualified",
    color: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  },
  unresponsive: {
    label: "Unresponsive",
    color: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  },
  "do-not-call": {
    label: "Do Not Call",
    color: "bg-red-500/15 text-red-400 border-red-500/20",
  },
} as const;

export const CALL_STATUS_CONFIG = {
  initiating: {
    label: "Initiating",
    color: "bg-blue-500/15 text-blue-400",
  },
  "in-progress": {
    label: "In Progress",
    color: "bg-emerald-500/15 text-emerald-400",
  },
  completed: {
    label: "Completed",
    color: "bg-green-500/15 text-green-400",
  },
  failed: {
    label: "Failed",
    color: "bg-red-500/15 text-red-400",
  },
  "no-answer": {
    label: "No Answer",
    color: "bg-amber-500/15 text-amber-400",
  },
} as const;

export const QUALIFICATION_LEVEL_CONFIG = {
  HOT: {
    label: "Hot",
    color: "bg-red-500/15 text-red-400 border-red-500/20",
  },
  WARM: {
    label: "Warm",
    color: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  },
  COLD: {
    label: "Cold",
    color: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  },
} as const;

export const DEFAULT_SETTINGS: AppSettings = {
  defaults: {
    clientName: "fwai",
    agentName: "",
    companyName: "",
    eventName: "",
    eventHost: "",
    voice: "",
    location: "",
  },
  webhookUrl: "https://n8n.srv1100770.hstgr.cloud/webhook/start-call",
  ghlWhatsappWebhookUrl: "",
  ghlApiKey: "",
  ghlLocationId: "",
  plivoAuthId: "",
  plivoAuthToken: "",
  plivoPhoneNumber: "",
  appearance: {
    sidebarCollapsed: false,
    animationsEnabled: true,
  },
  ai: {
    autoQualify: true,
  },
  ghlSyncEnabled: false,
  ghlLastSyncAt: "",
};

export const MAPPABLE_FIELDS = [
  { value: "phoneNumber", label: "Phone Number", required: true },
  { value: "contactName", label: "Contact Name", required: true },
  { value: "email", label: "Email", required: false },
  { value: "company", label: "Company", required: false },
  { value: "location", label: "Location", required: false },
  { value: "skip", label: "-- Skip this column --", required: false },
] as const;

export const ITEMS_PER_PAGE = 20;
