import { NavLink } from "react-router-dom";
import {
  Activity,
  LayoutDashboard,
  Ticket,
  Users as UsersIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/admin", label: "概览", icon: LayoutDashboard, end: true },
  { to: "/admin/users", label: "用户", icon: UsersIcon, end: false },
  { to: "/admin/codes", label: "兑换码", icon: Ticket, end: false },
  { to: "/admin/usage", label: "用量", icon: Activity, end: false },
] as const;

/** 管理后台左侧导航：4 个子页（概览/用户/兑换码/用量），NavLink 高亮当前路由。 */
export function AdminNav() {
  return (
    <nav className="flex h-full flex-col gap-1 border-r border-border/80 bg-card/82 p-3 shadow-[12px_0_35px_hsl(var(--foreground)/0.03)] backdrop-blur-xl">
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-all",
              isActive
                ? "border-primary/18 bg-primary/10 font-medium text-primary shadow-sm shadow-primary/8"
                : "border-transparent text-muted-foreground hover:border-border/60 hover:bg-accent/55 hover:text-foreground",
            )
          }
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
