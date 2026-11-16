import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import JSON5 from "json5";
import { DiffmapConfigError } from "./errors.js";

/** Where `diffmap.json` lives: XDG_CONFIG_HOME, then `%APPDATA%` on Windows, then `~/.config` (as gh does on macOS). */
export function configPath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  home = os.homedir(),
) {
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg !== undefined && xdg !== "")
    return join(xdg, "diffmap", "diffmap.json");
  if (platform === "win32")
    return join(
      env.APPDATA ?? join(home, "AppData", "Roaming"),
      "diffmap",
      "diffmap.json",
    );
  return join(home, ".config", "diffmap", "diffmap.json");
}

/** The file's settings, or undefined when it does not exist. Non-DIFFMAP_ keys are reported through `warn`. */
export function readConfig(
  filePath: string,
  warn: (message: string) => void = () => {},
) {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return new DiffmapConfigError({
      path: filePath,
      reason: cause instanceof Error ? cause.message : "could not read it",
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON5.parse(text);
  } catch (cause) {
    return new DiffmapConfigError({
      path: filePath,
      reason: cause instanceof Error ? cause.message : "not valid JSON5",
    });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return new DiffmapConfigError({
      path: filePath,
      reason: "it must be an object of DIFFMAP_* settings",
    });
  }
  const settings: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.startsWith("DIFFMAP_")) {
      warn(`${filePath}: ignoring "${key}"; settings start with DIFFMAP_`);
      continue;
    }
    if (typeof value !== "string") {
      return new DiffmapConfigError({
        path: filePath,
        reason: `${key} must be a string, as an environment variable is`,
      });
    }
    settings[key] = value;
  }
  return settings;
}

/** Fills each DIFFMAP_* variable the environment leaves unset; a variable set to an empty string counts as set. */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  warn: (message: string) => void = (message) =>
    process.stderr.write(`Warning: ${message}\n`),
) {
  const settings = readConfig(configPath(env, platform), warn);
  if (settings === undefined || settings instanceof Error) return settings;
  for (const [key, value] of Object.entries(settings)) env[key] ??= value;
  return settings;
}
