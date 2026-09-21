import { createLimiter } from "../limit";
import { sha256 } from "../hash";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createLimiter", () => {
  it("never runs more than N at once and returns every result", async () => {
    const limit = createLimiter(3);
    let active = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        limit(async () => {
          active++;
          peak = Math.max(peak, active);
          await sleep(5);
          active--;
          return i * 2;
        }),
      ),
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
    expect(results).toEqual(Array.from({ length: 12 }, (_, i) => i * 2));
  });

  it("propagates a rejection and still frees the slot", async () => {
    const limit = createLimiter(1);
    await expect(limit(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(limit(async () => "next")).resolves.toBe("next");
  });

  it("treats a bad concurrency as 1", async () => {
    const limit = createLimiter(0);
    await expect(limit(async () => 7)).resolves.toBe(7);
  });
});

describe("sha256", () => {
  it("is stable and separates parts so ('ab','c') differs from ('a','bc')", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
    expect(sha256("ab", "c")).not.toBe(sha256("a", "bc"));
    expect(sha256("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});
