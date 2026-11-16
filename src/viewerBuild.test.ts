import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const viewer = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../viewer-dist/viewer.html",
);

test("the viewer builds to one file with every script inline", async () => {
  const html = await fs.readFile(viewer, "utf8");
  // Everything before the first inline bundle is the page's own markup.
  const page = html.slice(0, html.indexOf('<script type="module">'));
  assert.notEqual(page.length, 0);
  assert.equal(/<script\b[^>]*\ssrc=/.test(page), false);
  assert.equal(
    /<link\b[^>]*rel="(stylesheet|modulepreload)"/.test(page),
    false,
  );
});

test("the viewer has no WebAssembly and no Markdown parser", async () => {
  const html = await fs.readFile(viewer, "utf8");
  assert.equal(/WebAssembly/i.test(html), false);
  assert.equal(html.includes("md4x"), false);
});

test("the viewer leaves no preload marker for its inlined dynamic imports", async () => {
  const html = await fs.readFile(viewer, "utf8");
  assert.equal(html.includes("__VITE_PRELOAD__"), false);
});
