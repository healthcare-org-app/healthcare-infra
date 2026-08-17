import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, Bell, ChevronDown, HelpCircle, LogOut } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { useAuth } from "@/auth";
import { Logo } from "./Logo";
export function TopBar() {
    const [q, setQ] = useState("");
    const [focused, setFocused] = useState(false);
    const ref = useRef(null);
    const nav = useNavigate();
    const { session, signOut } = useAuth();
    const email = session?.user?.email ?? "";
    const results = useQuery({
        queryKey: ["patient-search", q],
        queryFn: async () => {
            const r = await api.list("/api/patients", { limit: "20" });
            const items = r.items;
            if (!q)
                return items.slice(0, 5);
            const needle = q.toLowerCase();
            return items
                .filter((p) => [p.first_name, p.last_name, p.mrn, p.email]
                .some((v) => String(v ?? "").toLowerCase().includes(needle)))
                .slice(0, 5);
        },
        enabled: q.length >= 1,
        staleTime: 5_000,
    });
    useEffect(() => {
        const onClick = (e) => {
            if (ref.current && !ref.current.contains(e.target))
                setFocused(false);
        };
        document.addEventListener("click", onClick);
        return () => document.removeEventListener("click", onClick);
    }, []);
    return (_jsxs("header", { className: "h-14 shrink-0 border-b border-ink-200 bg-white flex items-center px-4 gap-4 sticky top-0 z-30", children: [_jsxs(Link, { to: "/", className: "flex items-center gap-2 shrink-0", children: [_jsx(Logo, {}), _jsxs("div", { className: "leading-tight", children: [_jsx("div", { className: "text-sm font-semibold text-ink-900", children: "healthcare-org" }), _jsx("div", { className: "text-[10px] uppercase tracking-wider text-ink-500", children: "admin console" })] })] }), _jsxs("button", { className: "hidden md:flex items-center gap-1.5 h-8 px-2.5 rounded border border-ink-200 bg-white hover:bg-ink-50 text-sm text-ink-700", children: [_jsx("span", { className: "w-2 h-2 rounded-full bg-brand-500" }), "Northwind General", _jsx(ChevronDown, { className: "w-3.5 h-3.5 text-ink-400" })] }), _jsxs("div", { ref: ref, className: "flex-1 max-w-xl relative", children: [_jsxs("div", { className: "relative", children: [_jsx(Search, { className: "w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" }), _jsx("input", { className: "input pl-9 pr-14 h-9", placeholder: "Search patients, MRN, providers\u2026", value: q, onFocus: () => setFocused(true), onChange: (e) => {
                                    setQ(e.target.value);
                                    setFocused(true);
                                } }), _jsx("span", { className: "kbd absolute right-3 top-1/2 -translate-y-1/2", children: "\u2318K" })] }), focused && q.length >= 1 && (_jsxs("div", { className: "absolute z-40 left-0 right-0 mt-1 card shadow-pop py-1 max-h-80 overflow-y-auto", children: [results.isPending && (_jsx("div", { className: "px-3 py-2 text-sm text-ink-500", children: "Searching\u2026" })), results.isError && (_jsx("div", { className: "px-3 py-2 text-sm text-danger-700", children: "Search unavailable" })), results.data && results.data.length === 0 && (_jsx("div", { className: "px-3 py-2 text-sm text-ink-500", children: "No matches" })), results.data?.map((p) => (_jsxs("button", { onClick: () => {
                                    setFocused(false);
                                    setQ("");
                                    nav(`/service/patients-service/${p.id}`);
                                }, className: "w-full text-left px-3 py-2 hover:bg-ink-50 flex items-center gap-3", children: [_jsx("div", { className: "w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold", children: initials(String(p.first_name), String(p.last_name)) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "text-sm font-medium text-ink-900 truncate", children: [String(p.first_name ?? ""), " ", String(p.last_name ?? "")] }), _jsxs("div", { className: "text-xs text-ink-500 font-mono", children: [p.mrn ? `MRN ${p.mrn}` : `#${p.id}`, p.dob ? ` · DOB ${p.dob}` : ""] })] })] }, p.id)))] }))] }), _jsx("button", { className: "btn btn-ghost !p-2", title: "Help", children: _jsx(HelpCircle, { className: "w-4 h-4" }) }), _jsxs("button", { className: "btn btn-ghost !p-2 relative", title: "Notifications", children: [_jsx(Bell, { className: "w-4 h-4" }), _jsx("span", { className: "absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-danger-500" })] }), _jsx("div", { className: "w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white text-xs font-semibold flex items-center justify-center", title: email, children: avatarInitials(email) }), _jsx("button", { className: "btn btn-ghost !p-2", title: "Sign out", onClick: () => signOut(), children: _jsx(LogOut, { className: "w-4 h-4" }) })] }));
}
function avatarInitials(email) {
    if (!email)
        return "??";
    const local = email.split("@")[0] ?? "";
    const parts = local.split(/[._-]/).filter(Boolean);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return local.slice(0, 2).toUpperCase();
}
function initials(first, last) {
    return `${(first ?? "?").charAt(0)}${(last ?? "").charAt(0)}`.toUpperCase();
}
