"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";

interface AuthGuardProps {
  children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const { isAuthenticated, loading, initialized } = useAuth();

  useEffect(() => {
    if (initialized && !loading && !isAuthenticated) {
      router.push("/login");
    }
  }, [initialized, loading, isAuthenticated, router]);

  if (!initialized || loading || !isAuthenticated) {
    return (
      <div className="flex h-full w-full items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children}</>;
}
