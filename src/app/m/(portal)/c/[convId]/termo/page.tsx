import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Download, FileText } from "lucide-react";
import { requireDriver } from "@/server/web";
import { signingState } from "@/server/services/signatures";
import { fmtDateTime } from "@/lib/time";
import { Alert, Card, CardBody } from "@/components/ui/misc";
import { Signer } from "./signer";

export const metadata = { title: "Termo do treinamento" };

export default async function Page({ params }: { params: Promise<{ convId: string }> }) {
  const d = await requireDriver();
  const { convId } = await params;
  const st = await signingState(d, convId);
  if (!st) redirect("/m");
  const doc = (k: string) => `/api/m/doc?k=${k}&c=${convId}`;
  return (
    <div className="space-y-5">
      <p className="text-sm"><Link href="/m" className="font-semibold text-brand-600">← Voltar</Link></p>
      <h1 className="text-2xl font-extrabold text-brand-900">Termo do treinamento</h1>
      {st.signature ? (
        <>
          <Card className="border-ok-600"><CardBody className="space-y-2 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-ok-600" aria-hidden />
            <p className="text-xl font-extrabold text-ok-600">TREINAMENTO CONCLUÍDO</p>
            <p className="text-sm">Termo assinado em {fmtDateTime(st.signature.signed_at)}.</p>
            <p className="text-sm">Código da assinatura: <b className="font-mono">{st.signature.verification_code}</b></p>
            {st.certificate ? <p className="text-sm">Comprovante: <b className="font-mono">{st.certificate.code}</b></p> : null}
          </CardBody></Card>
          <div className="grid gap-3">
            {st.certificate && !st.certificate.revoked_at ? <a href={doc("certificate")} className="flex h-14 items-center justify-center gap-2 rounded-lg bg-brand-600 text-lg font-bold text-white"><Download className="h-5 w-5" aria-hidden /> Baixar comprovante</a> : null}
            <a href={doc("signed")} className="flex h-12 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white font-semibold"><FileText className="h-5 w-5" aria-hidden /> Termo assinado (PDF)</a>
          </div>
        </>
      ) : (
        <>
          {st.term ? (
            <Card><CardBody className="space-y-2 text-sm">
              <p className="font-bold">{st.term.title}</p>
              <p className="text-slate-500">Versão {st.term.version_label}{st.term.page_count ? ` · ${st.term.page_count} página(s)` : ""}</p>
              <a href={doc("term")} target="_blank" rel="noopener" className="flex h-12 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white font-semibold"><FileText className="h-5 w-5" aria-hidden /> Ler o termo completo (PDF)</a>
            </CardBody></Card>
          ) : null}
          {st.reason ? <Alert tone={st.conv.status === "expirado" || st.conv.status === "bloqueado" ? "bad" : "warn"}>{st.reason}</Alert> : null}
          {st.canSign && st.term ? <Signer convId={convId} declaration={st.term.declaration} /> : null}
        </>
      )}
    </div>
  );
}
