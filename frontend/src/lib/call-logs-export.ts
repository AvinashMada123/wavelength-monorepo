import type { CallRecord } from "@/types/call";

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const HEADERS = [
  "Contact Name",
  "Phone",
  "Bot Config",
  "Status",
  "Duration (s)",
  "Interest Level",
  "Completion Rate (%)",
  "Call Summary",
  "Approach",
  "Voice",
  "TTS Provider",
  "Language",
  "Prompt Length",
  "Max Duration (s)",
  "Initiated At",
  "Completed At",
  "Call UUID",
  "Qualification Level",
  "Objections Raised",
  "Tags",
  "Transcript",
];

function callToRow(call: CallRecord): string[] {
  const ed = call.endedData;
  const tc = call.techConfig;
  return [
    call.request.contactName || "",
    call.request.phoneNumber || "",
    call.botConfigName || call.request.botConfigName || "",
    call.status,
    call.durationSeconds?.toString() || "",
    call.interestLevel || "",
    call.completionRate != null ? call.completionRate.toString() : "",
    call.callSummary || "",
    tc?.approach === "live_api" ? "Live API" : tc?.approach || "",
    tc?.voice || "",
    tc?.ttsProvider || "",
    tc?.language || "",
    tc?.promptLength?.toString() || "",
    tc?.maxCallDuration?.toString() || "",
    formatDate(call.initiatedAt),
    ed?.timestamp ? formatDate(ed.timestamp) : "",
    call.callUuid || "",
    ed?.qualification?.level || "",
    ed?.objections_raised?.join("; ") || "",
    call.leadTags?.join("; ") || "",
    ed?.transcript || "",
  ];
}

export function exportCallsCSV(calls: CallRecord[]) {
  const rows = [
    HEADERS.map(escapeCsv).join(","),
    ...calls.map((c) => callToRow(c).map(escapeCsv).join(",")),
  ];
  const csv = rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `call-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
