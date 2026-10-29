/** Erro de regra de negócio com mensagem segura para mostrar ao usuário. */
export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = "AppError";
  }
}
export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
