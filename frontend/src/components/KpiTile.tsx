import type { LucideIcon } from "lucide-react";
import clsx from "clsx";

interface Props {
  label: string;
  value: string | number;
  hint?: string;
  Icon: LucideIcon;
  tint?: { bg: string; text: string; ring: string };
  tone?: "neutral" | "ok" | "warn" | "err";
  loading?: boolean;
  error?: string;
}

export function KpiTile({
  label,
  value,
  hint,
  Icon,
  tint = { bg: "bg-brand-100", text: "text-brand-700", ring: "ring-brand-200" },
  tone = "neutral",
  loading,
  error,
}: Props) {
  const valueColor =
    tone === "ok"
      ? "text-ok-700"
      : tone === "warn"
        ? "text-warn-700"
        : tone === "err"
          ? "text-danger-700"
          : "text-ink-900";

  return (
    <div className="card p-5 relative">
      <div className="flex items-start gap-3">
        <div
          className={clsx(
            "w-10 h-10 rounded-lg flex items-center justify-center ring-1",
            tint.bg,
            tint.text,
            tint.ring,
          )}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-medium text-ink-500 uppercase tracking-wider">
            {label}
          </div>
          {loading ? (
            <div className="skeleton h-7 w-20 mt-1" />
          ) : error ? (
            <div className="text-sm text-danger-700 mt-1 truncate" title={error}>
              unreachable
            </div>
          ) : (
            <div className={clsx("text-2xl font-semibold mt-0.5 tabular-nums", valueColor)}>
              {value}
            </div>
          )}
          {hint && !error && (
            <div className="text-[11px] text-ink-500 mt-1 truncate">{hint}</div>
          )}
          {error && (
            <div className="text-[11px] text-ink-500 mt-1 truncate" title={error}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
