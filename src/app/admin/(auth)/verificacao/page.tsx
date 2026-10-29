import Link from "next/link";
import { adminTotpSetup } from "@/server/auth/admin";
import { isAppError } from "@/lib/errors";
import { COOKIES, readCookie, reqCtx } from "@/server/web";
import { Alert } from "@/components/ui/misc";
import { TotpForm } from "../forms";

export const metadata = { title: "Verificação em duas etapas" };

export default async function Page() {
  const mfa = await readCookie(COOKIES.adminMfa);
  if (!mfa) {
    return <Alert tone="warn" title="Etapa expirada"><Link className="underline" href="/admin/entrar">Entre novamente</Link>.</Alert>;
  }
  let setup: Awaited<ReturnType<typeof adminTotpSetup>> | null = null;
  try {
    setup = await adminTotpSetup(mfa, await reqCtx());
  } catch (e) {
    if (!isAppError(e)) throw e;
    if (e.code !== "already_enrolled") {
      return <Alert tone="warn" title="Etapa expirada">{e.message} <Link className="underline" href="/admin/entrar">Entrar</Link></Alert>;
    }
  }
  return (
    <>
      <h1 className="text-xl font-extrabold">Verificação em duas etapas</h1>
      {setup ? (
        <div className="mb-5 mt-2 space-y-3 text-sm text-slate-700">
          <p>Primeiro acesso: cadastre o autenticador. Abra o Google Authenticator, Microsoft Authenticator ou similar e leia o QR code.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qrDataUrl} alt="QR code do autenticador" className="mx-auto h-48 w-48" />
          <p className="text-xs text-slate-500">Sem câmera? Digite a chave: <code className="break-all font-mono">{setup.secret}</code></p>
        </div>
      ) : (
        <p className="mb-5 mt-1 text-sm text-slate-600">Abra o aplicativo autenticador e digite o código atual.</p>
      )}
      <TotpForm />
    </>
  );
}
