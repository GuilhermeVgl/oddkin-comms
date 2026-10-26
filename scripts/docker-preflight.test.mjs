import assert from "node:assert/strict";
import test from "node:test";
import { ensureDockerResponds } from "./docker-preflight.mjs";

test("passes when docker answers", () => {
  let called;
  ensureDockerResponds((name, args) => {
    called = [name, ...args];
    return "";
  }, 1000);
  assert.deepEqual(called.slice(0, 2), ["docker", "info"]);
});

test("explains a docker that times out, and never skips", () => {
  const stuck = () => {
    const error = new Error("spawnSync docker ETIMEDOUT");
    error.code = "ETIMEDOUT";
    throw error;
  };
  assert.throws(
    () => ensureDockerResponds(stuck, 1000),
    /Docker não respondeu em 1 s \(ETIMEDOUT\).*Reinicie o Docker Desktop/s,
  );
});

test("explains a missing docker binary", () => {
  const missing = () => {
    const error = new Error("spawnSync docker ENOENT");
    error.code = "ENOENT";
    throw error;
  };
  assert.throws(() => ensureDockerResponds(missing, 1000), /ENOENT/);
});
