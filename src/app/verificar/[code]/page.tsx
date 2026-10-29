import Link from "next/link";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { verifyDocument } from "@/server/services/signatures";
import { reqCtx } from "@/server/web";
import { isAppError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/time";
import { Alert, Card, CardBody, Logo } from "@/components/ui/misc";
import { FileCheck } from "./file-check";

export const metadata = { title: "Verificação de documento", robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  let v = null, limited = false;
  try { v = await verifyDocument(decodeURIComponent(code), await reqCtx()); } catch (e) { if (isAppError(e) && e.status === 429) limited = true; else throw e; }
  return (
    <main className="mx-auto max-w-lg space-y-6 px-4 py-10">
      <Logo className="h-12" />
      {limited ? <Alert tone="warn">Muitas consultas seguidas. Aguarde alguns minutos.</Alert> : !v ? (
        <Card className="border-bad-600"><CardBody className="space-y-2 text-center">
          <XCircle className="mx-auto h-12 w-12 text-bad-600" aria-hidden />
          <p className="text-lg font-extrabold">Documento não encontrado</p>
          <p className="text-sm text-slate-600">Confira o código digitado. Documentos alterados ou falsificados não são reconhecidos.</p>
        </CardBody></Card>
      ) : (
        <Card className={v.revoked ? "border-amber-500" : "border-ok-600"}><CardBody className="space-y-3">
          <div className="text-center">
            {v.revoked ? <AlertTriangle className="mx-auto h-12 w-12 text-amber-600" aria-hidden /> : <CheckCircle2 className="mx-auto h-12 w-12 text-ok-600" aria-hidden />}
            <p className="text-lg font-extrabold">{v.revoked ? "Comprovante REVOGADO" : v.kind === "certificate" ? "Comprovante de conclusão válido" : "Termo assinado válido"}</p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">Código</dt><dd className="font-mono font-semibold">{v.code}</dd>
            <dt className="text-slate-500">Treinamento</dt><dd>{v.training_title} — versão {v.training_version}</dd>
            <dt className="text-slate-500">Titular</dt><dd>{v.holder} <span className="text-xs text-slate-400">(iniciais)</span></dd>
            <dt className="text-slate-500">{v.kind === "certificate" ? "Emitido em" : "Assinado em"}</dt><dd>{fmtDateTime(v.issued_at)}</dd>
          </dl>
          <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs">
            <p className="font-semibold">SHA-256 do PDF {v.kind === "certificate" ? "do comprovante" : "do termo assinado"}</p>
            <p className="break-all font-mono">{v.pdf_sha256}</p>
            {v.kind === "certificate" && v.extra_sha256 ? <><p className="pt-1 font-semibold">SHA-256 do termo assinado</p><p className="break-all font-mono">{v.extra_sha256}</p></> : null}
          </div>
          <FileCheck hashes={[v.pdf_sha256, ...(v.kind === "certificate" && v.extra_sha256 ? [v.extra_sha256] : [])]} />
        </CardBody></Card>
      )}
      <p className="text-center text-sm"><Link href="/verificar" className="font-semibold text-brand-600 underline">Verificar outro código</Link></p>
    </main>
  );
}
