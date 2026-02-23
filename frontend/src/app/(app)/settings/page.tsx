"use client";

import { SettingsForm } from "@/components/settings/settings-form";
import { WebhookTester } from "@/components/settings/webhook-tester";

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Configure default values and preferences
        </p>
      </div>
      <SettingsForm />
      <WebhookTester />
    </div>
  );
}
