export interface BotQuestion {
  id: string;
  prompt: string;
  category?: string;
  isHighSignal?: boolean;
  order: number;
}

export interface BotObjection {
  key: string;
  response: string;
  keywords: string[];
}

export interface GhlWorkflow {
  id: string;
  name: string;
  description: string;
  tag: string;
  timing: "pre_call" | "during_call" | "post_call";
  enabled: boolean;
}

export interface BotContextVariables {
  agentName?: string;
  companyName?: string;
  eventName?: string;
  eventHost?: string;
  location?: string;
  customVariables?: Record<string, string>;
}

export interface MicroMomentsConfig {
  enabled: boolean;
  min_turns_for_detection?: number;
  strategy_cooldown_turns?: number;
  disabled_moments?: string[];
  hints?: Record<string, string>;
}

export interface BotConfig {
  id: string;
  name: string;
  isActive: boolean;
  prompt: string;
  questions: BotQuestion[];
  objections: BotObjection[];
  objectionKeywords: Record<string, string[]>;
  contextVariables?: BotContextVariables;
  qualificationCriteria: {
    hot: string;
    warm: string;
    cold: string;
  };
  personaEngineEnabled?: boolean;
  productIntelligenceEnabled?: boolean;
  socialProofEnabled?: boolean;
  preResearchEnabled?: boolean;
  memoryRecallEnabled?: boolean;
  maxCallDuration?: number;
  ghlWorkflows?: GhlWorkflow[];
  voice?: string;
  microMomentsConfig?: MicroMomentsConfig | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}
