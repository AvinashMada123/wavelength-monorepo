import type { CallRequest } from "@/types/call";

export function validatePhoneNumber(phone: string): boolean {
  const cleaned = phone.replace(/\D/g, "");
  return cleaned.length >= 10 && cleaned.length <= 15;
}

export function validateCallRequest(
  req: Partial<CallRequest>,
  options?: { hasBotConfig?: boolean }
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const hasBotConfig = options?.hasBotConfig ?? false;

  if (!req.phoneNumber?.trim()) {
    errors.phoneNumber = "Phone number is required";
  } else if (!validatePhoneNumber(req.phoneNumber)) {
    errors.phoneNumber = "Invalid phone number";
  }

  if (!req.contactName?.trim()) errors.contactName = "Contact name is required";
  if (!req.clientName?.trim()) errors.clientName = "Client name is required";
  if (!req.voice?.trim()) errors.voice = "Voice is required";

  // These fields are optional when a bot config is selected (bot config provides context variables)
  if (!hasBotConfig) {
    if (!req.agentName?.trim()) errors.agentName = "Agent name is required";
    if (!req.companyName?.trim()) errors.companyName = "Company name is required";
    if (!req.eventName?.trim()) errors.eventName = "Event name is required";
    if (!req.eventHost?.trim()) errors.eventHost = "Event host is required";
    if (!req.location?.trim()) errors.location = "Location is required";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
