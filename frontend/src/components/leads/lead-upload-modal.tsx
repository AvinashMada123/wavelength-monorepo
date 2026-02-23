"use client";

import { useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, FileSpreadsheet, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UploadDropzone } from "@/components/leads/upload-dropzone";
import { ColumnMapper } from "@/components/leads/column-mapper";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useLeads } from "@/hooks/use-leads";
import type { Lead } from "@/types/lead";

interface LeadUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LeadUploadModal({ open, onOpenChange }: LeadUploadModalProps) {
  const {
    step,
    setStep,
    parsedData,
    columnMapping,
    setColumnMapping,
    error,
    progress,
    setProgress,
    handleFile,
    confirmMapping,
    reset,
  } = useFileUpload();

  const { addLeadsBulk } = useLeads();
  const animationFrameRef = useRef<number | null>(null);

  const getMappedLeads = useCallback((): Partial<Lead>[] => {
    if (!parsedData) return [];

    return parsedData.rows.map((row) => {
      const lead: Partial<Lead> = {};
      for (const [csvCol, leadField] of Object.entries(columnMapping)) {
        if (leadField !== "skip" && row[csvCol] !== undefined) {
          (lead as Record<string, string>)[leadField] = row[csvCol];
        }
      }
      return lead;
    });
  }, [parsedData, columnMapping]);

  const getPreviewRows = useCallback(() => {
    if (!parsedData) return [];
    const mappedFields = Object.entries(columnMapping).filter(
      ([, value]) => value !== "skip"
    );
    return parsedData.rows.slice(0, 5).map((row) => {
      const mapped: Record<string, string> = {};
      for (const [csvCol, leadField] of mappedFields) {
        mapped[leadField] = row[csvCol] || "";
      }
      return mapped;
    });
  }, [parsedData, columnMapping]);

  const getPreviewHeaders = useCallback(() => {
    return Object.entries(columnMapping)
      .filter(([, value]) => value !== "skip")
      .map(([, value]) => value);
  }, [columnMapping]);

  const startImport = useCallback(() => {
    setStep("importing");
    setProgress(0);

    const mappedLeads = getMappedLeads();
    const source = parsedData?.fileType === "excel" ? "excel" : "csv";

    try {
      addLeadsBulk(mappedLeads, source);
    } catch {
      setStep("error");
      return;
    }

    const startTime = performance.now();
    const duration = 1500;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const newProgress = Math.min((elapsed / duration) * 100, 100);
      setProgress(Math.round(newProgress));

      if (newProgress < 100) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        setStep("complete");
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);
  }, [getMappedLeads, parsedData, addLeadsBulk, setStep, setProgress]);

  const handleClose = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    reset();
    onOpenChange(false);
  };

  const getTitle = () => {
    switch (step) {
      case "idle":
      case "parsing":
        return "Import Leads";
      case "mapping":
        return "Map Columns";
      case "preview":
        return "Preview Import";
      case "importing":
        return "Importing...";
      case "complete":
        return "Import Complete";
      case "error":
        return "Import Error";
      default:
        return "Import Leads";
    }
  };

  const getDescription = () => {
    switch (step) {
      case "idle":
        return "Upload a CSV or Excel file to import leads";
      case "parsing":
        return "Parsing your file...";
      case "mapping":
        return `Map columns from "${parsedData?.fileName}" to lead fields`;
      case "preview":
        return `Review the data before importing`;
      case "importing":
        return "Please wait while we import your leads";
      case "complete":
        return "Your leads have been imported successfully";
      case "error":
        return "Something went wrong during the import";
      default:
        return "";
    }
  };

  const previewHeaders = getPreviewHeaders();
  const previewRows = getPreviewRows();

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
          <DialogDescription>{getDescription()}</DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {(step === "idle" || step === "parsing") && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <UploadDropzone onFile={handleFile} />
              {step === "parsing" && (
                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <FileSpreadsheet className="h-4 w-4 animate-pulse" />
                  Parsing file...
                </div>
              )}
            </motion.div>
          )}

          {step === "mapping" && parsedData && (
            <motion.div
              key="mapping"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <ColumnMapper
                headers={parsedData.headers}
                mapping={columnMapping}
                onMappingChange={setColumnMapping}
              />

              {error && (
                <p className="mt-2 text-sm text-red-500">{error}</p>
              )}

              <DialogFooter className="mt-4">
                <Button variant="outline" onClick={reset}>
                  Back
                </Button>
                <Button onClick={() => confirmMapping()}>Continue</Button>
              </DialogFooter>
            </motion.div>
          )}

          {step === "preview" && parsedData && (
            <motion.div
              key="preview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {previewHeaders.map((header) => (
                        <TableHead key={header} className="capitalize">
                          {header.replace(/([A-Z])/g, " $1").trim()}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.map((row, idx) => (
                      <TableRow key={idx}>
                        {previewHeaders.map((header) => (
                          <TableCell key={header}>
                            {row[header] || "-"}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <p className="mt-3 text-sm text-muted-foreground">
                Ready to import{" "}
                <span className="font-semibold text-foreground">
                  {parsedData.totalRows}
                </span>{" "}
                leads
              </p>

              <DialogFooter className="mt-4">
                <Button variant="outline" onClick={() => setStep("mapping")}>
                  Back
                </Button>
                <Button onClick={startImport}>Import</Button>
              </DialogFooter>
            </motion.div>
          )}

          {step === "importing" && (
            <motion.div
              key="importing"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col items-center gap-4 py-8"
            >
              <Progress value={progress} className="w-full" />
              <p className="text-sm text-muted-foreground">
                Importing... {progress}%
              </p>
            </motion.div>
          )}

          {step === "complete" && (
            <motion.div
              key="complete"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col items-center gap-4 py-8"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 260,
                  damping: 20,
                  delay: 0.1,
                }}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/15"
              >
                <Check className="h-8 w-8 text-green-500" />
              </motion.div>
              <p className="text-sm font-medium">
                {parsedData?.totalRows} leads imported successfully!
              </p>
              <DialogFooter>
                <Button onClick={handleClose}>Done</Button>
              </DialogFooter>
            </motion.div>
          )}

          {step === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col items-center gap-4 py-8"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 260,
                  damping: 20,
                  delay: 0.1,
                }}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/15"
              >
                <X className="h-8 w-8 text-red-500" />
              </motion.div>
              <p className="text-sm text-red-500">
                {error || "An unexpected error occurred"}
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={reset}>
                  Try Again
                </Button>
              </DialogFooter>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
