import { requireAdmin } from "@/server/web";
import { assertCanWrite } from "@/server/auth/admin";
import { listBases } from "@/server/services/bases";
import { listTrainings } from "@/server/services/trainings";
import { Card, CardBody, CardTitle, PageHeader } from "@/components/ui/misc";
import { Field, Input, Select } from "@/components/ui/form";
import { Submit } from "@/components/submit";
import { ActionForm } from "@/components/action-form";
import { DeadlineFields } from "@/components/deadline-fields";
import { DriverFields } from "../driver-fields";
import { createDriverAction } from "../actions";

export const metadata = { title: "Novo motorista" };

export default async function Page() {
  const admin = await requireAdmin();
  assertCanWrite(admin);
  const [bases, trainings] = await Promise.all([listBases(admin), listTrainings(admin)]);
  const available = trainings.filter((t) => t.active && t.published_version);
  return (
    <>
      <PageHeader title="Novo motorista" description="O cadastro é feito só pela administração. O motorista acessa com CPF + código enviado ao contato cadastrado." />
      <ActionForm action={createDriverAction} className="space-y-6">
        <Card><CardBody className="space-y-4"><CardTitle>Dados do motorista</CardTitle><DriverFields bases={bases} /></CardBody></Card>
        <Card><CardBody className="space-y-4">
          <CardTitle>Convocação</CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Treinamento" htmlFor="trainingId" hint={available.length ? undefined : "Nenhum treinamento publicado ainda."}>
              <Select id="trainingId" name="trainingId" defaultValue={available[0]?.id ?? ""}>
                <option value="">Não convocar agora</option>
                {available.map((t) => <option key={t.id} value={t.id}>{t.title} (v{t.published_version})</option>)}
              </Select>
            </Field>
            <Field label="Ocorrência PNR (número ou referência)" htmlFor="pnrReference"><Input id="pnrReference" name="pnrReference" placeholder="Opcional" /></Field>
          </div>
          <DeadlineFields />
        </CardBody></Card>
        <Submit size="lg">Cadastrar motorista</Submit>
      </ActionForm>
    </>
  );
}
