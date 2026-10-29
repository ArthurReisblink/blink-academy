import { Logo } from "@/components/ui/misc";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 py-8">
      <Logo className="h-12" />
      <p className="mt-2 text-xs font-bold uppercase tracking-widest text-brand-600">BLINK Academy · Treinamento POD e PNR</p>
      <div className="mt-8 flex-1">{children}</div>
      <p className="mt-8 text-center text-xs text-slate-500">Dúvidas? Fale com a administração da sua base BLINK.</p>
    </main>
  );
}
