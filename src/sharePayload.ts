import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { Changes, Rev } from "./changes.js";
import { readSourceReference } from "./definitions.js";
import { DiffmapShareError } from "./errors.js";
import { readChanges, readDocumentChanges } from "./git.js";
import { isLocalMedia } from "./media.js";
import { packageVersion } from "./packageVersion.js";
import {
  collectFences,
  collectMedia,
  type ViewerDocument,
} from "./parseViewer.js";
import { parseSpec, readSpec } from "./readSpec.js";

const execFileAsync = promisify(execFile);

/** A public API: hooks other people write read it, so fields are only added within a schemaVersion. */
export type SharePayload = {
  schemaVersion: 1;
  diffmapVersion: string;
  title: string;
  repo: string | undefined;
  branch: string | undefined;
  pages: { file: string; slug: string; title: string; source: string }[];
  changes: Record<string, unknown>;
  files: Record<string, string>;
};

export async function buildSharePayload(
  filePath: string,
  workspaceRoot: string,
): Promise<SharePayload | Error> {
  const read = await readSpec(path.resolve(filePath));
  if (read instanceof Error) return read;
  const pages = parseSpec(read);
  if (pages instanceof Error) return pages;
  const changes = new Map<Rev, Changes>();
  const files: Record<string, string> = {};
  for (const page of pages) {
    // Neither the hosted viewer nor a standalone file has a server to load local media from.
    const localMedia = collectMedia(page.document.nodes).filter(isLocalMedia);
    if (localMedia.length > 0) {
      return new DiffmapShareError({
        reason: `a shared gist cannot show local images or videos (${localMedia.join(", ")} in ${page.file}). Link them by https URL, or view the spec with serve`,
      });
    }
    // A shared viewer has no git, so the share carries a snapshot of each commit.
    const pageChanges = await readDocumentChanges(workspaceRoot, page.document);
    if (pageChanges instanceof Error) return pageChanges;
    for (const [rev, value] of pageChanges) {
      const previous = changes.get(rev);
      if (previous?.sources !== undefined)
        value.sources = { ...previous.sources, ...value.sources };
      changes.set(rev, value);
    }
    // An uncommitted changes card shows the tree as it is when you share.
    for (const { rev } of page.document.changeCards) {
      if (changes.has(rev)) continue;
      const loaded = await readChanges(workspaceRoot, rev);
      if (loaded instanceof Error) return loaded;
      changes.set(rev, loaded);
    }
    // It has no files either, so excerpts and references without a commit read these.
    const pageFiles = readDocumentFiles(workspaceRoot, page.document);
    if (pageFiles instanceof Error) return pageFiles;
    Object.assign(files, pageFiles);
  }
  return {
    schemaVersion: 1,
    diffmapVersion: packageVersion,
    title: read.spec.title,
    repo: await repoName(workspaceRoot),
    branch: await gitOutput(workspaceRoot, ["symbolic-ref", "--short", "HEAD"]),
    pages: pages.map(({ file, slug, title, source }) => ({
      file,
      slug,
      title,
      source,
    })),
    changes: Object.fromEntries(changes),
    files,
  };
}

/** Current contents of every file an excerpt or a reference without a commit reads, by path. */
function readDocumentFiles(root: string, document: ViewerDocument) {
  const paths = new Set<string>();
  for (const reference of document.references) {
    if (reference.kind === "file" && reference.rev === undefined)
      paths.add(reference.path);
  }
  for (const fence of collectFences(document.nodes)) {
    if (fence.kind === "file") paths.add(fence.path);
  }
  const files: Record<string, string> = {};
  for (const filePath of paths) {
    const read = readSourceReference(
      root,
      new URLSearchParams({ path: filePath }),
    );
    if (read instanceof Error) return read;
    files[filePath] = read.contents;
  }
  return files;
}

async function repoName(root: string) {
  const origin = await gitOutput(root, ["remote", "get-url", "origin"]);
  // Splitting on "/" and ":" ends both https and scp-style remotes in the repo name.
  const fromRemote = origin
    ?.replace(/\/+$/, "")
    .split(/[/:]/)
    .pop()
    ?.replace(/\.git$/, "");
  return fromRemote ? fromRemote : path.basename(path.resolve(root));
}

/** Trimmed stdout, or undefined when git fails or prints nothing, such as outside a repo or on a detached HEAD. */
async function gitOutput(root: string, args: string[]) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: root,
      encoding: "utf8",
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}
