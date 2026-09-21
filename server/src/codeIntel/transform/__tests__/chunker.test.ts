import type { CodeUnit } from "../../core/types";
import { chunkUnit, estimateTokens, unitUidOfChunk } from "../chunker";
import { buildUnitHeaderText } from "../contextHeader";
import { buildSearchText, splitIdentifier } from "../searchText";

const unit = (over: Partial<CodeUnit> = {}): CodeUnit => ({
  uid: "shop:src/a.ts#big",
  path: "src/a.ts",
  kind: "function",
  name: "big",
  qualifiedName: "big",
  code: "function big() {\n  return 1;\n}",
  startLine: 10,
  endLine: 12,
  exported: true,
  metadata: {},
  ...over,
});

const bigCode = (lines: number) =>
  ["function big(a, b) {", ...Array.from({ length: lines }, (_, i) => `  const value${i} = compute(${i}); // line ${i}`), "}"].join("\n");

describe("chunkUnit", () => {
  it("keeps a small unit as one chunk with its own uid and lines", () => {
    const chunks = chunkUnit({ unit: unit(), maxTokens: 800 });
    expect(chunks).toEqual([{ uid: "shop:src/a.ts#big", unitUid: "shop:src/a.ts#big", code: unit().code, startLine: 10, endLine: 12 }]);
  });

  it("splits an oversized unit into parts that each fit the budget", () => {
    const code = bigCode(400);
    const chunks = chunkUnit({ unit: unit({ code, startLine: 1, endLine: 402 }), maxTokens: 200 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(estimateTokens(c.code)).toBeLessThanOrEqual(200 + 20);
    expect(chunks.map((c) => c.uid)).toEqual(chunks.map((_, i) => `shop:src/a.ts#big#part${i + 1}`));
    expect(chunks.every((c) => c.unitUid === "shop:src/a.ts#big")).toBe(true);
    expect(chunks[0].part).toEqual({ index: 1, total: chunks.length });
    expect(chunks.at(-1)!.part).toEqual({ index: chunks.length, total: chunks.length });
  });

  it("covers every line exactly once, in order, with no gaps", () => {
    const code = bigCode(300);
    const total = code.split("\n").length;
    const chunks = chunkUnit({ unit: unit({ code, startLine: 50, endLine: 50 + total - 1 }), maxTokens: 150 });
    expect(chunks[0].startLine).toBe(50);
    expect(chunks.at(-1)!.endLine).toBe(50 + total - 1);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].startLine).toBe(chunks[i - 1].endLine + 1);
  });

  it("repeats the signature at the top of every later part", () => {
    const chunks = chunkUnit({ unit: unit({ code: bigCode(300), signature: "function big(a, b)" }), maxTokens: 150 });
    expect(chunks[0].code.startsWith("function big(a, b) {")).toBe(true);
    for (const c of chunks.slice(1)) expect(c.code.startsWith("function big(a, b)\n// … (continued)\n")).toBe(true);
  });

  it("prefers to cut at a blank line", () => {
    const paragraph = (n: number) => Array.from({ length: 12 }, (_, i) => `  step${n}_${i}();`).join("\n");
    const code = ["function big() {", paragraph(1), "", paragraph(2), "", paragraph(3), "}"].join("\n");
    const chunks = chunkUnit({ unit: unit({ code }), maxTokens: 110 });
    expect(chunks.length).toBeGreaterThan(1);
    // no part should start in the middle of a paragraph: each begins at a paragraph start or the function header
    for (const c of chunks.slice(1)) {
      const first = c.code.split("\n")[2];
      expect(first === "" || /step\d_0\(\)/.test(first)).toBe(true);
    }
  });

  it("cuts a single enormous line by characters instead of looping forever", () => {
    const code = `const blob = "${"x".repeat(5000)}";`;
    const chunks = chunkUnit({ unit: unit({ code, startLine: 1, endLine: 1 }), maxTokens: 100 });
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.startLine === 1 && c.endLine === 1)).toBe(true);
  });

  it("maps a part uid back to its unit", () => {
    expect(unitUidOfChunk("shop:src/a.ts#big#part3")).toBe("shop:src/a.ts#big");
    expect(unitUidOfChunk("shop:src/a.ts#big")).toBe("shop:src/a.ts#big");
  });
});

describe("buildUnitHeaderText", () => {
  const [chunk] = chunkUnit({ unit: unit(), maxTokens: 800 });

  it("puts repo, file, kind, symbol and export status above the code", () => {
    const text = buildUnitHeaderText({ repoName: "shop", unit: unit(), chunk });
    expect(text).toBe(
      "Repo: shop | File: src/a.ts | Kind: function\nSymbol: big | Exports: yes\n---\nfunction big() {\n  return 1;\n}",
    );
  });

  it("names the owning class, the route, the summary and the imports", () => {
    const method = unit({
      kind: "method",
      name: "getUser",
      qualifiedName: "UserService.getUser",
      exported: false,
      metadata: { httpMethod: "GET", routePath: "/api/users/:id", clientRoute: "/users" },
    });
    const text = buildUnitHeaderText({
      repoName: "shop",
      unit: method,
      chunk,
      summary: "Loads one user.",
      importSpecifiers: ["mongoose", "../models/User", "mongoose"],
    });
    expect(text).toContain("Symbol: getUser (in UserService) | Exports: no");
    expect(text).toContain("Route: GET /api/users/:id");
    expect(text).toContain("Client route: /users");
    expect(text).toContain("Summary: Loads one user.");
    expect(text).toContain("Imports used: mongoose, ../models/User");
  });

  it("marks split parts", () => {
    const chunks = chunkUnit({ unit: unit({ code: bigCode(300) }), maxTokens: 150 });
    expect(buildUnitHeaderText({ repoName: "shop", unit: unit(), chunk: chunks[1] })).toContain(`Part 2/${chunks.length}`);
  });

  it("limits how many imports it lists", () => {
    const specs = Array.from({ length: 20 }, (_, i) => `pkg${i}`);
    const line = buildUnitHeaderText({ repoName: "shop", unit: unit(), chunk, importSpecifiers: specs })
      .split("\n").find((l) => l.startsWith("Imports used:"))!;
    expect(line.split(", ").length).toBe(8);
  });
});

describe("search text", () => {
  it.each([
    ["getUserById", "get user by id"],
    ["HTTPServer", "http server"],
    ["user_id", "user id"],
    ["user-profile.page", "user profile page"],
    ["UserService.getUser", "user service get user"],
    ["/api/users/:id", "api users id"],
  ])("splits %s", (input, expected) => {
    expect(splitIdentifier(input)).toBe(expected);
  });

  it("lets natural language match a camelCase name", () => {
    const text = buildSearchText({ name: "getUserById", qualifiedName: "UserService.getUserById", docstring: "Fetch a user." });
    expect(text).toContain("get user by id");
    expect(text).toContain("getUserById");
    expect(text).toContain("user service");
    expect(text).toContain("Fetch a user.");
  });

  it("indexes a route by its path words", () => {
    const text = buildSearchText({
      name: "route:GET /api/users", qualifiedName: "route:GET /api/users",
      metadata: { httpMethod: "GET", routePath: "/api/users" },
    });
    expect(text).toContain("api users");
  });

  it("caps its length", () => {
    expect(buildSearchText({ name: "x", qualifiedName: "x", summary: "y".repeat(10_000) }).length).toBeLessThanOrEqual(4000);
  });
});
