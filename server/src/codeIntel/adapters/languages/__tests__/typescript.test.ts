import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { FileRecord, ParseResult, RepoContext } from "../../../core/types";
import { disposeParsers, disposeTree } from "../../../parse/treesitter";
import { typescriptAdapter } from "../typescript";

jest.setTimeout(60_000);

const FIXTURE = path.resolve(__dirname, "../../../../../test-fixtures/sample-mern");
const repo: RepoContext = { name: "shop", manifests: {}, pathAliases: { "@/*": ["src/*"] } };

const record = (filePath: string, content: string): FileRecord => ({
  path: filePath,
  language: "typescript",
  category: "source",
  content,
  contentHash: crypto.createHash("sha256").update(content).digest("hex"),
  lineCount: content.split("\n").length,
});

const parse = async (filePath: string, content: string): Promise<ParseResult> => {
  const result = await typescriptAdapter.parse({ file: record(filePath, content), repo });
  disposeTree(result.tree);
  return result;
};

const unitNames = (result: ParseResult) => result.units.map((u) => `${u.kind}:${u.qualifiedName}`).sort();
const unit = (result: ParseResult, qualifiedName: string) => result.units.find((u) => u.qualifiedName === qualifiedName)!;
const refs = (result: ParseResult, type: string) =>
  result.references.filter((r) => r.type === type).map((r) => (r.target.kind === "symbol" ? r.target.name : r.target.kind === "import" ? r.target.specifier : ""));

afterAll(() => disposeParsers());

describe("declarations", () => {
  it("finds functions, classes, methods, interfaces, types and enums", async () => {
    const result = await parse(
      "src/a.ts",
      `export function one() {}
function two() {}
export const three = () => {};
const four = async function () {};
export class Svc extends Base implements Contract {
  private cache = new Map();
  async getUser(id: string) { return this.repo.find(id); }
  helper = () => 1;
}
export interface Contract { go(): void }
export type Id = string;
export enum Colour { Red }
const notAFunction = 42;`,
    );
    expect(unitNames(result)).toEqual([
      "class:Svc",
      "function:four",
      "function:one",
      "function:three",
      "function:two",
      "interface:Contract",
      "method:Svc.getUser",
      "method:Svc.helper",
      "type:Colour",
      "type:Id",
    ]);
    expect(result.units.some((u) => u.name === "notAFunction")).toBe(false);
  });

  it("records what is exported, including CommonJS and a later export clause", async () => {
    const result = await parse(
      "src/b.js",
      `export function exported() {}
function plain() {}
function viaClause() {}
function viaCommonJs() {}
function viaProperty() {}
export { viaClause };
module.exports = { viaCommonJs };
exports.viaProperty = viaProperty;`,
    );
    const exported = Object.fromEntries(result.units.map((u) => [u.name, u.exported]));
    expect(exported).toEqual({ exported: true, plain: false, viaClause: true, viaCommonJs: true, viaProperty: true });
  });

  it("gives each unit 1-based inclusive lines that cover its source", async () => {
    const content = "// header\n\nexport function target(a) {\n  return a;\n}\n";
    const result = await parse("src/c.ts", content);
    const target = unit(result, "target");
    expect([target.startLine, target.endLine]).toEqual([3, 5]);
    expect(content.split("\n").slice(target.startLine - 1, target.endLine).join("\n")).toBe("export function target(a) {\n  return a;\n}");
  });

  it("captures a JSDoc block that sits directly above, and ignores one separated by a blank line", async () => {
    const result = await parse(
      "src/d.ts",
      `/**
 * Loads one user.
 * @param id the id
 */
export function withDoc(id) {}

/** Detached. */

export function withoutDoc() {}
// not jsdoc
export function lineComment() {}`,
    );
    expect(unit(result, "withDoc").docstring).toBe("Loads one user.\n@param id the id");
    expect(unit(result, "withoutDoc").docstring).toBeUndefined();
    expect(unit(result, "lineComment").docstring).toBeUndefined();
    // The comment is captured as the docstring but stays outside the line range,
    // which must keep matching `code` exactly or citations would point elsewhere.
    expect(unit(result, "withDoc").startLine).toBe(5);
    expect(unit(result, "withDoc").code.startsWith("export function withDoc")).toBe(true);
  });

  it("keeps a signature and condenses a class body to its members", async () => {
    const result = await parse(
      "src/e.ts",
      `export class UserService {
  private readonly repo: Repo;
  async getUser(id: string): Promise<User> {
    const found = await this.repo.find(id);
    return found;
  }
}`,
    );
    const cls = unit(result, "UserService");
    // The signature describes the declaration; whether it is exported is its own field.
    expect(cls.signature).toBe("class UserService");
    expect(cls.exported).toBe(true);
    expect(cls.code).toContain("private readonly repo: Repo;");
    expect(cls.code).toContain("async getUser(id: string): Promise<User> { … }");
    expect(cls.code).not.toContain("await this.repo.find(id)");
    // the method itself keeps its full body
    expect(unit(result, "UserService.getUser").code).toContain("await this.repo.find(id)");
    expect(unit(result, "UserService.getUser").parentUid).toBe(cls.uid);
  });

  it("names a default-exported anonymous function after its file", async () => {
    const result = await parse("src/components/UserCard.tsx", "export default function ({ name }) { return <p>{name}</p>; }");
    expect(unit(result, "UserCard").exported).toBe(true);
  });
});

describe("imports", () => {
  it("reads every ES import form with the name each one binds", async () => {
    const result = await parse(
      "src/f.ts",
      `import axios from "axios";
import * as fs from "node:fs";
import { useState, useEffect as onMount } from "react";
import type { User } from "./types";
import "./styles.css";`,
    );
    expect(result.references.filter((r) => r.type === "imports").map((r) => ({
      specifier: r.target.kind === "import" ? r.target.specifier : "",
      imported: r.target.kind === "import" ? r.target.importedName : undefined,
      local: r.metadata?.localName,
    }))).toEqual([
      { specifier: "axios", imported: "default", local: "axios" },
      { specifier: "node:fs", imported: "*", local: "fs" },
      { specifier: "react", imported: "useState", local: "useState" },
      { specifier: "react", imported: "useEffect", local: "onMount" },
      { specifier: "./types", imported: "User", local: "User" },
      { specifier: "./styles.css", imported: undefined, local: undefined },
    ]);
  });

  it("reads CommonJS require, including destructuring and renaming", async () => {
    const result = await parse(
      "src/g.js",
      `const express = require("express");
const { listUsers } = require("../controllers/userController");
const { findAll: getAll } = require("./service");`,
    );
    expect(result.references.filter((r) => r.type === "imports").map((r) => ({
      specifier: r.target.kind === "import" ? r.target.specifier : "",
      imported: r.target.kind === "import" ? r.target.importedName : undefined,
      local: r.metadata?.localName,
    }))).toEqual([
      { specifier: "express", imported: undefined, local: "express" },
      { specifier: "../controllers/userController", imported: "listUsers", local: "listUsers" },
      { specifier: "./service", imported: "findAll", local: "getAll" },
    ]);
  });

  it("attributes imports to the file unit, not to whichever function happens to follow", async () => {
    const result = await parse("src/h.ts", `import a from "a";\nexport function f() {}`);
    const imports = result.references.filter((r) => r.type === "imports");
    expect(imports.every((r) => r.fromUid === "shop:src/h.ts#<file>")).toBe(true);
  });
});

describe("calls and inheritance", () => {
  it("records calls per unit, including method calls, and skips language built-ins", async () => {
    const result = await parse(
      "src/i.ts",
      `export function outer() {
  helper();
  userService.findAll();
  new UserRepo();
  console.log("noise");
  JSON.stringify({});
  Math.max(1, 2);
}
export function other() { lonely(); }`,
    );
    const fromOuter = result.references.filter((r) => r.fromUid.endsWith("#outer") && r.type === "calls");
    expect(fromOuter.map((r) => (r.target.kind === "symbol" ? r.target.name : ""))).toEqual([
      "helper", "userService.findAll", "UserRepo",
    ]);
    const fromOther = result.references.filter((r) => r.fromUid.endsWith("#other"));
    expect(fromOther.map((r) => (r.target.kind === "symbol" ? r.target.name : ""))).toEqual(["lonely"]);
  });

  it("records this.method() from inside a class method", async () => {
    const result = await parse("src/j.ts", `class A { run() { this.step(); } step() {} }`);
    const fromRun = result.references.filter((r) => r.fromUid.endsWith("#A.run"));
    expect(fromRun.map((r) => (r.target.kind === "symbol" ? r.target.name : ""))).toEqual(["this.step"]);
  });

  it("records extends and implements", async () => {
    const result = await parse("src/k.ts", `export class Impl extends BaseService implements Contract, Other {}\nexport interface Child extends Parent {}`);
    expect(refs(result, "extends")).toEqual(["BaseService", "Parent"]);
    expect(refs(result, "implements")).toEqual(["Contract", "Other"]);
  });
});

describe("resolveImport", () => {
  const files = new Set([
    "src/services/user.ts", "src/components/UserCard.tsx", "src/hooks/useUsers.ts",
    "src/utils/index.ts", "services/userService.js", "routes/users.js", "src/legacy.js",
  ]);
  const hasFile = (p: string) => files.has(p);
  const resolve = (fromPath: string, specifier: string) => typescriptAdapter.resolveImport({ fromPath, specifier, repo, hasFile });

  it.each([
    ["relative, extension inferred", "src/pages/UsersPage.tsx", "../components/UserCard", "src/components/UserCard.tsx"],
    ["relative with ./", "routes/users.js", "../controllers/../services/userService", "services/userService.js"],
    ["folder index", "src/pages/UsersPage.tsx", "../utils", "src/utils/index.ts"],
    ["alias", "src/pages/UsersPage.tsx", "@/hooks/useUsers", "src/hooks/useUsers.ts"],
    ["alias to a tsx file", "src/pages/UsersPage.tsx", "@/components/UserCard", "src/components/UserCard.tsx"],
    [".js specifier meaning .ts", "src/pages/UsersPage.tsx", "@/services/user.js", "src/services/user.ts"],
    ["exact path", "src/a.ts", "./legacy.js", "src/legacy.js"],
  ])("resolves %s", (_label, from, specifier, expected) => {
    expect(resolve(from, specifier)).toBe(expected);
  });

  it.each([
    ["a package", "src/a.ts", "axios"],
    ["a node builtin", "src/a.ts", "node:fs"],
    ["a scoped package", "src/a.ts", "@tanstack/react-router"],
    ["a relative path that does not exist", "src/a.ts", "./missing"],
    ["an alias that does not exist", "src/a.ts", "@/nope"],
    ["an escape above the repo root", "src/a.ts", "../../../etc/passwd"],
  ])("returns null for %s", (_label, from, specifier) => {
    expect(resolve(from, specifier)).toBeNull();
  });
});

describe("robustness", () => {
  it("still returns units for a file with a syntax error", async () => {
    const result = await parse("src/broken.ts", `export function ok() { return 1; }\nexport function broken( {{{ `);
    expect(result.units.some((u) => u.name === "ok")).toBe(true);
  });

  it("handles an empty file and a comment-only file", async () => {
    expect((await parse("src/empty.ts", "")).units).toEqual([]);
    expect((await parse("src/comment.ts", "// nothing here\n")).units).toEqual([]);
  });

  it("rejects a file too large to parse instead of stalling", async () => {
    await expect(parse("src/huge.ts", "const x = 1;\n".repeat(60_000))).rejects.toThrow(/too large/i);
  });

  it("parses TSX without treating HTML tags as code units", async () => {
    const result = await parse("src/l.tsx", `export function Page() { return <div className="x"><UserCard/></div>; }`);
    expect(unitNames(result)).toEqual(["function:Page"]);
  });
});

describe("the sample-mern fixture", () => {
  const read = (rel: string) => fs.readFileSync(path.join(FIXTURE, rel), "utf8");

  it("extracts userService.js functions with correct line ranges and doc comments", async () => {
    const content = read("services/userService.js");
    const result = await parse("services/userService.js", content);
    expect(unitNames(result)).toEqual(["function:createUser", "function:findAll", "function:getUserById"]);
    const findAll = unit(result, "findAll");
    expect(findAll.exported).toBe(true); // via module.exports = { findAll, ... }
    expect(findAll.docstring).toBe("Return every user.");
    expect(content.split("\n").slice(findAll.startLine - 1, findAll.endLine).join("\n")).toContain("return User.find()");
    expect(refs(result, "imports")).toEqual(["../models/User"]);
  });

  it("extracts the controller's calls into the service", async () => {
    const result = await parse("controllers/userController.js", read("controllers/userController.js"));
    const fromList = result.references.filter((r) => r.fromUid.endsWith("#listUsers") && r.type === "calls");
    expect(fromList.map((r) => (r.target.kind === "symbol" ? r.target.name : ""))).toContain("userService.findAll");
  });

  it("extracts the React hook and its component", async () => {
    const hook = await parse("src/hooks/useUsers.ts", read("src/hooks/useUsers.ts"));
    expect(unitNames(hook)).toEqual(["function:useUsers", "type:User"]);
    expect(refs(hook, "imports")).toEqual(expect.arrayContaining(["react", "axios"]));

    const page = await parse("src/pages/UsersPage.tsx", read("src/pages/UsersPage.tsx"));
    expect(unitNames(page)).toEqual(["function:UsersPage"]);
    expect(refs(page, "imports")).toEqual(["@/hooks/useUsers", "@/components/UserCard"]);
    // UserCard is JSX, so the language adapter leaves it to the React adapter
    expect(refs(page, "renders")).toEqual([]);
  });

  it("extracts UserCard as a function unit", async () => {
    const result = await parse("src/components/UserCard.tsx", read("src/components/UserCard.tsx"));
    expect(result.units.map((u) => u.name)).toEqual(["UserCardProps", "UserCard"]);
    expect(unit(result, "UserCard").kind).toBe("function");
  });
});
