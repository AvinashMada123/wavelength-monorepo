"use client";

import { useState } from "react";
import { Phone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BotConfigSelector } from "@/components/calls/bot-config-selector";
import { formatPhoneNumber } from "@/lib/utils";
import type { Lead } from "@/types/lead";

interface BulkCallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leads: Lead[];
  onConfirm: (botConfigId?: string) => void;
}

export function BulkCallDialog({
  open,
  onOpenChange,
  leads,
  onConfirm,
}: BulkCallDialogProps) {
  const [selectedBotConfigId, setSelectedBotConfigId] = useState("");

  const handleStart = () => {
    onOpenChange(false);
    onConfirm(selectedBotConfigId || undefined);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Bulk Call — {leads.length} Lead{leads.length !== 1 ? "s" : ""}
          </DialogTitle>
          <DialogDescription>
            {leads.length} leads will be called in batches of 5. Calls will
            continue in the background — you can navigate away.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[200px]">
          <div className="space-y-1">
            {leads.map((lead) => (
              <div
                key={lead.id}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm"
              >
                <Phone className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{lead.contactName}</span>
                  <span className="text-muted-foreground ml-2">
                    {formatPhoneNumber(lead.phoneNumber)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <BotConfigSelector
          value={selectedBotConfigId}
          onChange={setSelectedBotConfigId}
        />

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleStart}>
            <Phone className="mr-2 h-4 w-4" />
            Start Calling
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
