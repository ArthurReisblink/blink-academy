/** Situação de uma convocação — calculada sempre no servidor a partir dos registros. */
export const STATUS = {
  aguardando_acesso: { label: "Aguardando acesso", tone: "slate" },
  iniciado: { label: "Treinamento iniciado", tone: "brand" },
  assistindo: { label: "Assistindo aos vídeos", tone: "brand" },
  videos_concluidos: { label: "Vídeos concluídos", tone: "brand" },
  prova_disponivel: { label: "Prova disponível", tone: "accent" },
  prova_em_andamento: { label: "Prova em andamento", tone: "accent" },
  reprovado: { label: "Reprovado", tone: "bad" },
  aprovado_aguardando_assinatura: { label: "Aprovado — aguardando assinatura", tone: "warn" },
  concluido: { label: "Treinamento concluído", tone: "ok" },
  expirado: { label: "Prazo expirado", tone: "bad" },
  bloqueado: { label: "Acesso bloqueado", tone: "bad" },
  cancelado: { label: "Convocação cancelada", tone: "slate" },
} as const;
export type StatusKey = keyof typeof STATUS;

export type StatusInput = {
  blocked_at: Date | null; cancelled_at: Date | null; completed_at: Date | null; expires_at: Date | null;
  first_access_at: Date | null; driver_status: string;
  required_videos: number; completed_required_videos: number; any_video_progress: boolean;
  has_exam: boolean; attempt_in_progress: boolean; passed: boolean; failed_attempts: number; signed: boolean;
};

export function isExpired(expiresAt: Date | null, now: Date) {
  return !!expiresAt && expiresAt.getTime() <= now.getTime();
}

export function videosDone(i: Pick<StatusInput, "required_videos" | "completed_required_videos">) {
  return i.required_videos > 0 && i.completed_required_videos >= i.required_videos;
}

export function computeStatus(i: StatusInput, now: Date = new Date()): StatusKey {
  if (i.cancelled_at) return "cancelado";
  if (i.completed_at) return "concluido";
  if (i.blocked_at || i.driver_status !== "active") return "bloqueado";
  if (isExpired(i.expires_at, now)) return "expirado";
  if (i.passed && !i.signed) return "aprovado_aguardando_assinatura";
  if (i.attempt_in_progress) return "prova_em_andamento";
  if (i.failed_attempts > 0) return "reprovado";
  if (videosDone(i)) return i.has_exam ? "prova_disponivel" : "videos_concluidos";
  if (i.any_video_progress) return "assistindo";
  if (i.first_access_at) return "iniciado";
  return "aguardando_acesso";
}

/** O treinamento só pode ser concluído com vídeos, aprovação e assinatura. */
export function canComplete(i: StatusInput) {
  return videosDone(i) && i.passed && i.signed;
}
export const EXPIRED_MSG = "Seu prazo de treinamento terminou. Entre em contato com a administração da BLINK.";
