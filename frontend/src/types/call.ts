export interface CallRequest {
  phoneNumber: string;
  contactName: string;
  clientName: string;
  agentName: string;
  companyName: string;
  eventName: string;
  eventHost: string;
  voice: string;
  location: string;
  botConfigId?: string;
}

export interface CallResponse {
  success: boolean;
  call_uuid: string;
  message: string;
}

import type { QualificationResult } from "./qualification";

export interface CallEndedData {
  call_uuid: string;
  caller_phone: string;
  contact_name: string;
  client_name: string;
  duration_seconds: number;
  timestamp: string;
  questions_completed: number;
  total_questions: number;
  completion_rate: number;
  interest_level: string;
  call_summary: string;
  objections_raised: string[];
  collected_responses: Record<string, string>;
  question_pairs: QuestionPair[];
  call_metrics: CallMetrics;
  transcript: string;
  transcript_entries?: Array<{ role: string; text: string; timestamp: string }>;
  recording_url?: string;
  qualification?: QualificationResult;
  triggered_persona?: string;
  triggered_situations?: string[];
  triggered_product_sections?: string[];
  social_proof_used?: boolean;
  no_answer?: boolean;
}

export interface QuestionPair {
  question_id: string;
  question_text: string;
  agent_said: string;
  user_said: string;
  duration_seconds: number;
  response_latency_ms: number;
}

export interface CallMetrics {
  questions_completed: number;
  total_duration_s: number;
  avg_latency_ms: number;
  max_latency_ms: number;
  min_latency_ms: number;
  p90_latency_ms: number;
  total_nudges: number;
}

export interface CallRecord {
  id: string;
  callUuid: string;
  leadId?: string;
  request: CallRequest;
  response?: CallResponse;
  status: CallStatus;
  initiatedAt: string;
  notes?: string;
  endedData?: CallEndedData;
  durationSeconds?: number;
  interestLevel?: string;
  completionRate?: number;
  callSummary?: string;
  botConfigId?: string;
  botConfigName?: string;
}

export type CallStatus =
  | "initiating"
  | "in-progress"
  | "completed"
  | "failed"
  | "no-answer";
