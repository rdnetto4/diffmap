const memory = new Map<string, string>();
let warned = false;

function useMemory(cause: unknown) {
  if (warned) return;
  warned = true;
  console.warn(
    "diffmap cannot use localStorage here, so comments and reviewed files last until the page closes",
    cause,
  );
}

let scope = "";

/** Keeps one standalone spec's keys apart from another's on the same origin. */
export function scopeStorage(prefix: string) {
  scope = prefix;
}

/** localStorage, or memory when the host forbids it, such as a sandboxed iframe. */
export const storage = {
  getItem(name: string) {
    const key = scope + name;
    const held = memory.get(key);
    if (held !== undefined) return held;
    try {
      return localStorage.getItem(key);
    } catch (cause) {
      useMemory(cause);
      // oxlint-disable-next-line unicorn/no-null -- Storage.getItem returns null.
      return null;
    }
  },
  setItem(name: string, value: string) {
    const key = scope + name;
    try {
      localStorage.setItem(key, value);
      memory.delete(key);
    } catch (cause) {
      useMemory(cause);
      memory.set(key, value);
    }
  },
  removeItem(name: string) {
    const key = scope + name;
    memory.delete(key);
    try {
      localStorage.removeItem(key);
    } catch (cause) {
      useMemory(cause);
    }
  },
};
