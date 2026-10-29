import { redirect } from "next/navigation";
import { currentAdmin } from "@/server/web";
import { LoginForm } from "../forms";

export const metadata = { title: "Entrar" };

export default async function Page() {
  if (await currentAdmin()) redirect("/admin");
  return (
    <>
      <h1 className="text-xl font-extrabold">Entrar no painel</h1>
      <p className="mb-5 mt-1 text-sm text-slate-600">Acesso restrito a administradores autorizados da BLINK.</p>
      <LoginForm />
    </>
  );
}
