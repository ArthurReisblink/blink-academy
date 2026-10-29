import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { requireAdmin } from "@/server/web";
import { getTrainingDetail } from "@/server/services/trainings";
import { listVideos } from "@/server/services/videos";
import { listExams } from "@/server/services/exams";
import { listTerms } from "@/server/services/terms";
import { fmtDateTime } from "@/lib/time";
import { Alert, Badge, Card, CardBody, CardTitle, PageHeader } from "@/components/ui/misc";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Submit } from "@/components/submit";
import { ActionForm } from "@/components/action-form";
import { addVideoAction, moveVideoAction, newVersionAction, publishVersionAction, removeVideoAction, setExamAction, setTermAction, updateTrainingAction, videoRulesAction } from "../actions";

export const metadata = { title: "Treinamento" };

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const statusLabel = { published: "Publicada", draft: "Rascunho", archived: "Arquivada" } as Record<string, string>;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const [t, library, exams, terms] = await Promise.all([getTrainingDetail(admin, id), listVideos(admin), listExams(admin), listTerms(admin)]);
  if (!t) notFound();
  const canWrite = admin.role !== "auditor";
  const hasDraft = t.versions.some((v) => v.status === "draft");
  return (
    <>
      <p className="mb-2 text-sm"><Link href="/admin/treinamentos" className="text-brand-600 hover:underline">← Treinamentos</Link></p>
      <PageHeader title={t.training.title} description={t.training.description ?? undefined}
        actions={canWrite && !hasDraft ? <ActionForm action={newVersionAction.bind(null, t.training.id)}><Submit variant="outline">Criar nova versão</Submit></ActionForm> : null} />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          {t.versions.map((v) => {
            const vids = t.videos[v.id] ?? [];
            const editable = canWrite && v.status === "draft";
            const available = library.filter((l) => l.status === "ready" && !vids.some((x) => x.video_id === l.id));
            return (
              <Card key={v.id} className={v.status === "draft" ? "border-brand-200" : ""}><CardBody className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>Versão {v.version}</CardTitle>
                  <Badge tone={v.status === "published" ? "ok" : v.status === "draft" ? "brand" : "slate"}>{statusLabel[v.status]}</Badge>
                </div>
                <p className="text-xs text-slate-500">Criada em {fmtDateTime(v.created_at)}{v.published_at ? ` · publicada em ${fmtDateTime(v.published_at)}` : ""} · {v.convocations} convocação(ões)</p>
                <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {vids.length === 0 ? <li className="px-3 py-4 text-sm text-slate-500">Nenhum vídeo nesta versão.</li> : vids.map((x, i) => (
                    <li key={x.video_id} className="space-y-2 px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">{i + 1}. {x.title} <span className="text-xs font-normal text-slate-500">{mmss(Number(x.duration_seconds))}</span></p>
                        <div className="flex items-center gap-2">
                          {x.required ? <Badge tone="accent">Obrigatório</Badge> : <Badge>Complementar</Badge>}
                          <Badge tone="brand">mín. {Number(x.completion_pct)}%</Badge>
                          {editable ? <>
                            <form action={moveVideoAction.bind(null, t.training.id, v.id, x.video_id, "up")}><button aria-label="Subir" className="rounded p-1 hover:bg-slate-100" disabled={i === 0}><ArrowUp className="h-4 w-4" /></button></form>
                            <form action={moveVideoAction.bind(null, t.training.id, v.id, x.video_id, "down")}><button aria-label="Descer" className="rounded p-1 hover:bg-slate-100" disabled={i === vids.length - 1}><ArrowDown className="h-4 w-4" /></button></form>
                            <form action={removeVideoAction.bind(null, t.training.id, v.id, x.video_id)}><button aria-label="Remover" className="rounded p-1 text-bad-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button></form>
                          </> : null}
                        </div>
                      </div>
                      {editable ? (
                        <ActionForm action={videoRulesAction.bind(null, t.training.id, v.id, x.video_id)} className="flex flex-wrap items-center gap-3 text-sm">
                          <label className="flex items-center gap-2"><input type="checkbox" name="required" defaultChecked={x.required} /> obrigatório</label>
                          <label className="flex items-center gap-2">reprodução mínima <Input name="pct" type="number" min={50} max={100} step={1} defaultValue={Number(x.completion_pct)} className="h-8 w-20" />%</label>
                          <Submit size="sm" variant="outline">Salvar regras</Submit>
                        </ActionForm>
                      ) : null}
                    </li>
                  ))}
                </ol>
                {editable ? (
                  <ActionForm action={addVideoAction.bind(null, t.training.id, v.id)} className="flex flex-wrap items-end gap-2">
                    <Field label="Adicionar vídeo da biblioteca" htmlFor={`add-${v.id}`} className="min-w-64 flex-1">
                      <Select id={`add-${v.id}`} name="videoId" required>
                        {available.length === 0 ? <option value="">Nenhum vídeo disponível — envie na Biblioteca</option> : available.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                      </Select>
                    </Field>
                    <Submit variant="outline" disabled={!available.length}>Adicionar</Submit>
                  </ActionForm>
                ) : null}
                <div className="rounded-lg border border-slate-200 px-3 py-3 text-sm">
                  <p className="font-semibold">Avaliação</p>
                  {editable ? (
                    <ActionForm action={setExamAction.bind(null, t.training.id, v.id)} className="mt-2 flex flex-wrap items-end gap-2">
                      <Select name="examId" defaultValue={v.exam_id ?? ""} className="min-w-64 flex-1" aria-label="Prova da versão">
                        <option value="">— sem prova —</option>
                        {exams.filter((e) => e.active || e.id === v.exam_id).map((e) => <option key={e.id} value={e.id}>{e.title} ({e.question_count} questões, mín. {Number(e.pass_pct)}%)</option>)}
                      </Select>
                      <Submit variant="outline">Vincular prova</Submit>
                    </ActionForm>
                  ) : v.exam_id ? <p className="mt-1"><Link className="text-brand-600 underline" href={`/admin/provas/${v.exam_id}`}>{v.exam_title}</Link></p> : <p className="mt-1 text-slate-500">Nenhuma prova vinculada.</p>}
                </div>
                <div className="rounded-lg border border-slate-200 px-3 py-3 text-sm">
                  <p className="font-semibold">Termo para assinatura</p>
                  {editable ? (
                    <ActionForm action={setTermAction.bind(null, t.training.id, v.id)} className="mt-2 flex flex-wrap items-end gap-2">
                      <Select name="termId" defaultValue={v.term_id ?? ""} className="min-w-64 flex-1" aria-label="Termo da versão">
                        <option value="">— sem termo —</option>
                        {terms.filter((x) => x.active || x.id === v.term_id).map((x) => <option key={x.id} value={x.id}>{x.title} — v{x.version_label}{x.is_model ? " (MODELO)" : ""}{x.legal_approved_at ? "" : " · sem aprovação jurídica"}</option>)}
                      </Select>
                      <Submit variant="outline">Vincular termo</Submit>
                    </ActionForm>
                  ) : v.term_id ? <p className="mt-1">{v.term_title}</p> : <p className="mt-1 text-slate-500">Nenhum termo vinculado.</p>}
                  {v.term_id && !terms.find((x) => x.id === v.term_id)?.legal_approved_at ? <p className="mt-2 text-xs font-semibold text-amber-700">Este termo ainda não tem aprovação jurídica registrada.</p> : null}
                </div>
                {v.status === "draft" && (t.problems[v.id] ?? []).length ? <Alert tone="warn" title="Para publicar">{t.problems[v.id].join("; ")}.</Alert> : null}
                {editable ? <ActionForm action={publishVersionAction.bind(null, t.training.id, v.id)}><Submit variant="success" disabled={(t.problems[v.id] ?? []).length > 0}>Publicar versão {v.version}</Submit></ActionForm> : null}
              </CardBody></Card>
            );
          })}
        </div>
        <div className="space-y-4">
          {canWrite ? (
            <Card><CardBody>
              <CardTitle>Dados do treinamento</CardTitle>
              <ActionForm action={updateTrainingAction.bind(null, t.training.id)} className="mt-4 space-y-4">
                <Field label="Título" htmlFor="title"><Input id="title" name="title" defaultValue={t.training.title} required /></Field>
                <Field label="Descrição" htmlFor="description"><Textarea id="description" name="description" defaultValue={t.training.description ?? ""} /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={t.training.active} /> Ativo (disponível para novas convocações)</label>
                <Submit>Salvar</Submit>
              </ActionForm>
            </CardBody></Card>
          ) : null}
          <Alert tone="slate" title="Como funcionam as versões">Versões publicadas ficam congeladas. Para trocar ou incluir vídeos, crie uma nova versão (ela copia a anterior), ajuste e publique. Quem já foi convocado continua na versão em que foi convocado.</Alert>
        </div>
      </div>
    </>
  );
}
