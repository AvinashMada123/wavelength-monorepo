"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Invite } from "@/types/user";

export default function InviteAcceptPage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const { signUpWithInvite } = useAuth();

  const [invite, setInvite] = useState<Invite | null>(null);
  const [inviteLoading, setInviteLoading] = useState(true);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    async function fetchInvite() {
      try {
        const token = params.token;
        if (!token) {
          setInviteError("Invalid invite link");
          setInviteLoading(false);
          return;
        }

        const res = await fetch(`/api/invite?token=${encodeURIComponent(token)}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setInviteError(data.error || "Invite not found. This link may be invalid.");
          setInviteLoading(false);
          return;
        }

        const data = await res.json();
        const inviteData = data.invite as Invite;

        if (inviteData.status === "accepted") {
          setInviteError("This invite has already been used.");
          setInviteLoading(false);
          return;
        }

        if (inviteData.status === "expired") {
          setInviteError("This invite has expired.");
          setInviteLoading(false);
          return;
        }

        const now = new Date();
        const expiresAt = new Date(inviteData.expiresAt);
        if (now > expiresAt) {
          setInviteError("This invite has expired.");
          setInviteLoading(false);
          return;
        }

        setInvite(inviteData);
      } catch {
        setInviteError("Failed to load invite details.");
      } finally {
        setInviteLoading(false);
      }
    }

    fetchInvite();
  }, [params.token]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!invite) return;

    if (!displayName || !password || !confirmPassword) {
      toast.error("Please fill in all fields");
      return;
    }

    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setIsLoading(true);
    try {
      await signUpWithInvite(invite.email, password, displayName, invite.id);
      toast.success("Account created successfully");
      router.push("/dashboard");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to accept invite";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }

  if (inviteLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (inviteError) {
    return (
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Invite Error</CardTitle>
          <CardDescription>{inviteError}</CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Link
            href="/login"
            className="text-primary underline-offset-4 hover:underline text-sm"
          >
            Go to sign in
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (!invite) return null;

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Accept Invite</CardTitle>
        <CardDescription>
          You&apos;ve been invited to join{" "}
          <span className="font-medium text-foreground">{invite.orgName}</span>{" "}
          as a{" "}
          <span className="font-medium text-foreground">
            {invite.role === "client_admin" ? "Admin" : "User"}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={invite.email}
              disabled
              className="opacity-60"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              type="text"
              placeholder="John Doe"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={isLoading}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="Confirm your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isLoading}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="animate-spin" />
                Accepting invite...
              </>
            ) : (
              "Accept Invite"
            )}
          </Button>
        </form>
        <div className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
