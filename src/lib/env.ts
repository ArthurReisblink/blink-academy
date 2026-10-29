import "server-only";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ausente: ${name}`);
  return v;
}

export const env = {
  get appUrl() { return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""); },
  get databaseUrl() { return req("DATABASE_URL"); },
  get dataKey() { return req("DATA_ENCRYPTION_KEY"); },
  get pepper() { return req("HASH_PEPPER"); },
  get mediaSecret() { return req("MEDIA_SIGNING_SECRET"); },
  get cronSecret() { return process.env.CRON_SECRET ?? ""; },
  get storageDriver() { return (process.env.STORAGE_DRIVER ?? "local") as "local" | "supabase"; },
  get localStorageDir() { return process.env.LOCAL_STORAGE_DIR ?? "./storage-local"; },
  get supabaseUrl() { return process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""; },
  get supabaseServiceKey() { return process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""; },
  get supabaseBucket() { return process.env.SUPABASE_BUCKET ?? "academy-private"; },
  get messagingDriver() { return (process.env.MESSAGING_DRIVER ?? "console") as "console" | "resend" | "twilio"; },
  get otpPreferred() { return (process.env.OTP_PREFERRED_CHANNEL ?? "sms") as "sms" | "email"; },
  get isProduction() { return process.env.NODE_ENV === "production"; },
};
