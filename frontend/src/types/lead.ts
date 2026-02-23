import type { QualificationLevel } from "./qualification";

export interface Lead {
  id: string;
  phoneNumber: string;
  contactName: string;
  email?: string;
  company?: string;
  location?: string;
  tags?: string[];
  status: LeadStatus;
  callCount: number;
  lastCallDate?: string;
  createdAt: string;
  updatedAt: string;
  source: "manual" | "csv" | "excel" | "ghl";
  ghlContactId?: string;
  qualificationLevel?: QualificationLevel;
  qualificationConfidence?: number;
  lastQualifiedAt?: string;
  botNotes?: string;
}

export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "unresponsive"
  | "do-not-call";

export interface CustomFilter {
  column: string;
  value: string;
}

export interface LeadFilters {
  search: string;
  status: LeadStatus | "all";
  source: Lead["source"] | "all";
  tag: string;
  customFilters: CustomFilter[];
}

export interface ColumnMapping {
  [csvColumn: string]: keyof Lead | "skip";
}

export interface ParsedFileData {
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
  fileName: string;
  fileType: "csv" | "excel";
}
