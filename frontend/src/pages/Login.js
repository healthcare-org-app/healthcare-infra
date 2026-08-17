import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/auth";
import { Logo } from "@/components/Logo";
export function Login() {
    const { session, signInWithMagicLink } = useAuth();
    const loc = useLocation();
    const [email, setEmail] = useState("");
    const [state, setState] = useState("idle");
    const [errMsg, setErrMsg] = useState(null);
    if (session) {
        const dest = loc.state?.from?.pathname ??
            "/";
        return _jsx(Navigate, { to: dest, replace: true });
    }
    async function onSubmit(e) {
        e.preventDefault();
        setState("sending");
        setErrMsg(null);
        const { error } = await signInWithMagicLink(email.trim());
        if (error) {
            setErrMsg(error.message);
            setState("error");
        }
        else {
            setState("sent");
        }
    }
    return (_jsx("div", { className: "min-h-screen flex items-center justify-center bg-ink-50 p-4", children: _jsxs("div", { className: "card w-full max-w-md p-8", children: [_jsxs("div", { className: "flex items-center gap-2 mb-6", children: [_jsx(Logo, {}), _jsxs("div", { className: "leading-tight", children: [_jsx("div", { className: "text-base font-semibold text-ink-900", children: "healthcare-org" }), _jsx("div", { className: "text-[11px] uppercase tracking-wider text-ink-500", children: "admin console" })] })] }), _jsx("h1", { className: "text-xl font-semibold text-ink-900 mb-1", children: "Sign in" }), _jsx("p", { className: "text-sm text-ink-600 mb-6", children: "Enter your email and we'll send you a one-time sign-in link." }), state === "sent" ? (_jsxs("div", { className: "rounded border border-brand-200 bg-brand-50 text-sm text-brand-900 p-4", children: ["Check your inbox \u2014 we sent a sign-in link to", " ", _jsx("strong", { children: email }), "."] })) : (_jsxs("form", { onSubmit: onSubmit, className: "space-y-4", children: [_jsxs("label", { className: "block", children: [_jsx("span", { className: "text-xs font-medium text-ink-700", children: "Email" }), _jsx("input", { type: "email", required: true, autoFocus: true, className: "input mt-1", placeholder: "you@example.com", value: email, onChange: (e) => setEmail(e.target.value) })] }), _jsx("button", { type: "submit", className: "btn btn-primary w-full", disabled: state === "sending" || !email.trim(), children: state === "sending" ? "Sending…" : "Send magic link" }), state === "error" && errMsg && (_jsx("div", { className: "text-sm text-danger-700", children: errMsg }))] }))] }) }));
}
