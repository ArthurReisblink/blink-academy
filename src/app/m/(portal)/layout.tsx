import { requireDriver } from "@/server/web";
import { Logo } from "@/components/ui/misc";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const d = await requireDriver();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-2">
          <Logo className="h-8" />
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden max-w-40 truncate font-semibold text-slate-700 sm:inline">{d.name}</span>
            <form action="/m/sair" method="post"><button className="rounded-md border border-slate-300 px-3 py-1.5 font-semibold text-slate-700">Sair</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
