import { DiffmapDefinitionError } from "../errors.js";
import type { SpecPage } from "../spec.js";
import type { EmbeddedContent } from "../standaloneHtml.js";
import type { ChangesLoader } from "./changesSource.ts";
import type { GrammarSource } from "./grammars.ts";

export type { EmbeddedContent };

/** Reads the text of a page element by id, or null when the page has none. */
type ReadBlock = (id: string) => string | null;

/** The page's content blocks, or undefined when it is not a standalone page. */
export function readEmbeddedContent(readBlock: ReadBlock) {
  const text = readBlock("diffmap-document");
  if (text === null) return undefined;
  // SAFETY: `share` writes this block with this shape.
  return JSON.parse(text) as EmbeddedContent;
}

export function readEmbeddedGrammars(readBlock: ReadBlock) {
  const text = readBlock("diffmap-grammars");
  // SAFETY: `share` writes this block as a map from language name to grammar.
  return text === null ? {} : (JSON.parse(text) as Record<string, unknown>);
}

/** A language missing from the block rejects, which shows its code as plain text. */
export function embeddedGrammarSource(
  grammars: Record<string, unknown>,
): GrammarSource {
  return (language) =>
    Object.hasOwn(grammars, language)
      ? Promise.resolve(grammars[language])
      : Promise.reject(new Error(`No embedded grammar for ${language}.`));
}

export function embeddedChangesLoader(content: EmbeddedContent): ChangesLoader {
  return (rev) =>
    Promise.resolve(
      content.changes[rev] ??
        new DiffmapDefinitionError({
          reason: `This page has no snapshot of ${rev}.`,
        }),
    );
}

/** The page and heading a location hash names, or undefined for the cover. */
export function parseHash(hash: string, pages: SpecPage[]) {
  const match = /^#\/([^/#]*)(?:[/#](.*))?$/.exec(hash);
  if (match === null) return undefined;
  const slug = safeDecode(match[1]!);
  const page = pages.find((candidate) => candidate.slug === slug);
  if (page === undefined) return undefined;
  const headingId = safeDecode(match[2] ?? "");
  return { page, headingId: headingId === "" ? undefined : headingId };
}

/** The hash for a page, or for a heading on it. The cover alone has none. */
export function pageHash(page: SpecPage, headingId?: string) {
  if (page.slug === "" && headingId === undefined) return "";
  return `#/${enc(page.slug)}${headingId === undefined ? "" : `/${enc(headingId)}`}`;
}

function enc(value: string) {
  return encodeURIComponent(value);
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** A storage prefix for one standalone spec, so two on one origin keep separate comments. */
export function specScope(content: Pick<EmbeddedContent, "title" | "pages">) {
  const identity = JSON.stringify([
    content.title,
    content.pages.map((entry) => entry.page.slug),
  ]);
  // FNV-1a: collisions only mix comments of two specs that share a title and every slug.
  let hash = 0x811c9dc5;
  for (let index = 0; index < identity.length; index++) {
    hash = Math.imul(hash ^ identity.charCodeAt(index), 0x01000193);
  }
  return `${(hash >>> 0).toString(36)}:`;
}
