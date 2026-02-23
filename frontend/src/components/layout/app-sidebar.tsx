"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Phone,
  Settings,
  Radio,
  Bot,
  UserPlus,
  Shield,
  BarChart3,
  CreditCard,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/use-auth";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: ("super_admin" | "client_admin" | "client_user")[];
}

const clientNavItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/call-center", label: "Call Center", icon: Phone },
  {
    href: "/bot-config",
    label: "Bot Config",
    icon: Bot,
    roles: ["super_admin", "client_admin"],
  },
  {
    href: "/team",
    label: "Team",
    icon: UserPlus,
    roles: ["super_admin", "client_admin"],
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    roles: ["super_admin", "client_admin"],
  },
];

const adminNavItems: NavItem[] = [
  { href: "/admin/dashboard", label: "Overview", icon: Shield },
  { href: "/admin/clients", label: "Clients", icon: Building2 },
  { href: "/admin/usage", label: "Usage", icon: BarChart3 },
  { href: "/admin/billing", label: "Billing", icon: CreditCard },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { userProfile, isSuperAdmin, role } = useAuth();

  const visibleClientItems = clientNavItems.filter(
    (item) => !item.roles || (role && item.roles.includes(role))
  );

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-border/50 bg-card/50 backdrop-blur-xl">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-border/50 px-6">
        <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-500/25">
          <Radio className="h-5 w-5 text-white" />
          <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 opacity-50 blur-md" />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight">Wavelength</h1>
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            AI Calling
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {visibleClientItems.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}

        {isSuperAdmin && (
          <>
            <div className="my-3 border-t border-border/50" />
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
              Admin
            </p>
            {adminNavItems.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </>
        )}
      </nav>

      {/* User info footer */}
      <div className="border-t border-border/50 p-4">
        {userProfile ? (
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/20 to-indigo-600/20 text-xs font-bold text-violet-400">
              {userProfile.displayName
                ?.split(" ")
                .map((n) => n[0])
                .join("")
                .toUpperCase()
                .slice(0, 2)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">
                {userProfile.displayName}
              </p>
              <p className="truncate text-[10px] text-muted-foreground/70">
                {userProfile.role?.replace("_", " ")}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/50">Wavelength v2.0</p>
        )}
      </div>
    </aside>
  );
}

function NavLink({
  item,
  pathname,
}: {
  item: NavItem;
  pathname: string;
}) {
  const isActive = pathname.startsWith(item.href);
  const Icon = item.icon;

  return (
    <Link href={item.href}>
      <motion.div
        className={cn(
          "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
          isActive
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
        whileHover={{ x: 4 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        {isActive && (
          <motion.div
            layoutId="sidebar-active"
            className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-violet-500 to-indigo-500"
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
          />
        )}
        <Icon
          className={cn("h-4.5 w-4.5", isActive && "text-violet-400")}
        />
        {item.label}
      </motion.div>
    </Link>
  );
}
