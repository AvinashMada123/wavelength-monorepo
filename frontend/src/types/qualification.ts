export type QualificationLevel = "HOT" | "WARM" | "COLD";

export interface QualificationResult {
  level: QualificationLevel;
  confidence: number;
  reasoning: string;
  painPoints: string[];
  keyInsights: string[];
  recommendedAction: string;
  objectionAnalysis: {
    objection: string;
    severity: "high" | "medium" | "low";
    suggestedResponse: string;
  }[];
  qualifiedAt: string;
}

export const QUESTION_CATEGORY_MAP: Record<string, string> = {
  greeting: "rapport",
  opening: "rapport",
  current_work: "professional_status",
  registration_reason: "intent",
  ai_usage: "technical_readiness",
  ai_rating: "technical_readiness",
  ai_challenges: "pain_points",
  job_market_reality: "pain_points",
  what_theyve_tried: "effort_level",
  future_consequence: "urgency",
  goal_6months: "goal_clarity",
  long_term_goal: "goal_clarity",
  roadmap: "commitment",
  decision_authority: "decision_making",
  timeline: "urgency",
  callback_booking: "conversion_intent",
  closing: "rapport",
};

export const HIGH_SIGNAL_QUESTIONS = [
  "current_work",
  "ai_challenges",
  "job_market_reality",
  "future_consequence",
  "goal_6months",
  "decision_authority",
  "timeline",
  "callback_booking",
] as const;
