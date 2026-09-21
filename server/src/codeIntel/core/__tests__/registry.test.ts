import { AdapterRegistry } from "../registry";
import type { FrameworkAdapter, LanguageAdapter, RepoContext } from "../types";

const lang = (language: string, extensions: string[]): LanguageAdapter => ({
  language,
  extensions,
  parse: async () => ({ units: [], references: [] }),
  resolveImport: () => null,
});

const framework = (name: string, languages: string[], detects: boolean): FrameworkAdapter => ({
  name,
  languages,
  detect: () => detects,
  enrich: async ({ base }) => base,
});

const repo: RepoContext = { name: "shop", manifests: {}, pathAliases: {} };

describe("AdapterRegistry", () => {
  it("finds a language adapter by extension, case-insensitively", () => {
    const r = new AdapterRegistry();
    const ts = lang("typescript", [".ts", ".tsx"]);
    r.registerLanguage(ts);
    expect(r.languageForPath("src/App.TSX")).toBe(ts);
    expect(r.languageForPath("README")).toBeNull();
    expect(r.languageForPath("a.py")).toBeNull();
  });

  it("rejects duplicate languages and overlapping extensions", () => {
    const r = new AdapterRegistry();
    r.registerLanguage(lang("typescript", [".ts"]));
    expect(() => r.registerLanguage(lang("typescript", [".mts"]))).toThrow(/already registered/);
    expect(() => r.registerLanguage(lang("other", [".ts"]))).toThrow(/already handled/);
  });

  it("returns only frameworks that match the language and detect the repo", () => {
    const r = new AdapterRegistry();
    r.registerFramework(framework("express", ["typescript"], true));
    r.registerFramework(framework("nestjs", ["typescript"], false));
    r.registerFramework(framework("spring", ["java"], true));
    expect(r.frameworksFor({ language: "typescript", repo }).map((f) => f.name)).toEqual(["express"]);
  });
});
