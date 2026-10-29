"use server";
import { requestSignatureCode, signTerm } from "@/server/services/signatures";
import { reqCtx, requireDriver } from "@/server/web";
import { isAppError } from "@/lib/errors";

type R = { ok: boolean; error?: string; challengeId?: string; destination?: string };

function fail(e: unknown): R {
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_")) throw e;
  return { ok: false, error: isAppError(e) ? e.message : "Não foi possível concluir. Tente novamente." };
}

export async function sendCodeAction(convId: string): Promise<R> {
  try {
    const r = await requestSignatureCode(await requireDriver(), convId, await reqCtx());
    return { ok: true, challengeId: r.challengeId, destination: r.destinationMask };
  } catch (e) { return fail(e); }
}

export async function signAction(convId: string, input: { challengeId: string; code: string; accepted: boolean; drawing: string | null }): Promise<R> {
  try {
    await signTerm(await requireDriver(), convId, input, await reqCtx());
    return { ok: true };
  } catch (e) { return fail(e); }
}
