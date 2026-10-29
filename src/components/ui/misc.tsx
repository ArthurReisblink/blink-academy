import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-slate-200 bg-white shadow-sm", className)} {...p} />;
}
export function CardBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...p} />;
}
export function CardTitle({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-base font-bold text-slate-900", className)} {...p} />;
}

const tones = {
  slate: "bg-slate-100 text-slate-700", brand: "bg-brand-50 text-brand-700", ok: "bg-ok-50 text-ok-600",
  bad: "bg-bad-50 text-bad-600", warn: "bg-warn-50 text-warn-600", accent: "bg-orange-50 text-accent-600",
} as const;
export type Tone = keyof typeof tones;
export function Badge({ tone = "slate", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", tones[tone], className)} {...p} />;
}

export function Alert({ tone = "brand", title, children, className }: { tone?: Tone; title?: string; children?: React.ReactNode; className?: string }) {
  const border = { slate: "border-slate-200", brand: "border-brand-200", ok: "border-green-200", bad: "border-red-200", warn: "border-amber-200", accent: "border-orange-200" }[tone];
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cn("rounded-lg border px-4 py-3 text-sm", tones[tone], border, className)}>
      {title ? <p className="font-bold">{title}</p> : null}
      {children ? <div className={title ? "mt-0.5" : ""}>{children}</div> : null}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Progress({ value, tone = "brand", className }: { value: number; tone?: "brand" | "ok"; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-2.5 w-full overflow-hidden rounded-full bg-slate-200", className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-[width]", tone === "ok" ? "bg-ok-600" : "bg-brand-600")} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/blink-logo.png" alt="BLINK Logística Inteligente" className={cn("h-10 w-auto", className)} />;
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="font-semibold text-slate-800">{title}</p>
      {children ? <div className="mt-1 text-sm text-slate-500">{children}</div> : null}
    </div>
  );
}
