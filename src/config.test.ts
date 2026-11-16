import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { configPath, loadConfig, readConfig } from "./config.js";

async function withConfig(
  text: string | undefined,
  run: (file: string) => void,
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "diffmap-config-"));
  const file = path.join(dir, "diffmap.json");
  if (text !== undefined) await fs.writeFile(file, text);
  try {
    run(file);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("configPath follows XDG_CONFIG_HOME on every platform, then the platform default", () => {
  assert.equal(
    configPath({ XDG_CONFIG_HOME: "/x" }, "darwin", "/home/me"),
    "/x/diffmap/diffmap.json",
  );
  assert.equal(
    configPath({ XDG_CONFIG_HOME: "C:\\x" }, "win32", "C:\\Users\\me"),
    "C:\\x\\diffmap\\diffmap.json",
  );
  assert.equal(
    configPath({}, "darwin", "/Users/me"),
    "/Users/me/.config/diffmap/diffmap.json",
  );
  assert.equal(
    configPath({}, "linux", "/home/me"),
    "/home/me/.config/diffmap/diffmap.json",
  );
  assert.equal(
    configPath(
      { APPDATA: "C:\\Users\\me\\AppData\\Roaming" },
      "win32",
      "C:\\Users\\me",
    ),
    "C:\\Users\\me\\AppData\\Roaming\\diffmap\\diffmap.json",
  );
});

test("a file key fills an unset variable and loses to a set one, including an empty string", async () => {
  await withConfig(
    '{ DIFFMAP_A: "file", DIFFMAP_B: "file", DIFFMAP_C: "file" }',
    (file) => {
      const settings = readConfig(file);
      assert.ok(!(settings instanceof Error) && settings !== undefined);
      const env: NodeJS.ProcessEnv = { DIFFMAP_B: "env", DIFFMAP_C: "" };
      for (const [key, value] of Object.entries(settings)) env[key] ??= value;
      assert.deepEqual(env, {
        DIFFMAP_A: "file",
        DIFFMAP_B: "env",
        DIFFMAP_C: "",
      });
    },
  );
});

test("loadConfig applies the file at the XDG path to the given environment", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "diffmap-config-"));
  try {
    await fs.mkdir(path.join(dir, "diffmap"));
    await fs.writeFile(
      path.join(dir, "diffmap", "diffmap.json"),
      '{ DIFFMAP_TELEMETRY: "0" }',
    );
    const env: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: dir };
    loadConfig(env, "linux");
    assert.equal(env.DIFFMAP_TELEMETRY, "0");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("comments and trailing commas parse", async () => {
  await withConfig(
    '// why\n{\n  /* a */ DIFFMAP_A: \'x\',\n  "DIFFMAP_B": "y",\n}\n',
    (file) => {
      assert.deepEqual(readConfig(file), { DIFFMAP_A: "x", DIFFMAP_B: "y" });
    },
  );
});

test("invalid JSON5 and non-string values fail with the path", async () => {
  await withConfig("{ DIFFMAP_A: ", (file) => {
    const result = readConfig(file);
    assert.ok(result instanceof Error);
    assert.ok(result.message.includes(file));
  });
  await withConfig("{ DIFFMAP_A: 1 }", (file) => {
    const result = readConfig(file);
    assert.ok(result instanceof Error);
    assert.ok(result.message.includes(file));
    assert.ok(result.message.includes("DIFFMAP_A"));
  });
});

test("a key without the DIFFMAP_ prefix warns and is skipped", async () => {
  await withConfig('{ DIFMAP_A: "x", DIFFMAP_B: "y" }', (file) => {
    const warnings: string[] = [];
    assert.deepEqual(
      readConfig(file, (message) => warnings.push(message)),
      { DIFFMAP_B: "y" },
    );
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0]?.includes("DIFMAP_A"));
  });
});

test("a missing file changes nothing", async () => {
  await withConfig(undefined, (file) => {
    assert.equal(readConfig(file), undefined);
  });
});
