import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const gitleaks =
  "ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f";
const trivy =
  "aquasec/trivy:0.76.0@sha256:2416d1f74045b57274df1a340eee6b510cacd73c66a6ccb8da092b117eb7d222";

function run(name, args, options = {}) {
  const output = execFileSync(name, args, {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
    ...options,
  });
  return typeof output === "string" ? output.trim() : output;
}

const secretsOnly =
  process.argv.length === 3 && process.argv[2] === "--secrets-only";
if (process.argv.length > 2 && !secretsOnly) {
  throw new Error("usage: node scripts/security-check.mjs [--secrets-only]");
}
if (!secretsOnly) {
  run("go", ["tool", "govulncheck", "./..."], { stdio: "inherit" });
  run("corepack", ["pnpm", "audit", "--audit-level", "high"], {
    stdio: "inherit",
  });
}

const scanDir = mkdtempSync(path.join(os.tmpdir(), "crewstead-secret-scan-"));
try {
  const files = run("git", ["ls-files", "-co", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean);
  for (const file of files) {
    const dest = path.join(scanDir, file);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(file, dest);
  }
  run(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${scanDir}:/scan:ro`,
      gitleaks,
      "dir",
      "/scan",
      "--no-banner",
      "--exit-code",
      "1",
    ],
    { stdio: "inherit" },
  );
} finally {
  rmSync(scanDir, { recursive: true, force: true });
}
run(
  "docker",
  [
    "run",
    "--rm",
    "-v",
    `${process.cwd()}:/repo:ro`,
    "-w",
    "/repo",
    gitleaks,
    "git",
    ".",
    "--no-banner",
    "--exit-code",
    "1",
  ],
  { stdio: "inherit" },
);

for (const target of secretsOnly ? [] : ["api"]) {
  const image = run("docker", [
    "build",
    "--quiet",
    "--file",
    "infra/Dockerfile.api",
    "--build-arg",
    `TARGET=${target}`,
    ".",
  ]);
  process.stdout.write(`Scanning runtime image ${target}: ${image}\n`);
  run(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      "/var/run/docker.sock:/var/run/docker.sock",
      "-v",
      `${process.cwd()}/.trivy-cache:/root/.cache/trivy`,
      trivy,
      "image",
      "--quiet",
      "--skip-version-check",
      "--scanners",
      "vuln",
      "--severity",
      "HIGH,CRITICAL",
      "--exit-code",
      "1",
      image,
    ],
    { stdio: "inherit" },
  );
}
