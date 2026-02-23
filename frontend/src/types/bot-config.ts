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

export interface BotContextVariables {
  agentName?: string;
  companyName?: string;
  eventName?: string;
  eventHost?: string;
  location?: string;
  customVariables?: Record<string, string>;
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
  voice?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}
