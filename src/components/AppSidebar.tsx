import { LayoutDashboard, List, Tag, Radio, BarChart3, Settings, LogOut, Bell, Archive, FileText, Menu, X, MessageCircle } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useState, useEffect } from "react";
import NotificationBell from "./NotificationBell";

const links = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/mentions", label: "Mentions", icon: List },
  { to: "/archive", label: "Archive", icon: Archive },
  { to: "/keywords", label: "Keywords", icon: Tag },
  { to: "/sources", label: "Sources", icon: Radio },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/social", label: "Social", icon: MessageCircle },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function AppSidebar() {
  const { signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <>
      {/* Mobile header bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 h-12 bg-card border-b border-border flex items-center px-3 gap-3">
        <button onClick={() => setMobileOpen(true)} className="p-1.5 rounded-lg hover:bg-bg-elevated transition">
          <Menu className="w-5 h-5 text-foreground" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center">
            <Radio className="w-3 h-3 text-primary" />
          </div>
          <span className="text-sm font-light text-foreground tracking-tight">WaveWatch</span>
        </div>
        <div className="ml-auto">
          <NotificationBell />
        </div>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/50" onClick={() => setMobileOpen(false)}>
          <aside
            className="w-[260px] h-full bg-card flex flex-col animate-slide-in-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Radio className="w-4 h-4 text-primary" />
                </div>
                <span className="text-sm font-light text-foreground tracking-tight">WaveWatch</span>
              </div>
              <button onClick={() => setMobileOpen(false)} className="p-1.5 rounded-lg hover:bg-bg-elevated transition">
                <X className="w-5 h-5 text-text-muted" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
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
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-[220px] min-h-screen bg-card flex-col flex-shrink-0">
        <div className="p-5 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <Radio className="w-4 h-4 text-primary" />
          </div>
          <span className="text-sm font-light text-foreground tracking-tight">WaveWatch</span>
          <div className="ml-auto">
            <NotificationBell />
          </div>
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
    </>
  );
}
