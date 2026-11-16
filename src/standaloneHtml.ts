import type { Changes, Rev } from "./changes.js";
import type { ViewerDocument } from "./parseViewer.js";
import type { SpecPage } from "./spec.js";

/** What `share` writes into a standalone page, so the viewer needs no server. Declared here so the Node build pulls in nothing from `src/viewer`. */
export type EmbeddedContent = {
  title: string;
  pages: { page: SpecPage; document: ViewerDocument }[];
  /** Commit snapshots, keyed by rev. */
  changes: Record<Rev, Changes>;
  /** Source files the spec's references and excerpts read, keyed by path. */
  files: Record<string, string>;
};
