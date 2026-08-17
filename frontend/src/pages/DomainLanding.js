import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link, useParams } from "react-router-dom";
import { DOMAIN_ORDER, servicesByDomain } from "@/services";
import { DOMAIN_ICON, DOMAIN_TINT } from "@/domain-icons";
import { ArrowRight, Server, Radio, Ban } from "lucide-react";
export function DomainLanding() {
    const { domain: rawDomain } = useParams();
    const domain = rawDomain ? decodeURIComponent(rawDomain) : undefined;
    const grouped = servicesByDomain();
    if (!domain || !DOMAIN_ORDER.includes(domain)) {
        return _jsx("div", { className: "p-8", children: "Unknown domain." });
    }
    const services = grouped[domain];
    const Icon = DOMAIN_ICON[domain];
    const tint = DOMAIN_TINT[domain];
    return (_jsxs("div", { className: "max-w-[1400px] mx-auto px-8 py-8", children: [_jsxs("div", { className: "flex items-start gap-4", children: [_jsx("div", { className: `w-14 h-14 rounded-lg flex items-center justify-center ${tint.bg} ${tint.text} ring-1 ${tint.ring}`, children: _jsx(Icon, { className: "w-7 h-7" }) }), _jsxs("div", { children: [_jsx("div", { className: "text-xs font-semibold text-ink-500 uppercase tracking-wider", children: "Domain" }), _jsx("h1", { className: "text-2xl font-semibold text-ink-900 mt-0.5", children: domain }), _jsxs("p", { className: "text-sm text-ink-500 mt-1", children: [services.length, " services \u00B7 ", services.filter((s) => !s.hasCrud).length, " ", "without a generic CRUD template"] })] })] }), _jsx("ul", { className: "mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3", children: services.map((s) => (_jsx("li", { children: s.hasCrud ? (_jsxs(Link, { to: `/service/${s.name}`, className: "card card-hover p-4 flex flex-col gap-2 h-full", children: [_jsxs("div", { className: "flex items-start gap-2", children: [_jsx("div", { className: "font-semibold text-ink-900", children: s.displayName }), _jsx(ArrowRight, { className: "w-4 h-4 text-ink-300 ml-auto" })] }), _jsxs("div", { className: "flex items-center gap-3 text-[11px] text-ink-500", children: [_jsxs("span", { className: "inline-flex items-center gap-1 font-mono", children: [_jsx(Radio, { className: "w-3 h-3" }), s.prefix, "/"] }), _jsxs("span", { className: "inline-flex items-center gap-1", children: [_jsx(Server, { className: "w-3 h-3" }), " :", s.port] })] }), _jsxs("div", { className: "flex items-center flex-wrap gap-1", children: [_jsx("span", { className: "chip chip-neutral", children: s.language }), s.actions?.map((a) => (_jsxs("span", { className: "chip chip-brand", children: ["+", a.label] }, a.label)))] })] })) : (_jsxs("div", { className: "card p-4 flex flex-col gap-2 h-full opacity-70", children: [_jsxs("div", { className: "flex items-start gap-2", children: [_jsx("div", { className: "font-semibold text-ink-900", children: s.displayName }), _jsxs("span", { className: "chip chip-warn ml-auto", children: [_jsx(Ban, { className: "w-3 h-3" }), " No CRUD"] })] }), _jsxs("div", { className: "flex items-center gap-3 text-[11px] text-ink-500", children: [_jsxs("span", { className: "inline-flex items-center gap-1", children: [_jsx(Server, { className: "w-3 h-3" }), " :", s.port] }), _jsx("span", { className: "chip chip-neutral", children: s.language })] })] })) }, s.name))) })] }));
}
