export type UserRole = "super_admin" | "client_admin" | "client_user";

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: UserRole;
  orgId: string;
  status: "active" | "disabled" | "pending_invite";
  createdAt: string;
  lastLoginAt: string;
  invitedBy?: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: "free" | "starter" | "pro" | "enterprise";
  status: "active" | "suspended" | "trial";
  webhookUrl: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Invite {
  id: string;
  email: string;
  orgId: string;
  orgName: string;
  role: "client_admin" | "client_user";
  invitedBy: string;
  status: "pending" | "accepted" | "expired";
  createdAt: string;
  expiresAt: string;
}
