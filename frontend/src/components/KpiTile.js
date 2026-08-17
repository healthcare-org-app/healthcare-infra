import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import clsx from "clsx";
export function KpiTile({ label, value, hint, Icon, tint = { bg: "bg-brand-100", text: "text-brand-700", ring: "ring-brand-200" }, tone = "neutral", loading, error, }) {
    const valueColor = tone === "ok"
        ? "text-ok-700"
        : tone === "warn"
            ? "text-warn-700"
            : tone === "err"
                ? "text-danger-700"
                : "text-ink-900";
    return (_jsx("div", { className: "card p-5 relative", children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsx("div", { className: clsx("w-10 h-10 rounded-lg flex items-center justify-center ring-1", tint.bg, tint.text, tint.ring), children: _jsx(Icon, { className: "w-5 h-5" }) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("div", { className: "text-[11px] font-medium text-ink-500 uppercase tracking-wider", children: label }), loading ? (_jsx("div", { className: "skeleton h-7 w-20 mt-1" })) : error ? (_jsx("div", { className: "text-sm text-danger-700 mt-1 truncate", title: error, children: "unreachable" })) : (_jsx("div", { className: clsx("text-2xl font-semibold mt-0.5 tabular-nums", valueColor), children: value })), hint && !error && (_jsx("div", { className: "text-[11px] text-ink-500 mt-1 truncate", children: hint })), error && (_jsx("div", { className: "text-[11px] text-ink-500 mt-1 truncate", title: error, children: error }))] })] }) }));
}
