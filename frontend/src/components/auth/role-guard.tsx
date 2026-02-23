"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/hooks/use-auth";
import type { UserRole } from "@/types/user";

interface RoleGuardProps {
  allowedRoles: UserRole[];
  fallback?: ReactNode;
  children: ReactNode;
}

export function RoleGuard({ allowedRoles, fallback, children }: RoleGuardProps) {
  const router = useRouter();
  const { role } = useAuth();

  const hasAccess = role !== null && allowedRoles.includes(role);

  useEffect(() => {
    if (role !== null && !hasAccess && !fallback) {
      router.push("/dashboard");
    }
  }, [role, hasAccess, fallback, router]);

  if (role === null) {
    return null;
  }

  if (!hasAccess) {
    return fallback ? <>{fallback}</> : null;
  }

  return <>{children}</>;
}
