import { redirect } from "next/navigation";
import Link from "next/link";
import { currentDriver } from "@/server/web";
import { CpfForm } from "../forms";

export const metadata = { title: "Acessar treinamento" };

export default async function Page() {
  if (await currentDriver()) redirect("/m");
  return (
    <>
      <h1 className="text-2xl font-extrabold text-brand-900">Acesse seu treinamento</h1>
      <p className="mb-6 mt-2 text-slate-600">Informe seu CPF. Vamos enviar um código de verificação para o telefone ou e-mail cadastrado pela BLINK.</p>
      <CpfForm />
      <p className="mt-6 text-xs text-slate-500">Seus dados são tratados conforme o <Link href="/privacidade" className="underline">aviso de privacidade</Link>.</p>
    </>
  );
}
