"use client";

import { type ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "./auth-context";
import { SettingsProvider } from "./settings-context";
import { LeadsProvider } from "./leads-context";
import { CallsProvider } from "./calls-context";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useCallQualificationSync } from "@/hooks/use-call-qualification";

function QualificationSyncRunner() {
  useCallQualificationSync();
  return null;
}

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <AuthProvider>
        <SettingsProvider>
          <LeadsProvider>
            <CallsProvider>
              <TooltipProvider>
                <QualificationSyncRunner />
                {children}
                <Toaster richColors position="bottom-right" />
              </TooltipProvider>
            </CallsProvider>
          </LeadsProvider>
        </SettingsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
