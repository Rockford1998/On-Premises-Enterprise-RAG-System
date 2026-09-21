import { buildCreateTablesSql, chooseEmbedType, codeTables } from "../codeGraph.service";

const BOT = "bot_lk3f9x_AB12CD";

describe("codeTables", () => {
  it("builds lower-cased per-bot names", () => {
    expect(codeTables(BOT)).toEqual({
      repos: "code_bot_lk3f9x_ab12cd_repos",
      files: "code_bot_lk3f9x_ab12cd_files",
      modules: "code_bot_lk3f9x_ab12cd_modules",
      units: "code_bot_lk3f9x_ab12cd_units",
      edges: "code_bot_lk3f9x_ab12cd_edges",
      embeddings: "code_bot_lk3f9x_ab12cd_embeddings",
    });
  });

  it("gives two bots disjoint tables", () => {
    const a = Object.values(codeTables("bot_a_AAAAAA"));
    const b = Object.values(codeTables("bot_b_BBBBBB"));
    expect(a.filter((name) => b.includes(name))).toEqual([]);
  });

  it.each([
    ["injection", 'bot_x"; DROP TABLE users; --'],
    ["path-like", "../bot_x"],
    ["wrong prefix", "kb_x"],
    ["empty", ""],
    ["space", "bot_a b"],
  ])("rejects an unsafe botId (%s)", (_label, botId) => {
    expect(() => codeTables(botId)).toThrow();
  });

  it("rejects ids that would exceed Postgres' 63-character identifier limit", () => {
    expect(() => codeTables(`bot_${"x".repeat(60)}`)).toThrow(/too long/);
  });
});

describe("chooseEmbedType", () => {
  it("uses vector up to 2000 dims and halfvec up to 4000", () => {
    expect(chooseEmbedType(768)).toBe("vector");
    expect(chooseEmbedType(1024)).toBe("vector");
    expect(chooseEmbedType(2000)).toBe("vector");
    expect(chooseEmbedType(2560)).toBe("halfvec");
    expect(chooseEmbedType(4000)).toBe("halfvec");
  });

  it("rejects unusable dimensions", () => {
    expect(() => chooseEmbedType(4001)).toThrow(/exceeds/);
    expect(() => chooseEmbedType(0)).toThrow();
    expect(() => chooseEmbedType(10.5)).toThrow();
    expect(() => chooseEmbedType(NaN)).toThrow();
  });
});

describe("buildCreateTablesSql", () => {
  const joined = (opts: { embedDim: number; embedType: string }) =>
    buildCreateTablesSql({ botId: BOT, ...opts }).join("\n;\n");

  it("sizes the embedding column and index from the config", () => {
    const sql = joined({ embedDim: 1024, embedType: "vector" });
    expect(sql).toContain("vector(1024) NOT NULL");
    expect(sql).toContain("vector_cosine_ops");
    expect(sql).not.toContain("halfvec");
  });

  it("uses halfvec ops for large models", () => {
    const sql = joined({ embedDim: 2560, embedType: "halfvec" });
    expect(sql).toContain("halfvec(2560)");
    expect(sql).toContain("halfvec_cosine_ops");
  });

  it("is idempotent DDL that only ever names this bot's tables", () => {
    const statements = buildCreateTablesSql({ botId: BOT, embedDim: 768, embedType: "vector" });
    for (const s of statements) expect(s).toMatch(/^CREATE (TABLE|INDEX) IF NOT EXISTS/);
    const prefix = "code_bot_lk3f9x_ab12cd_";
    const referenced = joined({ embedDim: 768, embedType: "vector" }).match(/code_[a-z0-9_]+/g) ?? [];
    expect(referenced.length).toBeGreaterThan(0);
    for (const name of referenced) expect(name.startsWith(prefix)).toBe(true);
  });

  it("stays within the identifier limit for every index name", () => {
    for (const s of buildCreateTablesSql({ botId: BOT, embedDim: 768, embedType: "vector" })) {
      for (const name of s.match(/idx_[a-z0-9_]+/g) ?? []) expect(name.length).toBeLessThanOrEqual(63);
    }
  });

  it.each([
    ["bad type", { embedDim: 768, embedType: "vector); DROP TABLE x; --" }],
    ["dimension too large for vector", { embedDim: 2001, embedType: "vector" }],
    ["fractional dimension", { embedDim: 7.5, embedType: "vector" }],
    ["zero", { embedDim: 0, embedType: "vector" }],
  ])("rejects an unsafe config (%s)", (_label, opts) => {
    expect(() => buildCreateTablesSql({ botId: BOT, ...opts })).toThrow();
  });
});
