import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { shareMarkdownFile } from "./share.js";

async function withSpec(
  run: (dir: string, scratch: string) => Promise<void>,
  title = "Cover",
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "diffmap-cmd-"));
  const dir = path.join(root, "spec");
  await fs.mkdir(dir);
  await fs.writeFile(path.join(dir, "README.md"), `# ${title}\n`);
  try {
    await run(dir, root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function applyEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function withEnv(
  vars: Record<string, string | undefined>,
  run: () => Promise<void>,
) {
  const saved = Object.fromEntries(
    Object.keys(vars).map((key) => [key, process.env[key]]),
  );
  applyEnv(vars);
  try {
    await run();
  } finally {
    applyEnv(saved);
  }
}

function share(dir: string, scratch: string, isPublic = false) {
  return shareMarkdownFile({
    filePath: dir,
    workspaceRoot: scratch,
    isPublic,
  });
}

test("the command gets the payload on stdin and in DIFFMAP_SHARE_PAYLOAD, and the DIFFMAP_SHARE_* variables", async () => {
  await withSpec(async (dir, scratch) => {
    const out = path.join(scratch, "out");
    const command = [
      `cat > ${JSON.stringify(path.join(scratch, "stdin.json"))}`,
      `cp "$DIFFMAP_SHARE_PAYLOAD" ${JSON.stringify(path.join(scratch, "file.json"))}`,
      `printf '%s\\n' "$DIFFMAP_SHARE_DIR" "$DIFFMAP_SHARE_TITLE" "[$DIFFMAP_SHARE_REPO]" "[$DIFFMAP_SHARE_BRANCH]" "$DIFFMAP_SHARE_ID" "$PWD" > ${JSON.stringify(out)}`,
      "echo progress",
      "echo https://example.com/shared",
      "echo",
    ].join("; ");
    await withEnv({ DIFFMAP_SHARE_CMD: command }, async () => {
      const shared = await share(dir, scratch);
      assert.deepEqual(shared, { url: "https://example.com/shared" });
    });
    const stdin = await fs.readFile(path.join(scratch, "stdin.json"), "utf8");
    assert.equal(
      await fs.readFile(path.join(scratch, "file.json"), "utf8"),
      stdin,
    );
    assert.equal(JSON.parse(stdin).title, "Cover");
    const [, title, repo, branch, id, cwd] = (await fs.readFile(out, "utf8"))
      .trimEnd()
      .split("\n");
    assert.equal(title, "Cover");
    assert.equal(repo, `[${path.basename(scratch)}]`);
    assert.equal(branch, "[]");
    assert.match(id!, /^[0-9a-f-]{36}$/);
    assert.equal(await fs.realpath(cwd!), await fs.realpath(scratch));
  });
});

test("a non-URL last line fails and names it", async () => {
  await withSpec(async (dir, scratch) => {
    await withEnv(
      { DIFFMAP_SHARE_CMD: "echo https://a.example; echo done" },
      async () => {
        const shared = await share(dir, scratch);
        assert.match(String(shared), /not an http or https URL: done/);
      },
    );
  });
});

test("a non-zero exit fails with its code and last line, even when it printed a URL", async () => {
  await withSpec(async (dir, scratch) => {
    await withEnv(
      { DIFFMAP_SHARE_CMD: "echo https://a.example; echo boom; exit 3" },
      async () => {
        const shared = await share(dir, scratch);
        assert.match(String(shared), /exited with code 3: boom/);
      },
    );
  });
});

test("the temp directory is gone after the command exits, on success or failure", async () => {
  await withSpec(async (dir, scratch) => {
    const record = path.join(scratch, "dir");
    for (const tail of ["echo https://a.example", "exit 1"]) {
      await withEnv(
        {
          DIFFMAP_SHARE_CMD: `echo "$DIFFMAP_SHARE_DIR" > ${JSON.stringify(record)}; ${tail}`,
        },
        async () => {
          await share(dir, scratch);
        },
      );
      const shareDir = (await fs.readFile(record, "utf8")).trim();
      await assert.rejects(fs.stat(shareDir));
    }
  });
});

test("--public with a custom command is an error", async () => {
  await withSpec(async (dir, scratch) => {
    await withEnv({ DIFFMAP_SHARE_CMD: "echo https://a.example" }, async () => {
      const shared = await share(dir, scratch, true);
      assert.match(String(shared), /--public only applies to the default gist/);
    });
  });
});

test("an unset DIFFMAP_SHARE_CMD runs share-gist, and --public reaches it", async () => {
  await withSpec(async (dir, scratch) => {
    const bin = path.join(scratch, "bin");
    await fs.mkdir(bin);
    const log = path.join(scratch, "gh.log");
    await fs.writeFile(
      path.join(bin, "gh"),
      [
        "#!/bin/sh",
        'if [ "$1" = auth ]; then exit 0; fi',
        `echo "$@" > ${JSON.stringify(log)}`,
        "echo https://gist.github.com/0123456789abcdef0123456789abcdef",
      ].join("\n"),
      { mode: 0o755 },
    );
    await withEnv(
      {
        DIFFMAP_SHARE_CMD: undefined,
        DIFFMAP_ORIGIN: undefined,
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
      },
      async () => {
        const shared = await share(dir, scratch, true);
        assert.deepEqual(shared, {
          url: "https://diffmap.dev/g/0123456789abcdef0123456789abcdef",
        });
      },
    );
    assert.match(
      await fs.readFile(log, "utf8"),
      /^gist create --public --desc Cover \S+README\.md\n$/,
    );
  });
});
