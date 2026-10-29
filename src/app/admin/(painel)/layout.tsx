import { requireAdmin } from "@/server/web";
import { AdminNav } from "@/components/admin-nav";
import { Badge } from "@/components/ui/misc";

const roleLabel = { superadmin: "Superadministrador", admin: "Administrador", auditor: "Auditor (leitura)" } as const;

function Sidebar({ name, role }: { name: string; role: keyof typeof roleLabel }) {
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="rounded-xl bg-white px-3 py-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/blink-logo.png" alt="BLINK" className="h-9 w-auto" />
        <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-brand-600">Academy</p>
      </div>
      <AdminNav role={role} />
      <div className="mt-auto rounded-lg bg-white/10 p-3 text-sm text-white">
        <p className="truncate font-semibold">{name}</p>
        <p className="text-xs text-brand-100">{roleLabel[role]}</p>
        <form action="/admin/sair" method="post" className="mt-2">
          <button className="text-xs font-semibold text-white underline underline-offset-2">Sair</button>
        </form>
      </div>
    </div>
  );
}

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="hidden bg-brand-900 lg:sticky lg:top-0 lg:block lg:h-dvh lg:overflow-y-auto">
        <Sidebar name={admin.name} role={admin.role} />
      </aside>
      <details className="group bg-brand-900 lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-white">
          <span className="font-bold">BLINK Academy</span>
          <span className="flex items-center gap-2">{admin.role === "auditor" ? <Badge tone="warn">Leitura</Badge> : null}<span className="rounded-md border border-white/30 px-2 py-1 text-sm">Menu</span></span>
        </summary>
        <Sidebar name={admin.name} role={admin.role} />
      </details>
      <main className="min-w-0 px-4 py-6 sm:px-8">{children}</main>
    </div>
  );
}
