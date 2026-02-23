"use client";

import { useMemo } from "react";
import { useAuthContext } from "@/context/auth-context";

export function useAuth() {
  const context = useAuthContext();

  const derived = useMemo(
    () => ({
      isAuthenticated: !!context.user && !!context.userProfile,
      role: context.userProfile?.role ?? null,
      orgId: context.userProfile?.orgId ?? null,
      isSuperAdmin: context.userProfile?.role === "super_admin",
      isAdmin:
        context.userProfile?.role === "super_admin" ||
        context.userProfile?.role === "client_admin",
      isClientUser: context.userProfile?.role === "client_user",
    }),
    [context.user, context.userProfile]
  );

  return { ...context, ...derived };
}
