/* oxlint-disable unicorn/no-null -- Stubs the null-returning Storage and DOM APIs. */
import assert from "node:assert/strict";
import test from "node:test";
import { scopeStorage, storage } from "./storage.ts";

test("storage falls back to memory, warning once, when localStorage throws", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("denied", "SecurityError");
    },
  });
  const warnings: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    assert.equal(storage.getItem("k"), null);
    storage.setItem("k", "one");
    storage.setItem("k", "two");
    assert.equal(storage.getItem("k"), "two");
    storage.removeItem("k");
    assert.equal(storage.getItem("k"), null);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = warn;
  }
});

test("scoped storage keeps one spec's keys apart from another's", () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  try {
    scopeStorage("a:");
    storage.setItem("diffmap-comments:#/", "mine");
    assert.deepEqual([...values.keys()], ["a:diffmap-comments:#/"]);
    scopeStorage("b:");
    assert.equal(storage.getItem("diffmap-comments:#/"), null);
  } finally {
    scopeStorage("");
  }
});
