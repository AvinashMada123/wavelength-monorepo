import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { ParsedFileData } from "@/types/lead";

export function parseCSV(file: File): Promise<ParsedFileData> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        resolve({
          headers: results.meta.fields || [],
          rows: results.data as Record<string, string>[],
          totalRows: results.data.length,
          fileName: file.name,
          fileType: "csv",
        });
      },
      error: (error: Error) => reject(error),
    });
  });
}

export function parseExcel(file: File): Promise<ParsedFileData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(e.target?.result, { type: "binary" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<Record<string, string>>(
          firstSheet,
          { defval: "" }
        );
        const headers = Object.keys(data[0] || {});
        resolve({
          headers,
          rows: data,
          totalRows: data.length,
          fileName: file.name,
          fileType: "excel",
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsBinaryString(file);
  });
}

export function parseFile(file: File): Promise<ParsedFileData> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "csv") return parseCSV(file);
  if (["xlsx", "xls"].includes(ext || "")) return parseExcel(file);
  return Promise.reject(
    new Error("Unsupported file type. Please upload CSV or Excel files.")
  );
}
