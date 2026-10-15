"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  LayoutDashboard,
  Gauge,
  Bell,
  Settings,
  Radar,
  Flame,
  Bot,
  TrendingUp,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

const navGroups = [
  {
    label: "运营观测",
    items: [
      { label: "概览仪表盘", href: "/", icon: LayoutDashboard },
      { label: "链路追踪", href: "/trace", icon: Activity, matchPrefixes: ["/trace"] },
      { label: "业务数据看板", href: "/biz-stats", icon: TrendingUp, matchPrefixes: ["/biz-stats"] },
      { label: "Skill 使用看板", href: "/skill-stats", icon: Flame },
      { label: "Agent 性能看板", href: "/agent-stats", icon: Bot },
      { label: "用户统计", href: "/user-stats", icon: Users, matchPrefixes: ["/user-stats"] },
    ],
  },
  {
    label: "质量与告警",
    items: [
      { label: "评测中心", href: "/experiments", icon: Gauge, matchPrefixes: ["/experiments"] },
      { label: "告警中心", href: "/alerts", icon: Bell },
    ],
  },
  {
    label: "系统",
    items: [{ label: "设置", href: "/settings", icon: Settings }],
  },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      {/* 品牌区：单色 logo，无光晕 */}
      <div className="flex h-14 items-center gap-2.5 px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background">
          <Radar className="h-4 w-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold tracking-tight">LinkAI Insight</span>
          <span className="text-[11px] leading-tight text-muted-foreground">Agent 运维平台</span>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3 scrollbar-thin">
        {navGroups.map((group) => (
          <div key={group.label}>
            <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
              {group.label}
            </p>
            <div className="space-y-px">
              {group.items.map((item) => {
                const active = item.matchPrefixes
                  ? item.matchPrefixes.some((p) => pathname.startsWith(p))
                  : pathname === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                      active
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", active ? "text-foreground" : "text-muted-foreground/70")} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="flex items-center justify-between border-t border-sidebar-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
            Pi
          </div>
          <span className="text-xs text-muted-foreground">管理员</span>
        </div>
        <ThemeToggle />
      </div>
    </aside>
  );
}
