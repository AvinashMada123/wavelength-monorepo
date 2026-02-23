export interface AppSettings {
  defaults: {
    clientName: string;
    agentName: string;
    companyName: string;
    eventName: string;
    eventHost: string;
    voice: string;
    location: string;
  };
  webhookUrl: string;
  ghlWhatsappWebhookUrl: string;
  ghlApiKey: string;
  ghlLocationId: string;
  plivoAuthId: string;
  plivoAuthToken: string;
  plivoPhoneNumber: string;
  appearance: {
    sidebarCollapsed: boolean;
    animationsEnabled: boolean;
  };
  ai: {
    autoQualify: boolean;
  };
  ghlSyncEnabled?: boolean;
  ghlLastSyncAt?: string;
}
