import { ensureDockerResponds } from "./docker-preflight.mjs";

try {
  ensureDockerResponds();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
