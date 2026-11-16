import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseViewerDocument } from "./parseViewer.js";
import { languagesUsed, renderStandaloneHtml } from "./standaloneHtml.js";
import type { SharePayload } from "./sharePayload.js";

const cover = [
  "# Cover",
  "",
  "```ts",
  "const a: string = '</script><script>alert(1)</script> $&  ';",
  "```",
  "",
  "```mermaid",
  "flowchart LR",
  "  A --> B",
  "```",
].join("\n");

const payload: SharePayload = {
  schemaVersion: 1,
  diffmapVersion: "0.0.0",
  title: "Cover",
  repo: undefined,
  branch: undefined,
  pages: [
    { file: "README.md", slug: "", title: "Cover", source: cover },
    {
      file: "01-next.md",
      slug: "next",
      title: "Next page",
      source: "# Next page\n\nText.",
    },
  ],
  changes: {
    abc1234: { rev: "abc1234", title: "t", files: [{ path: "tool/run.py" }] },
  },
  files: {},
};

const fakeViewer =
  '<html><head><meta charset="UTF-8" /><script type="module">/* </head> */</script><!--diffmap-head--></head><body></body></html>';

async function withViewer<T>(run: (viewer: string) => Promise<T>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "diffmap-standalone-"));
  try {
    const viewer = path.join(dir, "viewer.html");
    await fs.writeFile(viewer, fakeViewer);
    return await run(viewer);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function block(html: string, id: string) {
  const match = new RegExp(
    `<script type="application/json" id="${id}">([\\s\\S]*?)</script>`,
  ).exec(html);
  assert.ok(match !== null, `${id} block`);
  return match[1]!;
}

test("a TypeScript fence, a changed .py file, and a mermaid diagram get exactly those grammars", async () => {
  const documents = payload.pages.map((page) => {
    const document = parseViewerDocument(page.source, page.file);
    assert.ok(!(document instanceof Error));
    return document;
  });
  assert.deepEqual(languagesUsed(documents, payload.changes, {}), [
    "python",
    "ts",
  ]);
  await withViewer(async (viewer) => {
    const html = await renderStandaloneHtml(payload, viewer);
    assert.ok(typeof html === "string");
    const grammars = JSON.parse(block(html, "diffmap-grammars")) as Record<
      string,
      { scopeName: string }[]
    >;
    assert.deepEqual(Object.keys(grammars).toSorted(), ["python", "ts"]);
    assert.ok(
      grammars.ts?.some((grammar) => grammar.scopeName === "source.ts"),
    );
  });
});

test("a </script> in a page's code survives the round trip", async () => {
  await withViewer(async (viewer) => {
    const html = await renderStandaloneHtml(payload, viewer);
    assert.ok(typeof html === "string");
    const text = block(html, "diffmap-document");
    assert.doesNotMatch(text, /[<>\u2028\u2029]/);
    const content = JSON.parse(text) as { pages: { document: unknown }[] };
    assert.deepEqual(
      content.pages[0]?.document,
      JSON.parse(JSON.stringify(parseViewerDocument(cover, "README.md"))),
    );
    const roundTripped = JSON.stringify(content);
    assert.ok(roundTripped.includes("</script><script>alert(1)"));
    // The `$&` in the code was not read as a replacement pattern.
    assert.ok(roundTripped.includes("$&"));
  });
});

test("the content lands at the marker, not at a </head> inside the bundle", async () => {
  await withViewer(async (viewer) => {
    const html = await renderStandaloneHtml(payload, viewer);
    assert.ok(typeof html === "string");
    assert.ok(
      html.indexOf('id="diffmap-document"') > html.indexOf("/* </head> */"),
    );
  });
});

test("the written file contains every page's title", async () => {
  await withViewer(async (viewer) => {
    const html = await renderStandaloneHtml(payload, viewer);
    assert.ok(typeof html === "string");
    for (const page of payload.pages) assert.ok(html.includes(page.title));
  });
});

test("a viewer that was not built is an error that says how to build it", async () => {
  const html = await renderStandaloneHtml(payload, "/nonexistent/viewer.html");
  assert.ok(html instanceof Error);
  assert.match(html.message, /build:viewer/);
});
