import { NavLink } from "react-router-dom";
import { LayoutDashboard, Users as UsersIcon, Ticket, Activity } from "lucide-react";
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
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        管理后台
      </div>
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )
          }
        >
          <Icon className="h-4 w-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
