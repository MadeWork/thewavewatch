import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { FetchProvider } from "@/hooks/useFetchContext";
import AppLayout from "@/components/AppLayout";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import Mentions from "@/pages/Mentions";
import Keywords from "@/pages/Keywords";
import Sources from "@/pages/Sources";
import Analytics from "@/pages/Analytics";
import Alerts from "@/pages/Alerts";
import Archive from "@/pages/Archive";
import Reports from "@/pages/Reports";
import Social from "@/pages/Social";
import SettingsPage from "@/pages/SettingsPage";
import NotFound from "@/pages/NotFound";
import AdminIngestion from "@/pages/AdminIngestion";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <FetchProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route element={<AppLayout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/mentions" element={<Mentions />} />
                <Route path="/archive" element={<Archive />} />
                <Route path="/keywords" element={<Keywords />} />
                <Route path="/sources" element={<Sources />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/social" element={<Social />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/admin/ingestion" element={<AdminIngestion />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </FetchProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
