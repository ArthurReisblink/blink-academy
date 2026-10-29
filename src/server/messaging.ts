import "server-only";
import type { Tx } from "@/lib/db";
import { env } from "@/lib/env";

export type Message = { channel: "sms" | "email"; to: string; subject: string; text: string };

/**
 * Envio de códigos. Em produção configure MESSAGING_DRIVER=resend (e-mail)
 * e/ou twilio (SMS). "console" grava na tabela dev_outbox e só pode ser
 * usado fora de produção.
 */
export async function sendMessage(tx: Tx, msg: Message): Promise<void> {
  const driver = env.messagingDriver;
  if (driver === "console") {
    if (env.isProduction && process.env.ALLOW_CONSOLE_MESSAGING !== "true") {
      throw new Error("MESSAGING_DRIVER=console não pode ser usado em produção");
    }
    await tx`insert into dev_outbox (channel, destination, body) values (${msg.channel}, ${msg.to}, ${msg.text})`;
    if (!process.env.VITEST) console.info(`[código ${msg.channel} → ${msg.to}] ${msg.text}`);
    return;
  }
  if (msg.channel === "email") {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY não configurada");
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.RESEND_FROM, to: [msg.to], subject: msg.subject, text: msg.text }),
    });
    if (!r.ok) throw new Error(`Falha no envio de e-mail (${r.status})`);
    return;
  }
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("Credenciais Twilio não configuradas");
  const body = new URLSearchParams({ To: msg.to, From: process.env.TWILIO_FROM ?? "", Body: msg.text });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`Falha no envio de SMS (${r.status})`);
}
