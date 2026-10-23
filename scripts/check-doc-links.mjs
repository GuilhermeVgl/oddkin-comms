import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function slug(heading) {
  return heading
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

const files = execFileSync("rg", ["--files", "-g", "*.md"], {
  encoding: "utf8",
})
  .trim()
  .split("\n");
let errors = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^[a-z][a-z\d+.-]*:/i.test(target)) continue;
    const [relative, fragment] = target.split("#", 2);
    const targetFile = path.resolve(
      path.dirname(file),
      decodeURIComponent(relative || file),
    );
    if (!existsSync(targetFile)) {
      process.stderr.write(`${file}: broken link ${target}\n`);
      errors++;
      continue;
    }
    if (fragment) {
      const headings = readFileSync(targetFile, "utf8")
        .split("\n")
        .filter((line) => /^#{1,6} /.test(line))
        .map((line) => slug(line.replace(/^#{1,6} /, "")));
      if (!headings.includes(decodeURIComponent(fragment))) {
        process.stderr.write(`${file}: broken anchor ${target}\n`);
        errors++;
      }
    }
  }
}
if (errors > 0) process.exitCode = 1;
else
  process.stdout.write(
    `Checked relative links in ${files.length} Markdown files\n`,
  );
