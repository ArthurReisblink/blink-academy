import { redirect } from "next/navigation";
import { Logo, Card, CardBody } from "@/components/ui/misc";
import { Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Verificar documento" };

async function go(f: FormData) {
  "use server";
  const code = String(f.get("code") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  redirect(`/verificar/${encodeURIComponent(code || "-")}`);
}

export default function Page() {
  return (
    <main className="mx-auto max-w-lg space-y-6 px-4 py-10">
      <Logo className="h-12" />
      <Card><CardBody className="space-y-4">
        <h1 className="text-xl font-extrabold text-brand-900">Verificar comprovante ou termo assinado</h1>
        <p className="text-sm text-slate-600">Digite o código impresso no documento (formato XXXX-XXXX-XXXX). A consulta não mostra CPF nem dados de contato.</p>
        <form action={go} className="flex gap-2">
          <Input name="code" placeholder="XXXX-XXXX-XXXX" required maxLength={20} className="h-12 font-mono uppercase" aria-label="Código de verificação" />
          <Button type="submit" size="lg">Verificar</Button>
        </form>
      </CardBody></Card>
    </main>
  );
}
