import { requireAdmin } from "@/server/web";
import { listTerms } from "@/server/services/terms";
import { fmtDateTime } from "@/lib/time";
import { Alert, Badge, Card, CardBody, CardTitle, EmptyState, PageHeader } from "@/components/ui/misc";
import { Field, Input, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { legalAction, modelTermAction, toggleTermAction, uploadTermAction } from "./actions";

export const metadata = { title: "Termos e documentos" };

export default async function Page() {
  const admin = await requireAdmin();
  const terms = await listTerms(admin);
  const canWrite = admin.role !== "auditor";
  return (
    <>
      <PageHeader title="Termos e documentos" description="O termo é vinculado à versão do treinamento e assinado pelo motorista depois da aprovação." />
      <Alert tone="warn" className="mb-6" title="Revisão jurídica obrigatória">O termo deverá ser revisado e aprovado pela área jurídica da BLINK antes do uso oficial. Registre a aprovação em cada versão do termo.</Alert>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {terms.length === 0 ? <EmptyState title="Nenhum termo cadastrado">Envie o PDF aprovado pelo jurídico ou gere um termo-modelo para revisão.</EmptyState> : terms.map((t) => (
            <Card key={t.id}><CardBody className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle>{t.title}</CardTitle>
                  <p className="text-sm text-slate-500">Versão {t.version_label} · {t.page_count ?? "?"} página(s) · {(t.size_bytes / 1024).toFixed(0)} KB · enviado em {fmtDateTime(t.created_at)}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {t.is_model ? <Badge tone="accent">Modelo</Badge> : null}
                  {t.legal_approved_at ? <Badge tone="ok">Aprovado pelo jurídico</Badge> : <Badge tone="warn">Sem aprovação jurídica</Badge>}
                  {!t.active ? <Badge>Inativo</Badge> : null}
                </div>
              </div>
              <p className="rounded-lg bg-slate-50 p-3 text-sm"><b>Declaração aceita pelo motorista:</b> {t.declaration}</p>
              <p className="break-all font-mono text-xs text-slate-500">SHA-256: {t.sha256}</p>
              <p className="text-xs text-slate-500">{t.versions} versão(ões) de treinamento · {t.signatures} assinatura(s)
                {t.legal_approved_at ? <> · aprovação registrada por {t.legal_approver} em {fmtDateTime(t.legal_approved_at)}{t.legal_note ? ` — ${t.legal_note}` : ""}</> : null}</p>
              <div className="flex flex-wrap items-center gap-4 text-sm font-semibold">
                <a href={`/api/admin/term?id=${t.id}`} target="_blank" rel="noopener" className="text-brand-600 underline">Abrir PDF</a>
                {canWrite ? <form action={toggleTermAction.bind(null, t.id, !t.active)}><button className="text-brand-600 underline">{t.active ? "Desativar" : "Reativar"}</button></form> : null}
              </div>
              {canWrite ? (
                t.legal_approved_at ? (
                  <ActionForm action={legalAction.bind(null, t.id, false)} confirm="Remover o registro de aprovação jurídica?"><button className="text-xs font-semibold text-red-600 underline">Remover aprovação jurídica</button></ActionForm>
                ) : (
                  <ActionForm action={legalAction.bind(null, t.id, true)} className="flex flex-wrap items-end gap-2">
                    <Input name="note" placeholder="Referência da aprovação (ex.: parecer nº, responsável)" className="min-w-64 flex-1" />
                    <Submit variant="outline" size="sm">Registrar aprovação jurídica</Submit>
                  </ActionForm>
                )
              ) : null}
            </CardBody></Card>
          ))}
        </div>
        {canWrite ? (
          <div className="space-y-4">
            <Card><CardBody>
              <CardTitle>Enviar termo (PDF)</CardTitle>
              <ActionForm action={uploadTermAction} className="mt-4 space-y-4">
                <Field label="Título" htmlFor="title"><Input id="title" name="title" defaultValue="Termo de ciência e compromisso — treinamento POD e PNR" required /></Field>
                <Field label="Versão" htmlFor="versionLabel" hint="Ex.: 1.0, 2026-11. Cada versão é um registro novo."><Input id="versionLabel" name="versionLabel" required /></Field>
                <Field label="Declaração que o motorista vai aceitar" htmlFor="declaration"><Textarea id="declaration" name="declaration" rows={4} required /></Field>
                <Field label="Arquivo PDF (até 3,5 MB)" htmlFor="file"><Input id="file" name="file" type="file" accept="application/pdf,.pdf" required /></Field>
                <Submit>Enviar termo</Submit>
              </ActionForm>
            </CardBody></Card>
            <Card><CardBody>
              <CardTitle>Termo-modelo</CardTitle>
              <p className="mt-1 text-sm text-slate-600">Gera um PDF de rascunho, marcado como MODELO, para a área jurídica revisar. Não substitui o termo oficial.</p>
              <ActionForm action={modelTermAction} className="mt-3"><Submit variant="outline">Gerar termo-modelo</Submit></ActionForm>
            </CardBody></Card>
          </div>
        ) : null}
      </div>
    </>
  );
}
