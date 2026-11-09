import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("a failed database dump never produces a successful backup", () => {
  const dir = mkdtempSync(join(tmpdir(), "crewstead-backup-test-"));
  try {
    const pgDump = join(dir, "pg_dump");
    writeFileSync(pgDump, "#!/bin/sh\necho broken\nexit 1\n");
    chmodSync(pgDump, 0o755);
    const password = join(dir, "password");
    writeFileSync(password, "synthetic-passphrase");
    const output = join(dir, "output");
    const result = spawnSync("bash", [resolve("scripts/backup.sh")], {
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        DATABASE_URL: "synthetic",
        BACKUP_DIR: output,
        BACKUP_PASSPHRASE_FILE: password,
      },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.deepEqual(readdirSync(join(output, "daily")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
