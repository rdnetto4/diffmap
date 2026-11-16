import { publishGist } from "./shareGist.js";
import { buildSharePayload } from "./sharePayload.js";

export type ShareResult = {
  gistId: string;
  gistUrl: string;
  viewerUrl: string;
};

export async function shareMarkdownFile(input: {
  filePath: string;
  workspaceRoot: string;
  isPublic: boolean;
}) {
  const payload = await buildSharePayload(input.filePath, input.workspaceRoot);
  if (payload instanceof Error) return payload;
  return publishGist(payload, input.isPublic);
}
