import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new AppError("validation", r.error.issues[0]?.message ?? "Dados inválidos.");
  return r.data;
}

export const uuid = z.string().uuid("Identificador inválido.");
export const optText = (max = 500) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
