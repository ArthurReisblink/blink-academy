import Link from "next/link";
import { GENERIC_SENT } from "@/server/auth/driver";
import { CodeForm } from "../forms";

export const metadata = { title: "Código de verificação" };

export default function Page() {
  return (
    <>
      <h1 className="text-2xl font-extrabold text-brand-900">Digite o código</h1>
      <p className="mb-6 mt-2 text-slate-600">{GENERIC_SENT} O código vale por 10 minutos.</p>
      <CodeForm />
      <p className="mt-6 text-center text-sm"><Link href="/m/entrar" className="font-semibold text-brand-600 underline">Não recebi — pedir novo código</Link></p>
    </>
  );
}
