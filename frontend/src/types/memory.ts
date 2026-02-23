export interface LinguisticStyle {
  formality?: string;
  language?: string;
  vocabulary?: string;
  verbosity?: string;
  engagement?: string;
}

export interface ContactMemory {
  phone: string;
  name?: string;
  persona?: string;
  company?: string;
  role?: string;
  objections?: string[];
  interestAreas?: string[];
  keyFacts?: string[];
  callCount?: number;
  lastCallDate?: string;
  lastCallSummary?: string;
  lastCallOutcome?: string;
  allCallUuids?: string[];
  linguisticStyle?: LinguisticStyle;
  createdAt?: string;
  updatedAt?: string;
}
