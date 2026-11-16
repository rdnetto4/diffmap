import { registerCustomLanguage } from "@pierre/diffs";
import languageNames from "virtual:diffmap-languages";

/** Where a viewer gets a Shiki grammar: embedded in the page, or from `serve`. */
export type GrammarSource = (language: string) => Promise<unknown>;

export const fetchGrammar: GrammarSource = async (language) => {
  const response = await fetch(
    `/__diffmap/grammar?${new URLSearchParams({ lang: language })}`,
  );
  if (!response.ok) throw new Error(`No grammar for ${language}.`);
  return response.json();
};

/** Pierre checks these loaders before its own bundled set, which the viewer build leaves out. */
export function registerGrammarLoaders(source: GrammarSource) {
  for (const language of languageNames) {
    registerCustomLanguage(language, async () => ({
      // SAFETY: the source hands over a Shiki grammar, the shape Pierre's loaders return.
      default: (await source(language)) as never,
    }));
  }
}
