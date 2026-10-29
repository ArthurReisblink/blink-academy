import { requireAdmin } from "@/server/web";
import { assertCanWrite } from "@/server/auth/admin";
import { listTrainings } from "@/server/services/trainings";
import { PageHeader } from "@/components/ui/misc";
import { ImportForm } from "./import-form";

export const metadata = { title: "Importar motoristas" };

export default async function Page() {
  const admin = await requireAdmin();
  assertCanWrite(admin);
  const trainings = (await listTrainings(admin)).filter((t) => t.active && t.published_version);
  return (
    <>
      <PageHeader title="Importar motoristas (CSV)" description={<>Baixe o <a href="/modelo-motoristas.csv" className="font-semibold text-brand-600 underline">modelo de planilha</a>, preencha e salve como CSV.</>} />
      <ImportForm trainings={trainings} />
    </>
  );
}
