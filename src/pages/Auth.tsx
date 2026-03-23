import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import { Newspaper } from "lucide-react";

export default function Auth() {
  const { user, loading, signIn, signUp } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-background"><div className="text-muted-foreground">Loading…</div></div>;
  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setMessage(""); setSubmitting(true);
    if (isLogin) {
      const { error } = await signIn(email, password);
      if (error) setError(error.message);
    } else {
      const { error } = await signUp(email, password);
      if (error) setError(error.message);
      else setMessage("Check your email to confirm your account.");
    }
    setSubmitting(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="monitor-card w-full max-w-sm animate-fade-in">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
            <Newspaper className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-light text-foreground tracking-tight">MediaPulse</h1>
            <p className="text-xs text-text-muted">International Media Monitoring</p>
          </div>
        </div>

        <div className="segment-control mb-6">
          <button className={`segment-btn ${isLogin ? 'active' : ''}`} onClick={() => { setIsLogin(true); setError(''); setMessage(''); }}>Sign In</button>
          <button className={`segment-btn ${!isLogin ? 'active' : ''}`} onClick={() => { setIsLogin(false); setError(''); setMessage(''); }}>Sign Up</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="section-label block mb-1.5">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full px-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition" />
          </div>
          <div>
            <label className="section-label block mb-1.5">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6}
              className="w-full px-3 py-2.5 rounded-xl bg-bg-elevated border border-bg-subtle text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition" />
          </div>
          {error && <p className="text-xs text-negative">{error}</p>}
          {message && <p className="text-xs text-positive">{message}</p>}
          <button type="submit" disabled={submitting}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium tracking-wide hover:opacity-90 transition disabled:opacity-50">
            {submitting ? "Please wait…" : isLogin ? "Sign In" : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}
