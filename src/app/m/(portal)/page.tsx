import Link from "next/link";
import { CheckCircle2, ClipboardCheck, Lock, PlayCircle } from "lucide-react";
import { requireDriver } from "@/server/web";
import { driverHome } from "@/server/services/portal";
import { EXPIRED_MSG } from "@/server/domain/status";
import { fmtDateTime, remainingText } from "@/lib/time";
import { Alert, Card, CardBody, Progress } from "@/components/ui/misc";
import { StatusBadge } from "@/components/status-badge";

export const metadata = { title: "Minha convocação" };

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export default async function Page() {
  const d = await requireDriver();
  const { me, convocations } = await driverHome(d);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-brand-900">Olá, {me.full_name.split(" ")[0]}</h1>
        <p className="text-sm text-slate-600">CPF {me.cpf_mask}</p>
      </div>
      {convocations.length === 0 ? <Alert tone="warn">Você não tem treinamentos liberados no momento.</Alert> : null}
      {convocations.map((c) => {
        const locked = c.status === "expirado" || c.status === "bloqueado";
        const req = c.videos.filter((v) => v.required);
        const doneReq = req.filter((v) => v.completed_at).length;
        return (
          <Card key={c.id}><CardBody className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="text-xs font-bold uppercase tracking-wide text-brand-600">Minha convocação</p>
                <h2 className="text-lg font-extrabold">{c.training_title}</h2></div>
              <StatusBadge status={c.status} />
            </div>
            {c.status === "expirado" ? <Alert tone="bad">{EXPIRED_MSG}</Alert> : null}
            {c.status === "bloqueado" ? <Alert tone="bad">Seu acesso a este treinamento está bloqueado. Entre em contato com a administração da BLINK.</Alert> : null}
            {!locked && c.status !== "concluido" ? (
              <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">Tempo restante: <strong>{remainingText(c.expires_at)}</strong>{c.expires_at ? <> · até {fmtDateTime(c.expires_at)}</> : null}</div>
            ) : null}
            <div>
              <div className="mb-1 flex justify-between text-sm"><span className="font-semibold">Vídeos obrigatórios</span><span>{doneReq} de {req.length}</span></div>
              <Progress value={req.length ? (doneReq / req.length) * 100 : 0} tone={doneReq === req.length && req.length ? "ok" : "brand"} />
            </div>
            <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {c.videos.map((v, i) => {
                const pct = v.covered_seconds ? Math.min(100, (Number(v.covered_seconds) / Number(v.duration_seconds)) * 100) : 0;
                const Icon = v.completed_at ? CheckCircle2 : locked ? Lock : PlayCircle;
                const body = (
                  <div className="flex items-center gap-3 px-3 py-3">
                    <Icon className={`h-7 w-7 shrink-0 ${v.completed_at ? "text-ok-600" : locked ? "text-slate-400" : "text-brand-600"}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{i + 1}. {v.title}</p>
                      <p className="text-xs text-slate-500">{mmss(Number(v.duration_seconds))} · {v.required ? "obrigatório" : "complementar"} · {v.completed_at ? "concluído" : `${Math.floor(pct)}% assistido`}</p>
                      {!v.completed_at && pct > 0 ? <Progress value={pct} className="mt-1 h-1.5" /> : null}
                    </div>
                  </div>
                );
                return <li key={v.video_id}>{locked ? body : <Link href={`/m/c/${c.id}/v/${v.video_id}`} className="block hover:bg-slate-50">{body}</Link>}</li>;
              })}
            </ol>
            {c.has_exam ? (
              <div className="rounded-lg border border-slate-200 px-3 py-3">
                <div className="flex items-center gap-3">
                  <ClipboardCheck className={`h-7 w-7 shrink-0 ${c.passed ? "text-ok-600" : "text-accent-600"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">Avaliação</p>
                    <p className="text-xs text-slate-500">
                      {c.passed ? `Aprovado com ${Number(c.best_score)}%` : `${c.attempts_used} de ${c.max_attempts} tentativa(s) usadas${c.best_score ? ` · melhor nota ${Number(c.best_score)}%` : ""}`}
                    </p>
                  </div>
                </div>
                {!locked && !c.passed && doneReq === req.length && req.length ? (
                  <Link href={`/m/c/${c.id}/prova`} className="mt-3 flex h-14 w-full items-center justify-center rounded-lg bg-accent-500 text-lg font-extrabold text-white hover:bg-accent-600">
                    {c.attempt_in_progress ? "CONTINUAR AVALIAÇÃO" : c.attempts_used ? "VER RESULTADO / NOVA TENTATIVA" : "INICIAR AVALIAÇÃO"}
                  </Link>
                ) : null}
                {!locked && !c.passed && doneReq < req.length ? <p className="mt-2 text-xs text-slate-500">Liberada após concluir todos os vídeos obrigatórios.</p> : null}
                {c.passed ? <Link href={`/m/c/${c.id}/prova`} className="mt-2 inline-block text-sm font-semibold text-brand-600 underline">Ver resultado</Link> : null}
              </div>
            ) : null}
            {c.passed && !c.signed && !locked ? (
              <Link href={`/m/c/${c.id}/termo`} className="flex h-14 w-full items-center justify-center rounded-lg bg-ok-600 text-lg font-extrabold text-white hover:bg-green-800">ASSINAR TERMO</Link>
            ) : null}
            {c.signed ? (
              <Link href={`/m/c/${c.id}/termo`} className="flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 text-lg font-bold text-white">Ver comprovante e termo assinado</Link>
            ) : null}
          </CardBody></Card>
        );
      })}
    </div>
  );
}
