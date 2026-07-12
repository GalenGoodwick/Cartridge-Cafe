// Load .env.local first (Next.js convention), then .env as fallback
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // .env fallback — won't override existing vars
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
