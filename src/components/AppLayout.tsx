import { Outlet, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import AppSidebar from "./AppSidebar";
import FetchProgressBar from "./FetchProgressBar";

export default function AppLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  return (
    <div className="flex min-h-screen bg-background">
      <FetchProgressBar />
      <AppSidebar />
      <main className="flex-1 p-3 md:p-6 overflow-auto pt-[60px] md:pt-6">
        <Outlet />
      </main>
    </div>
  );
}
