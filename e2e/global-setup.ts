import { hash } from "@node-rs/argon2";
import { sql, E2E_ADMIN } from "./db";

/** Prepara um superadministrador exclusivo dos testes (somente em banco de desenvolvimento). */
export default async function globalSetup() {
  if (process.env.NODE_ENV === "production" || (process.env.MESSAGING_DRIVER ?? "console") !== "console") {
    throw new Error("Os testes E2E só rodam em ambiente de desenvolvimento com MESSAGING_DRIVER=console.");
  }
  const h = await hash(E2E_ADMIN.password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  await sql`insert into academy.admins (email, name, role, password_hash) values (${E2E_ADMIN.email}, 'Admin E2E', 'superadmin', ${h})
    on conflict (lower(email)) do update set password_hash = excluded.password_hash, active = true, role = 'superadmin',
      totp_secret_enc = null, totp_enabled_at = null, totp_last_step = null, failed_logins = 0, locked_until = null`;
  await sql`delete from academy.rate_limits`;
  await sql.end();
}
