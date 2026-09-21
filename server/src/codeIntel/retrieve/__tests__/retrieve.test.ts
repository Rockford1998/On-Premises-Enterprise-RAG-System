import { buildContext, ContextUnit } from "../contextBuilder";
import { classifyQuery, identifierTokens } from "../queryClassifier";
import { fuse } from "../rrf";
import { parseJsonToolCall } from "../../../llmServices/runCodeAgent";
import { buildCodePrompt } from "../../../llmServices/generateCodeAnswer";

describe("classifyQuery", () => {
  it.each([
    ["getUserById", "symbol"],
    ["UserService.getUser", "symbol"],
    ["`useUsers`", "symbol"],
    ["how does login work end to end", "flow"],
    ["what happens when the users page loads", "flow"],
    ["walk me through the checkout", "flow"],
    ["what breaks if I rename findAll", "impact"],
    ["where is getUserById used", "impact"],
    ["who calls the payment service", "impact"],
    ["which env variables configure the database", "config"],
    ["how is docker set up", "config"],
    ["what does this project do", "conceptual"],
    ["explain the caching strategy", "conceptual"],
  ])("%j -> %s", (query, expected) => {
    expect(classifyQuery(query)).toBe(expected);
  });

  it("prefers impact over flow when a question asks about callers", () => {
    expect(classifyQuery("what happens when I change findAll — who calls it")).toBe("impact");
  });

  it("does not treat ordinary short phrases as a symbol lookup", () => {
    expect(classifyQuery("show users")).toBe("conceptual");
    expect(classifyQuery("users")).toBe("conceptual");
    expect(classifyQuery("the database")).toBe("conceptual");
  });

  it("still recognises a capitalised or underscored name as a symbol", () => {
    expect(classifyQuery("UserService")).toBe("symbol");
    expect(classifyQuery("user_service")).toBe("symbol");
  });
});

describe("identifierTokens", () => {
  it("keeps identifier-looking words and drops ordinary ones", () => {
    expect(identifierTokens("where is getUserById called from")).toEqual(["getUserById"]);
    expect(identifierTokens("UserService.getUser and formatName")).toEqual(expect.arrayContaining(["UserService.getUser", "formatName"]));
    expect(identifierTokens("how does the login page work")).toEqual([]);
  });

  it("returns at most five, longest first", () => {
    const tokens = identifierTokens("aLongOne bLongerOne cVeryMuchLongerOne dOne eOne fOne gOne");
    expect(tokens.length).toBeLessThanOrEqual(5);
    expect(tokens[0].length).toBeGreaterThanOrEqual(tokens[tokens.length - 1].length);
  });
});

describe("fuse (reciprocal rank fusion)", () => {
  it("ranks an item found by several searches above one found by only the best", () => {
    const fused = fuse([
      { ids: ["a", "b", "c"], source: "vector" },
      { ids: ["b", "d"], source: "text" },
      { ids: ["b"], source: "trigram" },
    ]);
    expect(fused[0].id).toBe("b");
    expect(fused[0].ranks.map((r) => r.source).sort()).toEqual(["text", "trigram", "vector"]);
  });

  it("applies weights, so a trusted source can win", () => {
    const even = fuse([{ ids: ["x"], source: "vector" }, { ids: ["y"], source: "trigram" }]);
    expect(even[0].id).toBe("x"); // tie broken by id
    const weighted = fuse([
      { ids: ["x"], source: "vector", weight: 0.5 },
      { ids: ["y"], source: "trigram", weight: 2 },
    ]);
    expect(weighted[0].id).toBe("y");
  });

  it("records where each source ranked an item, for explaining a result", () => {
    const [top] = fuse([{ ids: ["a", "b"], source: "vector" }, { ids: ["b", "a"], source: "text" }]);
    expect(top.ranks).toEqual(expect.arrayContaining([{ source: "vector", rank: 1 }, { source: "text", rank: 2 }]));
  });

  it("is deterministic and handles empty input", () => {
    expect(fuse([])).toEqual([]);
    expect(fuse([{ ids: [], source: "vector" }])).toEqual([]);
    const a = fuse([{ ids: ["p", "q"], source: "s" }]);
    const b = fuse([{ ids: ["p", "q"], source: "s" }]);
    expect(a).toEqual(b);
  });
});

describe("buildContext", () => {
  const unit = (over: Partial<ContextUnit> = {}): ContextUnit => ({
    uid: "shop:src/a.ts#f",
    repo: "shop",
    path: "src/a.ts",
    kind: "function",
    name: "f",
    qualifiedName: "f",
    signature: "function f()",
    summary: null,
    code: "function f() { return 1; }",
    startLine: 10,
    endLine: 12,
    metadata: {},
    ...over,
  });

  it("prefixes every excerpt with the citation the answer must use", () => {
    const built = buildContext({ units: [unit()], queryType: "conceptual", tokenBudget: 2000 });
    expect(built.text).toContain("// src/a.ts:10-12");
    expect(built.citations).toEqual([
      { uid: "shop:src/a.ts#f", repo: "shop", path: "src/a.ts", startLine: 10, endLine: 12, name: "f", kind: "function" },
    ]);
  });

  it("groups units by file and orders them by line", () => {
    const built = buildContext({
      units: [
        unit({ uid: "u3", path: "src/b.ts", startLine: 5, endLine: 6, name: "third" }),
        unit({ uid: "u2", startLine: 40, endLine: 41, name: "second", code: "const second = 2;" }),
        unit({ uid: "u1", startLine: 1, endLine: 2, name: "first", code: "const first = 1;" }),
      ],
      queryType: "conceptual",
      tokenBudget: 4000,
    });
    const aSection = built.text.slice(built.text.indexOf("### shop/src/a.ts"));
    expect(aSection.indexOf("src/a.ts:1-2")).toBeLessThan(aSection.indexOf("src/a.ts:40-41"));
    expect(built.text).toContain("### shop/src/b.ts");
  });

  it("includes repository and file summaries when there are any", () => {
    const built = buildContext({
      units: [unit()],
      repoSummaries: [{ name: "shop", summary: "An online shop." }],
      fileSummaries: [{ path: "src/a.ts", summary: "Helpers." }],
      queryType: "conceptual",
      tokenBudget: 2000,
    });
    expect(built.text).toContain("An online shop.");
    expect(built.text).toContain("src/a.ts: Helpers.");
  });

  it("shows the order the code runs in for a flow question only", () => {
    const chain = [unit({ name: "Page" }), unit({ uid: "x", name: "route", metadata: { httpMethod: "GET", routePath: "/api/users" } })];
    const flow = buildContext({ units: [unit()], chain, queryType: "flow", tokenBudget: 3000 });
    expect(flow.text).toContain("f → GET /api/users");
    const conceptual = buildContext({ units: [unit()], chain, queryType: "conceptual", tokenBudget: 3000 });
    expect(conceptual.text).not.toContain("Path through the code");
  });

  it("stays inside the budget and reports what it had to drop", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      unit({ uid: `u${i}`, name: `f${i}`, startLine: i * 10, endLine: i * 10 + 5, code: `function f${i}() {\n${"  work();\n".repeat(20)}}` }),
    );
    const built = buildContext({ units: many, queryType: "conceptual", tokenBudget: 600 });
    expect(built.includedUids.length).toBeGreaterThan(0);
    expect(built.includedUids.length).toBeLessThan(50);
    expect(built.droppedForBudget).toBeGreaterThan(0);
    // ~3.5 chars per token, with some slack for section headers
    expect(built.text.length).toBeLessThan(600 * 3.5 * 1.6);
    // citations describe exactly what was included, never more
    expect(built.citations.map((c) => c.uid)).toEqual(built.includedUids);
  });

  it("truncates one huge unit rather than letting it crowd everything else out", () => {
    const huge = unit({ uid: "big", name: "big", code: `function big() {\n${"  step();\n".repeat(2000)}}` });
    const small = unit({ uid: "small", name: "small", path: "src/small.ts", code: "const small = 1;" });
    const built = buildContext({ units: [huge, small], queryType: "conceptual", tokenBudget: 800 });
    expect(built.text).toContain("… truncated");
    expect(built.includedUids).toContain("big");
  });

  it("returns something usable when there are no units at all", () => {
    const built = buildContext({ units: [], queryType: "conceptual", tokenBudget: 500 });
    expect(built.citations).toEqual([]);
    expect(built.includedUids).toEqual([]);
  });
});

describe("buildCodePrompt", () => {
  it("demands citations and the exact not-found wording", () => {
    const prompt = buildCodePrompt({ question: "where are users listed?", context: "// a.ts:1-2\ncode" });
    expect(prompt).toContain("path:startLine-endLine");
    expect(prompt).toContain("Not found in indexed code.");
    expect(prompt).toContain("where are users listed?");
    expect(prompt).toContain("// a.ts:1-2");
  });

  it("includes the bot's own instruction when there is one", () => {
    expect(buildCodePrompt({ question: "q", context: "c", instruction: "Answer in French." })).toContain("Answer in French.");
  });

  it("says so plainly when nothing was retrieved", () => {
    expect(buildCodePrompt({ question: "q", context: "" })).toContain("No code was retrieved");
  });
});

describe("parseJsonToolCall", () => {
  it("reads a bare JSON tool call", () => {
    expect(parseJsonToolCall('{"tool": "search_code", "arguments": {"query": "users"}}')).toEqual({
      tool: "search_code",
      arguments: { query: "users" },
    });
  });

  it("reads one wrapped in a code fence, or followed by prose", () => {
    expect(parseJsonToolCall('```json\n{"tool":"find_symbol","arguments":{"name":"f"}}\n```')?.tool).toBe("find_symbol");
    expect(parseJsonToolCall('{"tool":"list_routes","arguments":{}} then I will look further')?.tool).toBe("list_routes");
  });

  it("accepts the name/parameters spelling some models use", () => {
    expect(parseJsonToolCall('{"name":"get_unit","parameters":{"uid":"x"}}')).toEqual({ tool: "get_unit", arguments: { uid: "x" } });
  });

  it("returns null for prose, malformed JSON and JSON that is not a tool call", () => {
    expect(parseJsonToolCall("The answer is in src/a.ts:1-2.")).toBeNull();
    expect(parseJsonToolCall('{"tool": "search_code"')).toBeNull();
    expect(parseJsonToolCall('{"answer": "done"}')).toBeNull();
    expect(parseJsonToolCall("")).toBeNull();
  });
});
