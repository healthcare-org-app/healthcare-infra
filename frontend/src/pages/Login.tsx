import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/auth";
import { Logo } from "@/components/Logo";

type SendState = "idle" | "sending" | "sent" | "error";

export function Login() {
  const { session, signInWithMagicLink } = useAuth();
  const loc = useLocation();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<SendState>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  if (session) {
    const dest =
      (loc.state as { from?: { pathname?: string } } | null)?.from?.pathname ??
      "/";
    return <Navigate to={dest} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    setErrMsg(null);
    const { error } = await signInWithMagicLink(email.trim());
    if (error) {
      setErrMsg(error.message);
      setState("error");
    } else {
      setState("sent");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-50 p-4">
      <div className="card w-full max-w-md p-8">
        <div className="flex items-center gap-2 mb-6">
          <Logo />
          <div className="leading-tight">
            <div className="text-base font-semibold text-ink-900">
              healthcare-org
            </div>
            <div className="text-[11px] uppercase tracking-wider text-ink-500">
              admin console
            </div>
          </div>
        </div>

        <h1 className="text-xl font-semibold text-ink-900 mb-1">Sign in</h1>
        <p className="text-sm text-ink-600 mb-6">
          Enter your email and we'll send you a one-time sign-in link.
        </p>

        {state === "sent" ? (
          <div className="rounded border border-brand-200 bg-brand-50 text-sm text-brand-900 p-4">
            Check your inbox — we sent a sign-in link to{" "}
            <strong>{email}</strong>.
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-ink-700">Email</span>
              <input
                type="email"
                required
                autoFocus
                className="input mt-1"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={state === "sending" || !email.trim()}
            >
              {state === "sending" ? "Sending…" : "Send magic link"}
            </button>
            {state === "error" && errMsg && (
              <div className="text-sm text-danger-700">{errMsg}</div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
