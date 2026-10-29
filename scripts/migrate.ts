import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });
import { migrate } from "./migrate-lib";

const url = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL;
if (!url) { console.error("Defina DATABASE_URL em .env.local"); process.exit(1); }
migrate(url).then(() => { console.log("Banco atualizado."); }).catch((e) => { console.error(e); process.exit(1); });
