import { Logo } from "@/components/ui/misc";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-brand-900 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-7 shadow-xl">
        <Logo className="h-12" />
        <p className="mt-3 text-xs font-bold uppercase tracking-widest text-brand-600">BLINK Academy · Administração</p>
        <div className="mt-5">{children}</div>
      </div>
    </main>
  );
}
