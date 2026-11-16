import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { Validator } from "@cfworker/json-schema";
import { parseSharePayload, publishGist } from "./shareGist.js";
import { buildSharePayload } from "./sharePayload.js";

const execFileAsync = promisify(execFile);
const schema: object = JSON.parse(
  await fs.readFile(
    new URL("../schema/share-payload.v1.json", import.meta.url),
    "utf8",
  ),
);

async function withRepo(run: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "diffmap-payload-"));
  try {
    const git = (...args: string[]) => execFileAsync("git", args, { cwd: dir });
    await git("init", "-q", "-b", "feature");
    await git("remote", "add", "origin", "git@github.com:acme/widgets.git");
    await fs.mkdir(path.join(dir, "spec"));
    await fs.writeFile(path.join(dir, "spec", "README.md"), "# Cover\n");
    await fs.writeFile(
      path.join(dir, "spec", "02-write-through.md"),
      "# Write through\n\n```1:1:notes.txt\n```\n",
    );
    await fs.writeFile(path.join(dir, "notes.txt"), "hello\n");
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("buildSharePayload returns every page and the files excerpts read, matching the schema", async () => {
  await withRepo(async (dir) => {
    const payload = await buildSharePayload(path.join(dir, "spec"), dir);
    assert.ok(!(payload instanceof Error), String(payload));
    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.title, "Cover");
    assert.equal(payload.repo, "widgets");
    assert.equal(payload.branch, "feature");
    assert.deepEqual(
      payload.pages.map(({ file, slug, title }) => [file, slug, title]),
      [
        ["README.md", "", "Cover"],
        ["02-write-through.md", "write-through", "Write through"],
      ],
    );
    assert.equal(payload.pages[0]?.source, "# Cover\n");
    assert.deepEqual(payload.files, { "notes.txt": "hello\n" });
    assert.deepEqual(payload.changes, {});
    const result = new Validator(schema).validate(
      JSON.parse(JSON.stringify(payload)),
    );
    assert.deepEqual(result.errors, []);
  });
});

test("buildSharePayload names the workspace directory without an origin and leaves the branch out when detached", async () => {
  await withRepo(async (dir) => {
    const git = (...args: string[]) => execFileAsync("git", args, { cwd: dir });
    await git("remote", "remove", "origin");
    await git(
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "x",
    );
    await git("checkout", "-q", "--detach");
    const payload = await buildSharePayload(path.join(dir, "spec"), dir);
    assert.ok(!(payload instanceof Error), String(payload));
    assert.equal(payload.repo, path.basename(dir));
    assert.equal(payload.branch, undefined);
  });
});

test("buildSharePayload rejects local media with the gist message", async () => {
  await withRepo(async (dir) => {
    await fs.writeFile(
      path.join(dir, "spec", "README.md"),
      "# Cover\n\n![x](media/a.png)\n",
    );
    const payload = await buildSharePayload(path.join(dir, "spec"), dir);
    assert.equal(
      String(payload),
      "DiffmapShareError: product-doc share failed: a shared gist cannot show local images or videos (media/a.png in README.md). Link them by https URL, or view the spec with serve",
    );
  });
});

test("parseSharePayload rejects unknown schema versions", () => {
  const rejected = parseSharePayload('{"schemaVersion":2}');
  assert.match(String(rejected), /unsupported share payload schemaVersion 2/);
  assert.ok(parseSharePayload("not json") instanceof Error);
});

test("publishGist writes pages and snapshots and passes them to gh gist create", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "diffmap-gh-"));
  const log = path.join(dir, "calls.log");
  const copies = path.join(dir, "copies");
  await fs.mkdir(copies);
  await fs.writeFile(
    path.join(dir, "gh"),
    [
      "#!/bin/sh",
      'if [ "$1" = auth ]; then exit 0; fi',
      `echo "$@" >> ${JSON.stringify(log)}`,
      `for arg; do case "$arg" in /*) cp "$arg" ${JSON.stringify(copies)};; esac; done`,
      "echo https://gist.github.com/0123456789abcdef0123456789abcdef",
    ].join("\n"),
    { mode: 0o755 },
  );
  const originalPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${originalPath ?? ""}`;
  try {
    const published = await publishGist(
      {
        schemaVersion: 1,
        diffmapVersion: "0.0.0",
        title: "Cover",
        repo: undefined,
        branch: undefined,
        pages: [
          { file: "README.md", slug: "", title: "Cover", source: "# Cover\n" },
        ],
        changes: {},
        files: { "a.ts": "a" },
      },
      true,
    );
    assert.ok(!(published instanceof Error), String(published));
    assert.equal(published.gistId, "0123456789abcdef0123456789abcdef");
    const args = (await fs.readFile(log, "utf8")).trim().split(" ");
    assert.deepEqual(args.slice(0, 5), [
      "gist",
      "create",
      "--public",
      "--desc",
      "Cover",
    ]);
    assert.deepEqual(
      args.slice(5).map((arg) => path.basename(arg)),
      ["README.md", "diffmap-files.json"],
    );
    assert.equal(
      await fs.readFile(path.join(copies, "README.md"), "utf8"),
      "# Cover\n",
    );
    assert.deepEqual(
      JSON.parse(
        await fs.readFile(path.join(copies, "diffmap-files.json"), "utf8"),
      ),
      { "a.ts": "a" },
    );
  } finally {
    process.env.PATH = originalPath;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
