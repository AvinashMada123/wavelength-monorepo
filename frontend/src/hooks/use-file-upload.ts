"use client";

import { useState, useCallback } from "react";
import type { ParsedFileData, ColumnMapping } from "@/types/lead";
import { parseFile } from "@/lib/parsers";

export type UploadStep =
  | "idle"
  | "parsing"
  | "mapping"
  | "preview"
  | "importing"
  | "complete"
  | "error";

export function useFileUpload() {
  const [step, setStep] = useState<UploadStep>("idle");
  const [parsedData, setParsedData] = useState<ParsedFileData | null>(null);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const autoMapColumns = (headers: string[]): ColumnMapping => {
    const mapping: ColumnMapping = {};
    for (const header of headers) {
      const h = header.toLowerCase();
      if (h.includes("phone") || h.includes("mobile") || h.includes("tel")) {
        mapping[header] = "phoneNumber";
      } else if (h.includes("name") && !h.includes("company") && !h.includes("agent") && !h.includes("client")) {
        mapping[header] = "contactName";
      } else if (h.includes("email") || h.includes("mail")) {
        mapping[header] = "email";
      } else if (h.includes("company") || h.includes("org")) {
        mapping[header] = "company";
      } else if (h.includes("location") || h.includes("city") || h.includes("address")) {
        mapping[header] = "location";
      } else {
        mapping[header] = "skip";
      }
    }
    return mapping;
  };

  const handleFile = useCallback(async (file: File) => {
    setStep("parsing");
    setError(null);
    try {
      const data = await parseFile(file);
      setParsedData(data);
      setColumnMapping(autoMapColumns(data.headers));
      setStep("mapping");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse file");
      setStep("error");
    }
  }, []);

  const confirmMapping = useCallback(() => {
    const mapped = Object.values(columnMapping);
    if (!mapped.includes("phoneNumber")) {
      setError("Phone Number must be mapped");
      return false;
    }
    if (!mapped.includes("contactName")) {
      setError("Contact Name must be mapped");
      return false;
    }
    setError(null);
    setStep("preview");
    return true;
  }, [columnMapping]);

  const reset = useCallback(() => {
    setStep("idle");
    setParsedData(null);
    setColumnMapping({});
    setError(null);
    setProgress(0);
  }, []);

  return {
    step,
    setStep,
    parsedData,
    columnMapping,
    setColumnMapping,
    error,
    setError,
    progress,
    setProgress,
    handleFile,
    confirmMapping,
    reset,
  };
}
