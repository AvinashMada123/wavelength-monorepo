import type { BotConfig } from "@/types/bot-config";
import { DEFAULT_BOT_CONFIG } from "@/lib/default-bot-config";

const FORMAT_VERSION = "wavelength-bot-config-v1";

/**
 * Strip internal fields and produce a portable JSON-safe object.
 */
export function exportBotConfig(config: BotConfig): Record<string, unknown> {
  return {
    _format: FORMAT_VERSION,
    name: config.name,
    prompt: config.prompt,
    questions: config.questions,
    objections: config.objections,
    objectionKeywords: config.objectionKeywords,
    contextVariables: config.contextVariables,
    qualificationCriteria: config.qualificationCriteria,
    personaEngineEnabled: config.personaEngineEnabled ?? false,
    productIntelligenceEnabled: config.productIntelligenceEnabled ?? false,
    socialProofEnabled: config.socialProofEnabled ?? false,
    socialProofMinTurn: config.socialProofMinTurn ?? 0,
    preResearchEnabled: config.preResearchEnabled ?? false,
    memoryRecallEnabled: config.memoryRecallEnabled ?? false,
    maxCallDuration: config.maxCallDuration ?? 480,
    ghlWorkflows: config.ghlWorkflows ?? [],
    voice: config.voice ?? "",
    responseGuidelines: config.responseGuidelines ?? "",
    ttsFormattingRules: config.ttsFormattingRules ?? "",
    inactivityTimeoutSeconds: config.inactivityTimeoutSeconds,
  };
}

/**
 * Build a template using the default bot config with sample related data.
 */
export function buildTemplate(): Record<string, unknown> {
  return {
    _format: FORMAT_VERSION,
    ...DEFAULT_BOT_CONFIG,
    personas: [
      { name: "Working Professional", content: "This person is a working professional looking to upskill. Focus on career growth, ROI, and time-efficient learning. Mention how {company_name} helps professionals like them.", keywords: ["engineer", "developer", "manager", "corporate", "salary"] },
      { name: "Business Owner", content: "This person runs their own business. Focus on AI for business automation, cost savings, and competitive advantage.", keywords: ["business", "founder", "startup", "entrepreneur", "company"] },
    ],
    situations: [
      { name: "Price Concern", content: "The prospect is worried about pricing. Focus on value, ROI, and payment flexibility. Never discount immediately.", keywords: ["expensive", "costly", "budget", "afford", "price"] },
      { name: "High Interest", content: "The prospect is showing strong buying signals. Guide them toward booking and next steps. Don't oversell.", keywords: ["interested", "sign up", "enroll", "join", "start"] },
    ],
    productSections: [
      { name: "Overview", content: "{company_name} offers AI-powered upskilling programs designed for working professionals.", keywords: [] },
      { name: "Pricing", content: "Gold Plan: Full access with mentorship. Silver Plan: Self-paced learning.", keywords: [] },
    ],
    socialProof: {
      companies: [{ name: "Google", count: 45 }, { name: "Microsoft", count: 38 }],
      cities: [{ name: "Hyderabad", count: 120 }, { name: "Bangalore", count: 95 }],
      roles: [{ name: "Software Engineer", count: 200 }, { name: "Product Manager", count: 85 }],
    },
  };
}

/**
 * Validate an imported JSON object and return a sanitised partial config
 * merged with defaults for any missing fields.
 */
export function validateImportedConfig(
  data: unknown
): { valid: boolean; errors: string[]; config: Omit<BotConfig, "id" | "createdAt" | "updatedAt" | "createdBy"> } {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["File is not a valid JSON object"], config: buildDefaults() };
  }

  const obj = data as Record<string, unknown>;

  // Format check (warn but don't block — allow raw JSON too)
  if (obj._format && obj._format !== FORMAT_VERSION) {
    errors.push(`Unknown format "${obj._format}" — importing anyway`);
  }

  // Required: prompt must be a non-empty string
  if (!obj.prompt || typeof obj.prompt !== "string") {
    errors.push("Missing or invalid 'prompt' field (must be a non-empty string)");
  }

  // Required: questions must be an array
  if (obj.questions !== undefined && !Array.isArray(obj.questions)) {
    errors.push("'questions' must be an array");
  }

  if (obj.objections !== undefined && !Array.isArray(obj.objections)) {
    errors.push("'objections' must be an array");
  }

  const hasBlockingErrors = errors.some(
    (e) => e.startsWith("Missing") || e.includes("must be")
  );

  // Merge with defaults — use ternary to avoid spreading `false`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const o = obj as Record<string, any>;
  const config = {
    ...buildDefaults(),
    ...(typeof o.name === "string" ? { name: o.name } : {}),
    ...(typeof o.prompt === "string" ? { prompt: o.prompt } : {}),
    ...(Array.isArray(o.questions) ? { questions: o.questions } : {}),
    ...(Array.isArray(o.objections) ? { objections: o.objections } : {}),
    ...(o.objectionKeywords && typeof o.objectionKeywords === "object" ? { objectionKeywords: o.objectionKeywords } : {}),
    ...(o.contextVariables && typeof o.contextVariables === "object" ? { contextVariables: o.contextVariables } : {}),
    ...(o.qualificationCriteria && typeof o.qualificationCriteria === "object" ? { qualificationCriteria: o.qualificationCriteria } : {}),
    ...(typeof o.personaEngineEnabled === "boolean" ? { personaEngineEnabled: o.personaEngineEnabled } : {}),
    ...(typeof o.productIntelligenceEnabled === "boolean" ? { productIntelligenceEnabled: o.productIntelligenceEnabled } : {}),
    ...(typeof o.socialProofEnabled === "boolean" ? { socialProofEnabled: o.socialProofEnabled } : {}),
    ...(typeof o.socialProofMinTurn === "number" ? { socialProofMinTurn: o.socialProofMinTurn } : {}),
    ...(typeof o.preResearchEnabled === "boolean" ? { preResearchEnabled: o.preResearchEnabled } : {}),
    ...(typeof o.memoryRecallEnabled === "boolean" ? { memoryRecallEnabled: o.memoryRecallEnabled } : {}),
    ...(typeof o.maxCallDuration === "number" ? { maxCallDuration: o.maxCallDuration } : {}),
    ...(Array.isArray(o.ghlWorkflows) ? { ghlWorkflows: o.ghlWorkflows } : {}),
    ...(typeof o.voice === "string" ? { voice: o.voice } : {}),
    ...(typeof o.responseGuidelines === "string" ? { responseGuidelines: o.responseGuidelines } : {}),
    ...(typeof o.ttsFormattingRules === "string" ? { ttsFormattingRules: o.ttsFormattingRules } : {}),
    ...(typeof o.inactivityTimeoutSeconds === "number" ? { inactivityTimeoutSeconds: o.inactivityTimeoutSeconds } : {}),
  };

  return { valid: !hasBlockingErrors, errors, config };
}

function buildDefaults(): Omit<BotConfig, "id" | "createdAt" | "updatedAt" | "createdBy"> {
  return { ...DEFAULT_BOT_CONFIG, isActive: false };
}

/**
 * Trigger a browser download of a JSON object.
 */
export function downloadJson(data: object, filename: string) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
