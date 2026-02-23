"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { LogOut, User, Sun, Moon } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";

const pageNames: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/leads": "Lead Management",
  "/call-center": "Call Center",
  "/bot-config": "Bot Config",
  "/team": "Team",
  "/settings": "Settings",
  "/admin/dashboard": "Admin Dashboard",
  "/admin/clients": "Clients",
  "/admin/usage": "Usage Analytics",
  "/admin/billing": "Billing",
};

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { userProfile, signOut } = useAuth();
  const { theme, setTheme } = useTheme();

  const pageName = pageNames[pathname] || "Dashboard";

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  const initials = userProfile?.displayName
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "U";

  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex h-16 items-center justify-between border-b border-border/50 bg-background/80 px-6 backdrop-blur-md"
    >
      <div className="flex items-center gap-3">
        <Separator orientation="vertical" className="mr-1 h-4" />
        <motion.h2
          key={pathname}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="text-lg font-semibold"
        >
          {pageName}
        </motion.h2>
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="h-8 w-8"
          title="Toggle theme"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-xs font-bold text-white">
                {initials}
              </div>
              <span className="hidden text-sm font-medium sm:inline">
                {userProfile?.displayName}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{userProfile?.displayName}</p>
                <p className="text-xs text-muted-foreground">
                  {userProfile?.email}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-xs text-muted-foreground" disabled>
              <User className="mr-2 h-4 w-4" />
              {userProfile?.role?.replace("_", " ")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.header>
  );
}
