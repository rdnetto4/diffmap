import serialize from "serialize-javascript";
import fs from "node:fs/promises";
import path from "node:path";
import { getFiletypeFromFileName } from "@pierre/diffs";
import { DiffmapShareError } from "./errors.js";
import {
  collectFences,
  parseViewerDocument,
  type ViewerDocument,
} from "./parseViewer.js";
import { headMarker, readGrammar, viewerDist } from "./serve.js";
import type { Changes, Rev } from "./changes.js";
import type { SharePayload } from "./sharePayload.js";
import type { SpecPage } from "./spec.js";

const viewerPath = path.join(viewerDist, "viewer.html");

/** What `share` writes into a standalone page, so the viewer needs no server. Declared here so the Node build pulls in nothing from `src/viewer`. */
export type EmbeddedContent = {
  title: string;
  pages: { page: SpecPage; document: ViewerDocument }[];
  /** Commit snapshots, keyed by rev. */
  changes: Record<Rev, Changes>;
  /** Source files the spec's references and excerpts read, keyed by path. */
  files: Record<string, string>;
};

/** The languages a spec needs a grammar for: its code fences as written, and the language of every file path. */
export function languagesUsed(
  documents: ViewerDocument[],
  changes: Record<string, unknown>,
  files: Record<string, string>,
) {
  const languages = new Set<string>();
  const paths = new Set(Object.keys(files));
  for (const document of documents) {
    for (const fence of collectFences(document.nodes)) {
      if (fence.kind === "code") languages.add(fence.lang);
      else if (fence.kind === "file") paths.add(fence.path);
      else if (fence.kind === "diff" && fence.path !== undefined)
        paths.add(fence.path);
    }
    for (const reference of document.references) {
      if (reference.kind === "file") paths.add(reference.path);
    }
  }
  for (const value of Object.values(changes)) {
    // SAFETY: each value is a `Changes` snapshot built by `buildSharePayload`.
    const snapshot = value as {
      files?: { path: string }[];
      sources?: Record<string, string>;
    };
    for (const file of snapshot.files ?? []) paths.add(file.path);
    for (const source of Object.keys(snapshot.sources ?? {})) paths.add(source);
  }
  for (const filePath of paths)
    languages.add(getFiletypeFromFileName(filePath));
  return [...languages].toSorted();
}

/** The viewer file with the spec and the grammars it uses written into it, or an error when a page does not parse. */
export async function renderStandaloneHtml(
  payload: SharePayload,
  viewerHtmlPath = viewerPath,
) {
  let viewer: string;
  try {
    viewer = await fs.readFile(viewerHtmlPath, "utf8");
  } catch (cause) {
    return new DiffmapShareError({
      reason: `could not read the viewer at ${viewerHtmlPath}; run npm run build:viewer`,
      cause,
    });
  }
  if (!viewer.includes(headMarker)) {
    return new DiffmapShareError({
      reason: "the viewer file has no place for the spec; rebuild it",
    });
  }
  const pages: EmbeddedContent["pages"] = [];
  for (const { source, ...page } of payload.pages) {
    const document = parseViewerDocument(source, page.file);
    if (document instanceof Error) return document;
    pages.push({ page, document });
  }
  const content: EmbeddedContent = {
    title: payload.title,
    pages,
    changes: payload.changes as EmbeddedContent["changes"],
    files: payload.files,
  };
  const grammars: Record<string, unknown> = {};
  for (const language of languagesUsed(
    pages.map((entry) => entry.document),
    payload.changes,
    payload.files,
  )) {
    // A language Shiki does not know is left out, and the page shows it as plain text.
    const grammar = await readGrammar(language);
    if (grammar !== undefined) grammars[language] = grammar;
  }
  const blocks =
    `<script type="application/json" id="diffmap-document">${serialize(content, { isJSON: true })}</script>\n` +
    `<script type="application/json" id="diffmap-grammars">${serialize(grammars, { isJSON: true })}</script>`;
  // A replacer function, because `$` in the JSON would otherwise be read as a pattern.
  return viewer.replace(headMarker, () => blocks);
}
