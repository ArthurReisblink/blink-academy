import { config } from "dotenv";
config({ path: ".env.test", override: true, quiet: true });
config({ path: ".env.test.local", override: true, quiet: true });
