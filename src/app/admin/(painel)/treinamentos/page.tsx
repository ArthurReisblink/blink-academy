import Link from "next/link";
import { requireAdmin } from "@/server/web";
import { listTrainings } from "@/server/services/trainings";
import { Badge, Card, CardBody, CardTitle, EmptyState, PageHeader } from "@/components/ui/misc";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Submit } from "@/components/submit";
import { ActionForm } from "@/components/action-form";
import { createTrainingAction } from "./actions";

export const metadata = { title: "Treinamentos" };

export default async function Page() {
  const admin = await requireAdmin();
  const list = await listTrainings(admin);
  return (
    <>
      <PageHeader title="Treinamentos" description="Cada treinamento tem versões. Publicar uma nova versão não altera convocações já feitas." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          {list.length === 0 ? <EmptyState title="Nenhum treinamento">Crie o primeiro ao lado.</EmptyState> : list.map((t) => (
            <Link key={t.id} href={`/admin/treinamentos/${t.id}`} className="block">
              <Card className="hover:border-brand-200"><CardBody className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="font-bold">{t.title}</p><p className="text-sm text-slate-500">{t.convocations} convocação(ões)</p></div>
                <div className="flex gap-2">
                  {t.published_version ? <Badge tone="ok">Publicado v{t.published_version}</Badge> : <Badge tone="warn">Não publicado</Badge>}
                  {t.draft_version ? <Badge tone="brand">Rascunho v{t.draft_version}</Badge> : null}
                  {!t.active ? <Badge>Inativo</Badge> : null}
                </div>
              </CardBody></Card>
            </Link>
          ))}
        </div>
        {admin.role !== "auditor" ? (
          <Card><CardBody>
            <CardTitle>Novo treinamento</CardTitle>
            <ActionForm action={createTrainingAction} className="mt-4 space-y-4">
              <Field label="Título" htmlFor="title"><Input id="title" name="title" required placeholder="Na rota do treinamento — POD e PNR" /></Field>
              <Field label="Descrição" htmlFor="description"><Textarea id="description" name="description" rows={3} /></Field>
              <Submit>Criar treinamento</Submit>
            </ActionForm>
          </CardBody></Card>
        ) : null}
      </div>
    </>
  );
}
