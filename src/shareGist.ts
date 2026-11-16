import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { GIST_CHANGES_FILE, GIST_FILES_FILE } from "./changes.js";
import { DiffmapShareError } from "./errors.js";
import { extractGistId, gistViewerUrl } from "./gist/route.ts";
import type { SharePayload } from "./sharePayload.js";

const execFileAsync = promisify(execFile);

/** Parses a share payload from JSON, rejecting a schemaVersion this package does not know. */
export function parseSharePayload(json: string) {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return new DiffmapShareError({ reason: "the share payload is not JSON" });
  }
  const version =
    typeof value === "object" && value !== null && "schemaVersion" in value
      ? value.schemaVersion
      : undefined;
  if (version !== 1) {
    return new DiffmapShareError({
      reason: `unsupported share payload schemaVersion ${JSON.stringify(version)}; this product-doc reads 1`,
    });
  }
  return value as SharePayload;
}

export async function publishGist(payload: SharePayload, isPublic: boolean) {
  const auth = await runGh(["auth", "status"]);
  if (auth instanceof DiffmapShareError) return auth;

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "diffmap-share-"));
  try {
    const paths: string[] = [];
    // A spec's pages share one flat gist, as they share one directory.
    const entries = [
      ...payload.pages.map((page) => ({
        name: page.file,
        text: page.source,
      })),
      ...[
        { name: GIST_CHANGES_FILE, value: payload.changes },
        { name: GIST_FILES_FILE, value: payload.files },
      ]
        .filter((snapshot) => Object.keys(snapshot.value).length > 0)
        .map((snapshot) => ({
          name: snapshot.name,
          text: JSON.stringify(snapshot.value),
        })),
    ];
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      await fs.writeFile(entryPath, entry.text);
      paths.push(entryPath);
    }
    const args = ["gist", "create"];
    if (isPublic) args.push("--public");
    args.push("--desc", payload.title, ...paths);
    const created = await runGh(args);
    if (created instanceof DiffmapShareError) return created;

    const combined = `${created.stderr}\n${created.stdout}`;
    const gistUrl = combined.match(/https:\/\/gist\.github\.com\/[^\s]+/)?.[0];
    if (gistUrl === undefined) {
      return new DiffmapShareError({ reason: "gh did not print a gist URL" });
    }
    const gistId = extractGistId(gistUrl);
    if (gistId === undefined) {
      return new DiffmapShareError({
        reason: `could not parse gist id from ${gistUrl}`,
      });
    }
    return {
      gistId,
      gistUrl,
      viewerUrl: gistViewerUrl(gistId, undefined, process.env.DIFFMAP_ORIGIN),
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function runGh(args: string[]) {
  try {
    return await execFileAsync("gh", args, {
      encoding: "utf8",
      maxBuffer: 10_000_000,
    });
  } catch (cause) {
    if (isErrnoException(cause) && cause.code === "ENOENT") {
      return new DiffmapShareError({
        reason:
          "gh is not installed. Install GitHub CLI and run gh auth login.",
      });
    }
    const stderr = execStderr(cause);
    if (stderr.length > 0) {
      return new DiffmapShareError({ reason: stderr.trim() });
    }
    return new DiffmapShareError({
      reason: cause instanceof Error ? cause.message : "gh failed",
    });
  }
}

function isErrnoException(cause: unknown): cause is NodeJS.ErrnoException {
  if (typeof cause !== "object" || !cause) return false;
  return "code" in cause && typeof cause.code === "string";
}

function execStderr(cause: unknown) {
  if (typeof cause !== "object" || !cause) return "";
  if (!("stderr" in cause) || typeof cause.stderr !== "string") return "";
  return cause.stderr;
}
