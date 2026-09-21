import type { FrameworkAdapter, LanguageAdapter, RepoContext } from "./types";

/**
 * Adapter lookup. The pipeline asks the registry for "the adapter for this
 * file" and never imports a language or framework module itself, which is what
 * lets Java/.NET arrive later as new adapters with no change to core code.
 */
export class AdapterRegistry {
  private languages = new Map<string, LanguageAdapter>();
  private byExtension = new Map<string, LanguageAdapter>();
  private frameworks = new Map<string, FrameworkAdapter>();

  registerLanguage(adapter: LanguageAdapter): void {
    if (this.languages.has(adapter.language)) {
      throw new Error(`Language adapter already registered: ${adapter.language}`);
    }
    for (const ext of adapter.extensions) {
      const key = ext.toLowerCase();
      const existing = this.byExtension.get(key);
      if (existing) {
        throw new Error(`Extension ${key} is already handled by the "${existing.language}" adapter`);
      }
    }
    this.languages.set(adapter.language, adapter);
    for (const ext of adapter.extensions) this.byExtension.set(ext.toLowerCase(), adapter);
  }

  registerFramework(adapter: FrameworkAdapter): void {
    if (this.frameworks.has(adapter.name)) {
      throw new Error(`Framework adapter already registered: ${adapter.name}`);
    }
    this.frameworks.set(adapter.name, adapter);
  }

  languageForPath(path: string): LanguageAdapter | null {
    const dot = path.lastIndexOf(".");
    if (dot === -1) return null;
    return this.byExtension.get(path.slice(dot).toLowerCase()) ?? null;
  }

  language(name: string): LanguageAdapter | null {
    return this.languages.get(name) ?? null;
  }

  /** Framework adapters that augment `language` and detect themselves in `repo`. */
  frameworksFor({ language, repo }: { language: string; repo: RepoContext }): FrameworkAdapter[] {
    return [...this.frameworks.values()].filter((f) => f.languages.includes(language) && f.detect(repo));
  }
}

/** Process-wide registry; adapters register themselves from codeIntel/adapters/index.ts. */
export const adapterRegistry = new AdapterRegistry();
