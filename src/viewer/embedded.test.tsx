/* oxlint-disable unicorn/no-null, react/globals -- Stubs null-returning DOM APIs; the probe records a hook result. */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { SourceReference } from "../annotations.js";
import type { Changes } from "../changes.js";
import { HostFilesContext } from "../host/files.ts";
import type { ViewerDocument } from "../parseViewer.js";
import type { SpecPage } from "../spec.js";
import {
  embeddedChangesLoader,
  embeddedGrammarSource,
  pageHash,
  parseHash,
  readEmbeddedContent,
  readEmbeddedGrammars,
  specScope,
  type EmbeddedContent,
} from "./embedded.ts";
import { useSourceReference } from "./sourceNavigation.ts";
import { ViewerModeContext } from "./viewerMode.ts";

const pages: SpecPage[] = [
  { file: "README.md", slug: "", title: "Cover" },
  { file: "01-intro.md", slug: "intro", title: "Intro" },
];

const snapshot = { rev: "abc", title: "A commit", files: [] } as Changes;

const content: EmbeddedContent = {
  title: "Cover",
  pages: pages.map((page) => ({ page, document: {} as ViewerDocument })),
  changes: { abc: snapshot },
  files: { "src/a.ts": "one\ntwo\nthree" },
};

const blocks: Record<string, string> = {
  "diffmap-document": JSON.stringify(content),
  "diffmap-grammars": JSON.stringify({ python: [{ name: "python" }] }),
};
const readBlock = (id: string) => blocks[id] ?? null;

async function withFetchFailing<T>(run: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error("no network"));
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("changes, grammars, and source files come from the page without fetch", async () => {
  const embedded = readEmbeddedContent(readBlock)!;
  assert.equal(embedded.title, "Cover");
  await withFetchFailing(async () => {
    assert.equal(
      await embeddedChangesLoader(embedded)("abc"),
      embedded.changes.abc,
    );
    assert.ok((await embeddedChangesLoader(embedded)("nope")) instanceof Error);
    const grammar = embeddedGrammarSource(readEmbeddedGrammars(readBlock));
    assert.deepEqual(await grammar("python"), [{ name: "python" }]);
    await assert.rejects(grammar("rust"));
    let result: unknown;
    function Probe() {
      result = useSourceReference({
        kind: "file",
        path: "src/a.ts",
        start: 2,
        end: 3,
      } as SourceReference);
      return null;
    }
    renderToString(
      createElement(
        ViewerModeContext.Provider,
        { value: "gist" },
        createElement(
          HostFilesContext.Provider,
          { value: embedded.files },
          createElement(Probe),
        ),
      ),
    );
    assert.equal((result as { contents: string }).contents, "one\ntwo\nthree");
  });
});

test("a page without a diffmap-document block is not standalone", () => {
  assert.equal(
    readEmbeddedContent(() => null),
    undefined,
  );
  assert.deepEqual(
    readEmbeddedGrammars(() => null),
    {},
  );
});

test("hashes name a page and a heading, and anything else the cover", () => {
  const intro = pages[1]!;
  assert.deepEqual(parseHash("#/intro", pages), {
    page: intro,
    headingId: undefined,
  });
  assert.deepEqual(parseHash("#/intro/the-plan", pages), {
    page: intro,
    headingId: "the-plan",
  });
  assert.deepEqual(parseHash("#/intro#the-plan", pages), {
    page: intro,
    headingId: "the-plan",
  });
  assert.deepEqual(parseHash("#//overview", pages), {
    page: pages[0],
    headingId: "overview",
  });
  for (const other of ["", "#", "#the-plan", "#/missing", "#/missing/x"])
    assert.equal(parseHash(other, pages), undefined);
  assert.equal(pageHash(pages[0]!), "");
  assert.equal(pageHash(intro), "#/intro");
  assert.equal(pageHash(intro, "the plan"), "#/intro/the%20plan");
  assert.equal(pageHash(pages[0]!, "overview"), "#//overview");
});

test("two specs on one origin get different storage scopes", () => {
  const other = { ...content, title: "Another spec" };
  assert.equal(specScope(content), specScope({ ...content }));
  assert.notEqual(specScope(content), specScope(other));
  assert.notEqual(
    specScope(content),
    specScope({ ...content, pages: content.pages.slice(0, 1) }),
  );
});
