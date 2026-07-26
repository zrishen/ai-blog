import { NavLink } from "react-router-dom";
import {
  Activity,
  Blocks,
  LayoutDashboard,
  Ticket,
  Users as UsersIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { navItemVariants, workspacePanelVariants } from "@/lib/visualVariants";

const NAV_ITEMS = [
  { to: "/admin", label: "概览", icon: LayoutDashboard, end: true },
  { to: "/admin/users", label: "用户", icon: UsersIcon, end: false },
  { to: "/admin/codes", label: "兑换码", icon: Ticket, end: false },
  { to: "/admin/usage", label: "用量", icon: Activity, end: false },
  { to: "/admin/plugins", label: "插件", icon: Blocks, end: false },
] as const;

/** 管理后台左侧导航：4 个子页（概览/用户/兑换码/用量），NavLink 高亮当前路由。 */
export function AdminNav() {
  return (
    <nav className={cn(workspacePanelVariants({ side: "left" }), "gap-1 p-3")}>
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              navItemVariants({ layout: "side", state: isActive ? "active" : "idle" }),
              "gap-2.5",
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
