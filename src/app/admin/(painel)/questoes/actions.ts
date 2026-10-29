"use server";
import { revalidatePath } from "next/cache";
import { createQuestion, deleteQuestion, seedQuestionBank, setQuestionActive, updateQuestion } from "@/server/services/questions";
import { reqCtx, requireAdmin, runAction, type ActionState } from "@/server/web";

function input(f: FormData) {
  return {
    topicId: String(f.get("topicId") ?? ""),
    statement: String(f.get("statement") ?? ""),
    explanation: String(f.get("explanation") ?? ""),
    options: f.getAll("option").map(String),
    correctIndex: f.get("correct") === null ? -1 : Number(f.get("correct")),
  };
}

export async function saveQuestionAction(id: string | null, _: ActionState, f: FormData): Promise<ActionState> {
  return runAction(async () => {
    const admin = await requireAdmin();
    if (id) await updateQuestion(admin, id, input(f), await reqCtx());
    else await createQuestion(admin, input(f), await reqCtx());
    revalidatePath("/admin/questoes");
    return { ok: true, message: id ? "Pergunta atualizada. As provas já feitas continuam com a versão antiga." : "Pergunta cadastrada." };
  });
}

export async function toggleQuestionAction(id: string, active: boolean) {
  await setQuestionActive(await requireAdmin(), id, active, await reqCtx());
  revalidatePath("/admin/questoes");
}

export async function deleteQuestionAction(id: string, _: ActionState): Promise<ActionState> {
  return runAction(async () => {
    await deleteQuestion(await requireAdmin(), id, await reqCtx());
    revalidatePath("/admin/questoes");
    return { ok: true, message: "Pergunta excluída." };
  });
}

export async function seedAction(_: ActionState): Promise<ActionState> {
  return runAction(async () => {
    const n = await seedQuestionBank(await requireAdmin(), await reqCtx());
    revalidatePath("/admin/questoes");
    return { ok: true, message: `${n} perguntas carregadas a partir do documento do treinamento.` };
  });
}
