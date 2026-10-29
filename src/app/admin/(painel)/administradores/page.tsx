import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/web";
import { listAdmins } from "@/server/services/admin-tools";
import { fmtDateTime } from "@/lib/time";
import { Badge, Card, CardBody, CardTitle, PageHeader } from "@/components/ui/misc";
import { Field, Input, Select } from "@/components/ui/form";
import { ActionForm } from "@/components/action-form";
import { Submit } from "@/components/submit";
import { activeAction, createAdminAction, resetAction, roleAction } from "./actions";

export const metadata = { title: "Administradores" };
const ROLE = { superadmin: "Superadministrador", admin: "Administrador", auditor: "Auditor (somente leitura)" };

export default async function Page() {
  const admin = await requireAdmin();
  if (admin.role !== "superadmin") redirect("/admin");
  const admins = await listAdmins(admin);
  return (
    <>
      <PageHeader title="Administradores" description="Todos entram com senha + código do aplicativo autenticador. Não há cadastro público." />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          {admins.map((a) => (
            <Card key={a.id}><CardBody className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="font-bold">{a.name} {a.id === admin.id ? <span className="text-xs font-normal text-slate-500">(você)</span> : null}</p><p className="text-sm text-slate-500">{a.email}</p></div>
                <div className="flex flex-wrap gap-1">
                  <Badge tone="brand">{ROLE[a.role]}</Badge>
                  {a.active ? null : <Badge tone="bad">Desativado</Badge>}
                  {a.totp_enabled_at ? <Badge tone="ok">Autenticador ativo</Badge> : <Badge tone="warn">Autenticador pendente</Badge>}
                  {a.locked_until && a.locked_until > new Date() ? <Badge tone="bad">Bloqueado por tentativas</Badge> : null}
                </div>
              </div>
              <p className="text-xs text-slate-500">Último acesso: {fmtDateTime(a.last_login_at)} · criado em {fmtDateTime(a.created_at)}</p>
              {a.id !== admin.id ? (
                <details className="text-sm"><summary className="cursor-pointer font-semibold text-brand-600">Gerenciar</summary>
                  <div className="mt-3 space-y-4">
                    <ActionForm action={roleAction.bind(null, a.id)} className="flex flex-wrap items-end gap-2">
                      <Select name="role" defaultValue={a.role} className="w-64">{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                      <Submit variant="outline" size="sm">Alterar perfil</Submit>
                    </ActionForm>
                    <ActionForm action={resetAction.bind(null, a.id)} className="flex flex-wrap items-end gap-2">
                      <Input name="password" type="password" placeholder="Nova senha provisória (opcional)" autoComplete="new-password" className="w-64" />
                      <label className="flex items-center gap-2"><input type="checkbox" name="totp" /> redefinir autenticador</label>
                      <Submit variant="outline" size="sm">Redefinir acesso</Submit>
                    </ActionForm>
                    <ActionForm action={activeAction.bind(null, a.id, !a.active)} confirm={a.active ? "Desativar este administrador?" : undefined}>
                      <Submit variant={a.active ? "danger" : "success"} size="sm">{a.active ? "Desativar" : "Reativar"}</Submit>
                    </ActionForm>
                  </div>
                </details>
              ) : null}
            </CardBody></Card>
          ))}
        </div>
        <Card><CardBody>
          <CardTitle>Novo administrador</CardTitle>
          <ActionForm action={createAdminAction} className="mt-4 space-y-4">
            <Field label="Nome" htmlFor="name"><Input id="name" name="name" required /></Field>
            <Field label="E-mail" htmlFor="email"><Input id="email" name="email" type="email" required /></Field>
            <Field label="Perfil" htmlFor="role"><Select id="role" name="role" defaultValue="admin">{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Senha provisória" htmlFor="password" hint="Mínimo de 12 caracteres, com letras maiúsculas, minúsculas, números e símbolo. Envie por canal seguro."><Input id="password" name="password" type="password" autoComplete="new-password" required /></Field>
            <Submit>Criar administrador</Submit>
          </ActionForm>
        </CardBody></Card>
      </div>
    </>
  );
}
