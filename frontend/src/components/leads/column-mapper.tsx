"use client";

import { Check } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MAPPABLE_FIELDS } from "@/lib/constants";
import type { ColumnMapping } from "@/types/lead";
import type { Lead } from "@/types/lead";

interface ColumnMapperProps {
  headers: string[];
  mapping: ColumnMapping;
  onMappingChange: (mapping: ColumnMapping) => void;
}

export function ColumnMapper({
  headers,
  mapping,
  onMappingChange,
}: ColumnMapperProps) {
  const handleChange = (header: string, value: string) => {
    onMappingChange({
      ...mapping,
      [header]: value as keyof Lead | "skip",
    });
  };

  const isMapped = (header: string) => {
    return mapping[header] && mapping[header] !== "skip";
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Map your file columns to lead fields. Fields marked with{" "}
        <span className="text-red-500">*</span> are required.
      </p>

      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
        {headers.map((header) => (
          <div
            key={header}
            className="flex items-center gap-3 rounded-md border p-3"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{header}</p>
            </div>

            <span className="text-muted-foreground text-sm">-&gt;</span>

            <div className="flex items-center gap-2 flex-1">
              <Select
                value={mapping[header] || "skip"}
                onValueChange={(value) => handleChange(header, value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select field" />
                </SelectTrigger>
                <SelectContent>
                  {MAPPABLE_FIELDS.map((field) => (
                    <SelectItem key={field.value} value={field.value}>
                      {field.label}
                      {field.required && (
                        <span className="text-red-500 ml-1">*</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {isMapped(header) && (
                <Check className="h-4 w-4 shrink-0 text-green-500" />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
