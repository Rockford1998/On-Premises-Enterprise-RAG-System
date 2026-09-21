import fs from "fs";
import path from "path";
import { DirectorySource } from "../fileSource";
import { buildRepoContext, isManifestPath, parseJsonc } from "../repoContext";
import { walkRepo } from "../walker";

const FIXTURES = path.resolve(__dirname, "../../../../test-fixtures");

const ctx = (files: Record<string, string>, name = "shop") =>
  buildRepoContext({ name, files: Object.entries(files).map(([p, content]) => ({ path: p, content })) });

describe("parseJsonc", () => {
  it("handles comments, trailing commas and a BOM", () => {
    expect(parseJsonc('﻿{\n // c\n "a": 1, /* x */ "b": [1, 2,],\n}')).toEqual({ a: 1, b: [1, 2] });
  });

  it("does not treat // or /* inside strings as comments", () => {
    expect(parseJsonc('{"url": "http://x.dev/*", "glob": "src/**/*.ts", }')).toEqual({ url: "http://x.dev/*", glob: "src/**/*.ts" });
  });

  it("keeps ',}' that appears inside a string", () => {
    expect(parseJsonc('{"s": "a,}", "t": "b,]"}')).toEqual({ s: "a,}", t: "b,]" });
  });

  it("still throws on genuinely broken JSON", () => {
    expect(() => parseJsonc('{"a": ')).toThrow();
  });
});

describe("isManifestPath", () => {
  it.each(["package.json", "web/package.json", "tsconfig.json", "tsconfig.app.json", "jsconfig.json", "pom.xml", "build.gradle", "src/Api.csproj", "pnpm-workspace.yaml"])(
    "%s is a manifest",
    (p) => expect(isManifestPath(p)).toBe(true),
  );
  it.each(["src/index.ts", "package-lock.json", "README.md", "tsconfig.txt"])("%s is not", (p) => expect(isManifestPath(p)).toBe(false));
});

describe("buildRepoContext", () => {
  it("parses manifests and exposes the dependency lists adapters detect on", () => {
    const c = ctx({ "package.json": '{"dependencies": {"express": "^5"}}', "src/a.ts": "ignored" });
    expect(Object.keys(c.manifests)).toEqual(["package.json"]);
    expect((c.manifests["package.json"] as { dependencies: object }).dependencies).toHaveProperty("express");
    expect(c.workspaces).toBeUndefined();
  });

  it("keeps XML and Gradle manifests as raw text", () => {
    const c = ctx({ "pom.xml": "<project/>", "build.gradle": "plugins {}" });
    expect(c.manifests["pom.xml"]).toBe("<project/>");
    expect(c.manifests["build.gradle"]).toBe("plugins {}");
  });

  it("skips a malformed manifest instead of failing the run", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const c = ctx({ "package.json": "{ not json", "tsconfig.json": '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}' });
    expect(c.manifests["package.json"]).toBeUndefined();
    expect(c.pathAliases["@/*"]).toEqual(["src/*"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("resolves path aliases against baseUrl", () => {
    const c = ctx({ "tsconfig.json": '{"compilerOptions": {"baseUrl": "src", "paths": {"@app/*": ["app/*"], "~utils": ["lib/utils/index.ts"]}}}' });
    expect(c.pathAliases).toEqual({ "@app/*": ["src/app/*"], "~utils": ["src/lib/utils/index.ts"] });
  });

  it("resolves aliases relative to a nested tsconfig and merges the same alias from several packages", () => {
    const c = ctx({
      "web/tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./src/*"]}}}',
      "admin/tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./src/*"]}}}',
    });
    expect(c.pathAliases["@/*"]).toEqual(["admin/src/*", "web/src/*"]);
  });

  it("follows a relative `extends` chain, and a child's paths replace the parent's", () => {
    const c = ctx({
      "tsconfig.base.json": '{"compilerOptions": {"baseUrl": ".", "paths": {"@base/*": ["shared/*"]}}}',
      "tsconfig.json": '{"extends": "./tsconfig.base"}',
      "app/tsconfig.json": '{"extends": "../tsconfig.base.json", "compilerOptions": {"paths": {"@app/*": ["src/*"]}}}',
    });
    // tsconfig.json inherits @base/* ; app/ overrides `paths` (baseUrl still comes from the base config, at the repo root).
    expect(c.pathAliases["@base/*"]).toEqual(["shared/*"]);
    expect(c.pathAliases["@app/*"]).toEqual(["src/*"]);
  });

  it("survives extends cycles and unresolvable/package extends", () => {
    const c = ctx({
      "a/tsconfig.json": '{"extends": "../b/tsconfig.json"}',
      "b/tsconfig.json": '{"extends": "../a/tsconfig.json"}',
      "c/tsconfig.json": '{"extends": "@tsconfig/node20/tsconfig.json", "compilerOptions": {"paths": {"@c/*": ["src/*"]}}}',
    });
    expect(c.pathAliases).toEqual({ "@c/*": ["c/src/*"] });
  });

  it("drops alias targets that point outside the repository", () => {
    const c = ctx({ "tsconfig.json": '{"compilerOptions": {"paths": {"@out/*": ["../../elsewhere/*"], "@in/*": ["in/*"]}}}' });
    expect(c.pathAliases).toEqual({ "@in/*": ["in/*"] });
  });

  it("detects workspaces from package.json (array and object forms) and pnpm-workspace.yaml", () => {
    expect(ctx({ "package.json": '{"workspaces": ["packages/*", "apps/*"]}' }).workspaces).toEqual(["packages/*", "apps/*"]);
    expect(ctx({ "package.json": '{"workspaces": {"packages": ["libs/*"]}}' }).workspaces).toEqual(["libs/*"]);
    expect(ctx({ "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n  - \"tools/*\"\nother: 1\n" }).workspaces).toEqual(["packages/*", "tools/*"]);
  });
});

describe("buildRepoContext on the sample-mern fixture", () => {
  it("finds the @/* alias and the frameworks the fixture depends on", async () => {
    const source = await DirectorySource.open({ root: "sample-mern", allowedRoot: FIXTURES });
    const manifests: { path: string; content: string }[] = [];
    for await (const file of walkRepo({ source, limits: { maxFiles: 100, maxFileBytes: 1 << 20 } })) {
      if (isManifestPath(file.path)) manifests.push({ path: file.path, content: file.content });
    }
    const c = buildRepoContext({ name: "shop", files: manifests });

    expect(c.pathAliases).toHaveProperty("@/*");
    expect(c.pathAliases["@/*"]).toEqual(["src/*"]);
    const deps = (c.manifests["package.json"] as { dependencies: Record<string, string> }).dependencies;
    expect(Object.keys(deps)).toEqual(expect.arrayContaining(["express", "react", "axios"]));
    expect(fs.existsSync(path.join(FIXTURES, "sample-mern", "tsconfig.json"))).toBe(true);
  });
});
