import { DiffmapShareError } from "./errors.js";
import { defaultShareCommand, runShareCommand } from "./shareCommand.js";
import { buildSharePayload } from "./sharePayload.js";

/** The configured command, or undefined to use the default. An empty value is treated as unset. */
export function customShareCommand(env: NodeJS.ProcessEnv = process.env) {
  const command = env.DIFFMAP_SHARE_CMD;
  return command === undefined || command.trim() === "" ? undefined : command;
}

export async function shareMarkdownFile(input: {
  filePath: string;
  workspaceRoot: string;
  isPublic: boolean;
}) {
  const custom = customShareCommand();
  // Only share-gist knows what --public means.
  if (custom !== undefined && input.isPublic) {
    return new DiffmapShareError({
      reason:
        "--public only applies to the default gist; DIFFMAP_SHARE_CMD is set",
    });
  }
  const payload = await buildSharePayload(input.filePath, input.workspaceRoot);
  if (payload instanceof Error) return payload;
  const url = await runShareCommand({
    command: custom ?? defaultShareCommand(input.isPublic),
    payload,
    workspaceRoot: input.workspaceRoot,
  });
  if (url instanceof Error) return url;
  return { url };
}
