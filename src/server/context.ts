export type ReqCtx = { ip: string; userAgent: string; now?: Date };
export const nowOf = (ctx?: { now?: Date }) => ctx?.now ?? new Date();
export type AdminPrincipal = { id: string; role: "superadmin" | "admin" | "auditor"; name: string; email: string; sessionId: string };
export type DriverPrincipal = { id: string; name: string; sessionId: string; otpChallengeId: string | null };
