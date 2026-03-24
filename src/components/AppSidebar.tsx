import { LayoutDashboard, List, Tag, Radio, BarChart3, Settings, LogOut, Bell, Archive, FileText, Search } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const links = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/mentions", label: "Mentions", icon: List },
  { to: "/archive", label: "Archive", icon: Archive },
  { to: "/keywords", label: "Keywords", icon: Tag },
  { to: "/sources", label: "Sources", icon: Radio },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function AppSidebar() {
  const { signOut } = useAuth();

  return (
    <aside className="w-[220px] min-h-screen bg-card flex flex-col flex-shrink-0">
      <div className="p-5 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
          <Radio className="w-4 h-4 text-primary" />
        </div>
        <span className="text-sm font-light text-foreground tracking-tight">WaveWatch</span>
      </div>
      <nav className="flex-1 px-3 py-2 space-y-0.5">
        {links.map(l => (
          <NavLink key={l.to} to={l.to} end
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                isActive
                  ? 'text-foreground bg-bg-elevated border-l-[3px] border-primary pl-[9px]'
                  : 'text-text-secondary hover:text-foreground hover:bg-bg-elevated/50'
              }`
            }>
            <l.icon className="w-4 h-4" />
            <span className="font-light">{l.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="p-3 mt-auto">
        <button onClick={signOut}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-text-muted hover:text-foreground hover:bg-bg-elevated/50 transition-colors w-full">
          <LogOut className="w-4 h-4" /> <span className="font-light">Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
