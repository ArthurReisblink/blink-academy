import Link from "next/link";
import { Logo } from "@/components/ui/misc";
import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <Logo className="h-14" />
      <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-brand-900">BLINK Academy</h1>
      <p className="mt-2 text-slate-600">Treinamentos obrigatórios de Prova de Entrega (POD) e PNR.</p>
      <div className="mt-8 space-y-3">
        <Link href="/m/entrar" className={buttonVariants({ size: "xl" })}>Sou motorista — acessar treinamento</Link>
        <Link href="/admin/entrar" className={buttonVariants({ variant: "outline", size: "lg", className: "w-full" })}>Área administrativa</Link>
      </div>
      <p className="mt-8 text-xs text-slate-500">
        Ao usar o sistema você concorda com o <Link href="/privacidade" className="underline">aviso de privacidade</Link>.
      </p>
    </main>
  );
}
