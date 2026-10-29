"use server";
import { redirect } from "next/navigation";
import { saveAnswer, startAttempt, submitAttempt } from "@/server/services/exams";
import { requireDriver, runAction, type ActionState } from "@/server/web";
import { AppError } from "@/lib/errors";

export async function startExamAction(convId: string, _: ActionState): Promise<ActionState> {
  let id = "";
  const r = await runAction(async () => { id = await startAttempt(await requireDriver(), convId); });
  if (r?.ok && id) redirect(`/m/c/${convId}/prova/${id}`);
  return r;
}

export async function saveAnswerAction(attemptId: string, questionId: string, optionId: string): Promise<{ ok: boolean; error?: string; closed?: boolean }> {
  try {
    await saveAnswer(await requireDriver(), attemptId, questionId, optionId);
    return { ok: true };
  } catch (e) {
    rethrowNext(e);
    const err = e as AppError;
    return { ok: false, error: err instanceof AppError ? err.message : "Não foi possível salvar a resposta. Verifique a internet.", closed: err instanceof AppError && ["submitted", "time", "closed"].includes(err.code) };
  }
}

export async function submitExamAction(convId: string, attemptId: string, answers: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
  try {
    await submitAttempt(await requireDriver(), attemptId, answers);
  } catch (e) {
    rethrowNext(e);
    if (!(e instanceof AppError) || e.code !== "submitted") return { ok: false, error: e instanceof AppError ? e.message : "Não foi possível enviar. Tente novamente." };
  }
  redirect(`/m/c/${convId}/prova/${attemptId}`);
}

function rethrowNext(e: unknown) {
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_")) throw e;
}
