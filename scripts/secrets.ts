import { randomBytes } from "node:crypto";
const b = (n: number) => randomBytes(n).toString("base64");
console.log(`DATA_ENCRYPTION_KEY=${b(32)}`);
console.log(`HASH_PEPPER=${b(32)}`);
console.log(`MEDIA_SIGNING_SECRET=${b(32)}`);
console.log(`CRON_SECRET=${randomBytes(24).toString("hex")}`);
console.log("\nGuarde estes valores em local seguro. Se perder DATA_ENCRYPTION_KEY ou HASH_PEPPER, os CPFs cadastrados não poderão ser lidos nem localizados.");
