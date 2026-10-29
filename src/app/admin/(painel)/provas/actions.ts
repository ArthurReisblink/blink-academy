"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createExam, setExamQuestions, updateExam, type ExamInput } from "@/server/services/exams";
import { reqCtx, requireAdmin, runAction, type ActionState } from "@/server/web";

function input(f: FormData): ExamInput {
  const n = (k: string) => Number(String(f.get(k) ?? "").replace(",", "."));
  const limit = String(f.get("timeLimitMinutes") ?? "").trim();
  return {
    title: String(f.get("title") ?? ""), description: String(f.get("description") ?? ""),
    questionCount: n("questionCount"), passPct: n("passPct"), maxAttempts: n("maxAttempts"),
    timeLimitMinutes: limit ? Number(limit) : null,
    selectionMode: f.get("selectionMode") === "manual" ? "manual" : "random",
    topicIds: f.getAll("topicIds").map(String),
    shuffleQuestions: f.get("shuffleQuestions") === "on", shuffleOptions: f.get("shuffleOptions") === "on",
    displayMode: f.get("displayMode") === "all" ? "all" : "one",
    active: f.get("active") === null ? true : f.getAll("active").includes("on"),
  };
}

export async function createExamAction(_: ActionState, f: FormData): Promise<ActionState> {
  let id = "";
  const r = await runAction(async () => { id = await createExam(await requireAdmin(), input(f), await reqCtx()); });
  if (r?.ok && id) redirect(`/admin/provas/${id}`);
  return r;
}

export async function updateExamAction(id: string, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    await updateExam(await requireAdmin(), id, input(f), await reqCtx());
    revalidatePath(`/admin/provas/${id}`);
    return { ok: true, message: "Configurações salvas. Valem para as próximas tentativas; as provas já iniciadas mantêm as regras originais." };
  });
}

export async function examQuestionsAction(id: string, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ids = f.getAll("q").map(String);
    await setExamQuestions(await requireAdmin(), id, ids, await reqCtx());
    revalidatePath(`/admin/provas/${id}`);
    return { ok: true, message: `${ids.length} perguntas selecionadas.` };
  });
}
