function unavailable(): never {
  throw new Error("The viewer bundle has no wasm engine.");
}

export const codeToTokens = unavailable;
export const isSupportedLanguage = unavailable;
export const createOnigurumaEngine = unavailable;
// oxlint-disable-next-line typescript/no-extraneous-class -- Stands in for a class the bundle never instantiates.
export class LiveTokenizer {
  constructor() {
    unavailable();
  }
}
export default unavailable;
