import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DiffmapShareError } from "./errors.js";
import { renderStandaloneHtml } from "./standaloneHtml.js";
import type { SharePayload } from "./sharePayload.js";

const binPath = fileURLToPath(new URL("../bin.js", import.meta.url));

/** `share-gist` from this installation, so the default goes through the same path as any other command. */
export function defaultShareCommand(isPublic: boolean) {
  const command = `"${process.execPath}" "${binPath}" share-gist`;
  return isPublic ? `${command} --public` : command;
}

/** Runs `command` through the shell with the payload on stdin and returns the URL on its last stdout line. */
export async function runShareCommand(input: {
  command: string;
  payload: SharePayload;
  workspaceRoot: string;
}) {
  const { command, payload } = input;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "diffmap-share-"));
  try {
    const json = JSON.stringify(payload);
    const payloadPath = path.join(dir, "payload.json");
    await fs.writeFile(payloadPath, json);
    const htmlPath = path.join(dir, "share.html");
    const html = await renderStandaloneHtml(payload);
    if (html instanceof Error) return html;
    await fs.writeFile(htmlPath, html);
    // A host with an upload limit fails without saying why; the size does.
    process.stderr.write(
      `standalone HTML: ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MB\n`,
    );
    const env = {
      ...process.env,
      DIFFMAP_SHARE_PAYLOAD: payloadPath,
      DIFFMAP_SHARE_HTML: htmlPath,
      DIFFMAP_SHARE_DIR: dir,
      DIFFMAP_SHARE_TITLE: payload.title,
      DIFFMAP_SHARE_REPO: payload.repo ?? "",
      DIFFMAP_SHARE_BRANCH: payload.branch ?? "",
      DIFFMAP_SHARE_ID: randomUUID(),
    };
    const finished = await new Promise<
      { code: number | null; stdout: string } | Error
    >((resolve) => {
      // `shell: true` is sh -c, or cmd.exe /d /s /c on Windows.
      const child = spawn(command, {
        shell: true,
        cwd: input.workspaceRoot,
        env,
        stdio: ["pipe", "pipe", "inherit"],
      });
      let stdout = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => (stdout += chunk));
      // A command that ignores stdin closes it early; its exit status says whether that mattered.
      child.stdin.on("error", () => {});
      child.stdin.end(json);
      child.on("error", (cause) =>
        resolve(
          new DiffmapShareError({
            reason: `could not run the share command: ${cause.message}`,
          }),
        ),
      );
      child.on("close", (code) => resolve({ code, stdout }));
    });
    if (finished instanceof Error) return finished;

    const lastLine = finished.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .at(-1);
    if (finished.code !== 0) {
      return new DiffmapShareError({
        reason: `the share command exited with ${finished.code === null ? "a signal" : `code ${finished.code}`}${lastLine === undefined ? "" : `: ${lastLine}`}`,
      });
    }
    if (lastLine === undefined || !/^https?:\/\/\S+$/i.test(lastLine)) {
      return new DiffmapShareError({
        reason: `the share command's last line of output is not an http or https URL: ${lastLine === undefined ? "it printed nothing" : lastLine}`,
      });
    }
    return lastLine;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
