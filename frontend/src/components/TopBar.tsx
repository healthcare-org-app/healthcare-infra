import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, Bell, ChevronDown, HelpCircle, LogOut } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, type Row } from "@/api";
import { useAuth } from "@/auth";
import { Logo } from "./Logo";

export function TopBar() {
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const { session, signOut } = useAuth();
  const email = session?.user?.email ?? "";

  const results = useQuery({
    queryKey: ["patient-search", q],
    queryFn: async () => {
      const r = await api.list("/api/patients", { limit: "20" });
      const items = r.items as Row[];
      if (!q) return items.slice(0, 5);
      const needle = q.toLowerCase();
      return items
        .filter((p) =>
          [p.first_name, p.last_name, p.mrn, p.email]
            .some((v) => String(v ?? "").toLowerCase().includes(needle)),
        )
        .slice(0, 5);
    },
    enabled: q.length >= 1,
    staleTime: 5_000,
  });

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <header className="h-14 shrink-0 border-b border-ink-200 bg-white flex items-center px-4 gap-4 sticky top-0 z-30">
      <Link to="/" className="flex items-center gap-2 shrink-0">
        <Logo />
        <div className="leading-tight">
          <div className="text-sm font-semibold text-ink-900">healthcare-org</div>
          <div className="text-[10px] uppercase tracking-wider text-ink-500">admin console</div>
        </div>
      </Link>

      {/* Tenant selector */}
      <button className="hidden md:flex items-center gap-1.5 h-8 px-2.5 rounded border border-ink-200 bg-white hover:bg-ink-50 text-sm text-ink-700">
        <span className="w-2 h-2 rounded-full bg-brand-500"></span>
        Northwind General
        <ChevronDown className="w-3.5 h-3.5 text-ink-400" />
      </button>

      {/* Global search */}
      <div ref={ref} className="flex-1 max-w-xl relative">
        <div className="relative">
          <Search className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            className="input pl-9 pr-14 h-9"
            placeholder="Search patients, MRN, providers…"
            value={q}
            onFocus={() => setFocused(true)}
            onChange={(e) => {
              setQ(e.target.value);
              setFocused(true);
            }}
          />
          <span className="kbd absolute right-3 top-1/2 -translate-y-1/2">⌘K</span>
        </div>
        {focused && q.length >= 1 && (
          <div className="absolute z-40 left-0 right-0 mt-1 card shadow-pop py-1 max-h-80 overflow-y-auto">
            {results.isPending && (
              <div className="px-3 py-2 text-sm text-ink-500">Searching…</div>
            )}
            {results.isError && (
              <div className="px-3 py-2 text-sm text-danger-700">Search unavailable</div>
            )}
            {results.data && results.data.length === 0 && (
              <div className="px-3 py-2 text-sm text-ink-500">No matches</div>
            )}
            {results.data?.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setFocused(false);
                  setQ("");
                  nav(`/service/patients-service/${p.id}`);
                }}
                className="w-full text-left px-3 py-2 hover:bg-ink-50 flex items-center gap-3"
              >
                <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold">
                  {initials(String(p.first_name), String(p.last_name))}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink-900 truncate">
                    {String(p.first_name ?? "")} {String(p.last_name ?? "")}
                  </div>
                  <div className="text-xs text-ink-500 font-mono">
                    {p.mrn ? `MRN ${p.mrn}` : `#${p.id}`}
                    {p.dob ? ` · DOB ${p.dob}` : ""}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <button className="btn btn-ghost !p-2" title="Help">
        <HelpCircle className="w-4 h-4" />
      </button>
      <button className="btn btn-ghost !p-2 relative" title="Notifications">
        <Bell className="w-4 h-4" />
        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-danger-500"></span>
      </button>
      <div
        className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white text-xs font-semibold flex items-center justify-center"
        title={email}
      >
        {avatarInitials(email)}
      </div>
      <button
        className="btn btn-ghost !p-2"
        title="Sign out"
        onClick={() => signOut()}
      >
        <LogOut className="w-4 h-4" />
      </button>
    </header>
  );
}

function avatarInitials(email: string): string {
  if (!email) return "??";
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

function initials(first?: string, last?: string): string {
  return `${(first ?? "?").charAt(0)}${(last ?? "").charAt(0)}`.toUpperCase();
}
