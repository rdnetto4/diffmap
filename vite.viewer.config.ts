import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const stub = (name: string) => path.join(packageRoot, "src/viewer/stubs", name);

/** The language names the viewer registers loaders for. The grammars themselves stay out. */
export function languageNames(): Plugin {
  const id = "virtual:diffmap-languages";
  return {
    name: "diffmap-language-names",
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    async load(source) {
      if (source !== `\0${id}`) return undefined;
      const { bundledLanguagesInfo } = await import("shiki/langs");
      const names = bundledLanguagesInfo.flatMap((info) => [
        info.id,
        ...(info.aliases ?? []),
      ]);
      return `export default ${JSON.stringify([...new Set(names)])};`;
    },
  };
}

function escapeRegExp(value: string) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A chunk no tag loads, such as a dynamic import, would otherwise vanish from the file. */
function inline(html: string, tag: RegExp, element: string) {
  if (!tag.test(html)) throw new Error(`viewer.html has no tag for ${tag}`);
  return html.replace(tag, () => element);
}

/** Inlines every script and stylesheet into one `viewer.html`. */
function singleFile(): Plugin {
  return {
    name: "diffmap-single-file",
    enforce: "post",
    generateBundle(_, bundle) {
      const index = bundle["index.html"];
      if (index?.type !== "asset") throw new Error("index.html was not built");
      let html = String(index.source);
      for (const [name, chunk] of Object.entries(bundle)) {
        if (chunk.type === "chunk") {
          const code = chunk.code
            // `</script` would end the inline script early.
            .replaceAll("</script", "<\\/script")
            // Vite fills this only beside a real `import()`, which inlining removes; no deps means no preload.
            .replaceAll("__VITE_PRELOAD__", "void 0");
          const tag = new RegExp(
            `<script[^>]*src="[^"]*${escapeRegExp(name)}"[^>]*></script>`,
          );
          html = inline(html, tag, `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (name.endsWith(".css")) {
          const tag = new RegExp(
            `<link[^>]*href="[^"]*${escapeRegExp(name)}"[^>]*>`,
          );
          html = inline(html, tag, `<style>${String(chunk.source)}</style>`);
          delete bundle[name];
        }
      }
      delete bundle["index.html"];
      this.emitFile({ type: "asset", fileName: "viewer.html", source: html });
    },
  };
}

/** The local viewer, built once at publish time as one file that `serve` sends and `share` fills. */
export default defineConfig({
  root: packageRoot,
  publicDir: false,
  plugins: [react(), languageNames(), singleFile()],
  resolve: {
    dedupe: ["react", "react-dom", "purse-styles"],
    alias: [
      { find: /^shiki\/langs$/, replacement: stub("empty.ts") },
      { find: /^@shikijs\/themes(\/.*)?$/, replacement: stub("empty.ts") },
      { find: /^@pierre\/highlights$/, replacement: stub("noWasm.ts") },
      { find: /^shiki\/engine\/oniguruma$/, replacement: stub("noWasm.ts") },
      { find: /^shiki\/wasm$/, replacement: stub("noWasm.ts") },
    ],
  },
  build: {
    outDir: path.join(packageRoot, "viewer-dist"),
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { output: { codeSplitting: false } },
    chunkSizeWarningLimit: 8192,
  },
  clearScreen: false,
});
