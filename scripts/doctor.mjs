import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";

function command(name, args) {
  try {
    return execFileSync(name, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }).trim();
  } catch {
    throw new Error(`${name} ${args.join(" ")} failed or is unavailable`);
  }
}

function requireVersion(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, found ${actual}`);
  }
  process.stdout.write(`${label}: ${actual}\n`);
}

function requireMinimumVersion(label, actual, minimum) {
  if (
    !/^\d+\.\d+\.\d+$/.test(actual) ||
    actual.localeCompare(minimum, undefined, { numeric: true }) < 0
  ) {
    throw new Error(`${label}: expected at least ${minimum}, found ${actual}`);
  }
  process.stdout.write(`${label}: ${actual} (minimum ${minimum})\n`);
}

async function requireFreePort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () =>
      reject(new Error(`port ${port} on 127.0.0.1 is unavailable`)),
    );
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
  process.stdout.write(`test port ${port}: available\n`);
}

const expectedGo = readFileSync("go.mod", "utf8").match(/^go (\S+)$/m)?.[1];
if (!expectedGo) throw new Error("go.mod has no pinned Go version");
requireVersion(
  "Go",
  command("go", ["version"]).split(" ")[2],
  `go${expectedGo}`,
);
requireVersion(
  "Node",
  process.version,
  `v${readFileSync(".node-version", "utf8").trim()}`,
);
const manager = JSON.parse(readFileSync("package.json", "utf8")).packageManager;
if (!manager?.startsWith("pnpm@"))
  throw new Error("packageManager must pin pnpm");
requireVersion(
  "pnpm",
  command("corepack", ["pnpm", "--version"]),
  manager.slice(5),
);
requireMinimumVersion(
  "Docker Engine",
  command("docker", ["version", "--format", "{{.Server.Version}}"]),
  readFileSync(".docker-version", "utf8").trim(),
);
const compose = command("docker", ["compose", "version", "--short"]).replace(
  /-desktop\.\d+$/,
  "",
);
requireMinimumVersion(
  "Docker Compose",
  compose,
  readFileSync(".compose-version", "utf8").trim(),
);
command("docker", ["compose", "-f", "infra/compose.test.yaml", "config", "-q"]);
for (const port of [8080, 5173]) await requireFreePort(port);
