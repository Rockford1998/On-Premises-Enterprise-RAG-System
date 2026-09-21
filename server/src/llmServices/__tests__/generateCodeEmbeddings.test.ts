import axios from "axios";
import { applyRole, generateCodeEmbeddings, probeEmbeddingDimension } from "../generateCodeEmbeddings";

jest.mock("axios");
const mockedPost = axios.post as jest.Mock;
(axios as unknown as { isAxiosError: (e: unknown) => boolean }).isAxiosError = (e: unknown) =>
  !!(e && typeof e === "object" && "isAxiosError" in e);

describe("applyRole", () => {
  it("leaves qwen3 documents raw and wraps queries with an instruction", () => {
    expect(applyRole({ text: "fn()", model: "qwen3-embedding:0.6b", role: "document" })).toBe("fn()");
    expect(applyRole({ text: "where is login", model: "qwen3-embedding:4b", role: "query" }))
      .toMatch(/^Instruct: .+\nQuery: where is login$/);
  });

  it("prefixes nomic documents and queries", () => {
    expect(applyRole({ text: "x", model: "nomic-embed-text", role: "document" })).toBe("search_document: x");
    expect(applyRole({ text: "x", model: "nomic-embed-text", role: "query" })).toBe("search_query: x");
  });

  it("embeds unknown families verbatim", () => {
    expect(applyRole({ text: "x", model: "some-model", role: "query" })).toBe("x");
  });
});

describe("generateCodeEmbeddings", () => {
  it("sends code verbatim (no lower-casing or stripping) to the model it was given", async () => {
    mockedPost.mockResolvedValue({ data: { embeddings: [[3, 4]] } });
    const [v] = await generateCodeEmbeddings({ texts: ["Foo::Bar() => {}"], model: "custom", role: "document" });
    expect(mockedPost.mock.calls[0][1]).toEqual({ model: "custom", input: ["Foo::Bar() => {}"] });
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
  });

  it("returns nothing for an empty batch without calling Ollama", async () => {
    expect(await generateCodeEmbeddings({ texts: [], model: "m", role: "document" })).toEqual([]);
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("rejects a response whose length does not match the input", async () => {
    mockedPost.mockResolvedValue({ data: { embeddings: [[1]] } });
    await expect(generateCodeEmbeddings({ texts: ["a", "b"], model: "m", role: "document" })).rejects.toThrow(/Invalid embedding/);
  });

  it("does not retry a deterministic 404 (unknown model)", async () => {
    mockedPost.mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
    await expect(generateCodeEmbeddings({ texts: ["a"], model: "nope", role: "document" })).rejects.toBeDefined();
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it("probes the dimension from the returned vector", async () => {
    mockedPost.mockResolvedValue({ data: { embeddings: [new Array(1024).fill(0.1)] } });
    expect(await probeEmbeddingDimension({ model: "qwen3-embedding:0.6b" })).toBe(1024);
  });
});
