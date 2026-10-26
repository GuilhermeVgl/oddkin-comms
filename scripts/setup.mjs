import { chmod, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolve } from "node:path";

const path = process.env.CREWSTEAD_ENV_FILE
  ? resolve(process.env.CREWSTEAD_ENV_FILE)
  : new URL("../.env", import.meta.url);
const example = new URL("../.env.example", import.meta.url);

function valueOf(source, key) {
  const match = source.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match?.[1]?.trim() ?? "";
}

function replaceValue(source, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(source)
    ? source.replace(pattern, line)
    : `${source.trimEnd()}\n${line}\n`;
}

function passwordQuestion() {
  return new Promise((resolve, reject) => {
    stdout.write("Senha do admin (mínimo 12 caracteres): ");
    let password = "";
    stdin.setRawMode(true);
    stdin.resume();
    function onData(chunk) {
      for (const character of chunk.toString("utf8")) {
        if (character === "\r" || character === "\n") {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write("\n");
          resolve(password);
          return;
        }
        if (character === "\u0003") {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write("\n");
          reject(new Error("Configuração interrompida."));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          password = password.slice(0, -1);
        } else if (!/[\u0000-\u001f]/u.test(character)) {
          password += character;
        }
      }
    }
    stdin.on("data", onData);
  });
}

function dotenvQuote(value) {
  return `'${value.replaceAll("'", "\\'")}'`;
}

async function main() {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    source = await readFile(example, "utf8");
  }
  const emailConfigured = valueOf(source, "CREWSTEAD_ADMIN_EMAIL");
  const passwordConfigured = valueOf(source, "CREWSTEAD_ADMIN_PASSWORD");
  const appName =
    valueOf(source, "CREWSTEAD_APP_NAME").replace(/^['"]|['"]$/gu, "") ||
    "Crewstead";
  if (emailConfigured && passwordConfigured) {
    await chmod(path, 0o600);
    stdout.write(`Administrador já configurado. Iniciando ${appName}.\n`);
    return;
  }
  if (!stdin.isTTY)
    throw new Error(
      "Execute make start em um terminal interativo para configurar o administrador.",
    );
  const rl = createInterface({ input: stdin, output: stdout });
  let email;
  try {
    email = (await rl.question("E-mail do admin: ")).trim();
  } finally {
    rl.close();
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
    throw new Error("E-mail inválido.");
  const password = await passwordQuestion();
  if (password.length < 12 || /[\r\n]/u.test(password))
    throw new Error(
      "A senha precisa ter ao menos 12 caracteres e não pode conter quebras de linha.",
    );
  source = replaceValue(source, "CREWSTEAD_ADMIN_EMAIL", email);
  source = replaceValue(
    source,
    "CREWSTEAD_ADMIN_PASSWORD",
    dotenvQuote(password),
  );
  await writeFile(path, source, { mode: 0o600 });
  await chmod(path, 0o600);
  stdout.write(`Administrador configurado em .env. Iniciando ${appName}.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
