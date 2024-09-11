import { execSync } from "node:child_process";

execSync(
  "cd src && deno cache createServer.ts && deno run --allow-all createServer.ts",
);
