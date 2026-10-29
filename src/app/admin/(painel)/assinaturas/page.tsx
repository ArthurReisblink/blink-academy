import Link from "next/link";
import { requireAdmin } from "@/server/web";
import { listSignatures, signatureEvidence } from "@/server/services/signatures";
import { fmtDateTime } from "@/lib/time";
import { Badge, Card, CardBody, EmptyState, PageHeader } from "@/components/ui/misc";
import { Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { revokeAction } from "./actions";

export const metadata = { title: "Assinaturas" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const admin = await requireAdmin();
  const rows = await listSignatures(admin, { q: sp.q || undefined, from: sp.de || undefined, to: sp.ate || undefined });
  const ev = sp.evidencia ? await signatureEvidence(admin, sp.evidencia) : null;
  return (
    <>
      <PageHeader title="Assinaturas" description={`${rows.length} termo(s) assinado(s). Cada assinatura guarda o registro de evidências com hash SHA-256.`} />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <Input name="q" defaultValue={sp.q} placeholder="Nome, CPF ou código" className="max-w-xs" />
        <label className="text-xs text-slate-500">de <Input type="date" name="de" defaultValue={sp.de} className="h-10" /></label>
        <label className="text-xs text-slate-500">até <Input type="date" name="ate" defaultValue={sp.ate} className="h-10" /></label>
        <Button type="submit" variant="outline">Filtrar</Button>
        {sp.q || sp.de || sp.ate ? <Link href="/admin/assinaturas" className="self-center text-sm text-brand-600 underline">Limpar</Link> : null}
      </form>
      {ev ? (
        <Card className="mb-6"><CardBody className="space-y-2">
          <div className="flex items-center justify-between"><p className="font-bold">Registro de evidências</p><Link href="/admin/assinaturas" className="text-sm text-brand-600 underline">Fechar</Link></div>
          <p className="text-sm">{ev.recomputed === ev.evidence_sha256 ? <Badge tone="ok">Íntegro: hash recalculado confere</Badge> : <Badge tone="bad">ATENÇÃO: hash não confere</Badge>}</p>
          <p className="break-all font-mono text-xs">SHA-256: {ev.evidence_sha256}</p>
          <pre className="max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(ev.evidence, null, 2)}</pre>
        </CardBody></Card>
      ) : null}
      {rows.length === 0 ? <EmptyState title="Nenhuma assinatura encontrada" /> : (
        <div className="space-y-3">
          {rows.map((s) => (
            <Card key={s.id}><CardBody className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link href={`/admin/motoristas/${s.driver_id}`} className="font-bold text-brand-700 hover:underline">{s.signer_name}</Link>
                  <span className="ml-2 text-sm text-slate-500">CPF {s.signer_cpf_mask}{s.base_name ? ` · ${s.base_name}` : ""}</span>
                  <p className="text-sm">{s.training_title} — v{s.training_version} · termo “{s.term_title}” v{s.term_version}</p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-semibold">{fmtDateTime(s.signed_at)}</p>
                  <p className="font-mono text-xs">{s.verification_code}</p>
                </div>
              </div>
              <p className="text-xs text-slate-500">Código confirmado por {s.otp_channel === "email" ? "e-mail" : "SMS"} ({s.otp_destination_mask}) · IP {s.ip}</p>
              <div className="flex flex-wrap items-center gap-4 text-sm font-semibold">
                <a className="text-brand-600 underline" href={`/api/admin/doc?k=signed&c=${s.convocation_id}`} target="_blank" rel="noopener">Termo assinado (PDF)</a>
                {s.certificate_code ? <a className="text-brand-600 underline" href={`/api/admin/doc?k=certificate&c=${s.convocation_id}`} target="_blank" rel="noopener">Comprovante {s.certificate_code}</a> : null}
                {s.certificate_revoked ? <Badge tone="bad">Comprovante revogado</Badge> : null}
                <Link className="text-brand-600 underline" href={`/admin/assinaturas?evidencia=${s.id}`}>Evidências</Link>
              </div>
              {admin.role === "superadmin" && s.certificate_code && !s.certificate_revoked ? (
                <details className="text-sm"><summary className="cursor-pointer text-xs font-semibold text-red-600">Revogar comprovante</summary>
                  <ActionForm action={revokeAction.bind(null, s.convocation_id)} confirm="Revogar este comprovante? A ação fica registrada e não pode ser desfeita." className="mt-2 flex flex-wrap gap-2">
                    <Input name="reason" placeholder="Motivo da revogação" required className="min-w-64 flex-1" /><Submit variant="danger" size="sm">Revogar</Submit>
                  </ActionForm>
                </details>
              ) : null}
            </CardBody></Card>
          ))}
        </div>
      )}
    </>
  );
}
