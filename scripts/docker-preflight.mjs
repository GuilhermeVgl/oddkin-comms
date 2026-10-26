import { execFileSync } from "node:child_process";

export const DOCKER_CHECK_MS = 20_000;
export const DOCKER_STEP_MS = 15 * 60_000;

/**
 * Fails fast, with an explanation, when Docker does not answer. A stuck Docker
 * Desktop makes every later `docker run` hang forever, which looks like a
 * stuck gate instead of a missing prerequisite.
 */
export function ensureDockerResponds(
  exec = execFileSync,
  timeout = DOCKER_CHECK_MS,
) {
  try {
    exec("docker", ["info", "--format", "{{.ServerVersion}}"], {
      stdio: ["ignore", "ignore", "pipe"],
      timeout,
      killSignal: "SIGKILL",
    });
  } catch (error) {
    const reason =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "no answer";
    throw new Error(
      `Docker não respondeu em ${Math.round(timeout / 1000)} s (${reason}). ` +
        "Reinicie o Docker Desktop (ou inicie o daemon) e rode de novo. " +
        "Este gate não pula a verificação quando o Docker está ausente.",
      { cause: error },
    );
  }
}
