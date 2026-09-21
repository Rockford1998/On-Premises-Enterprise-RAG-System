import mongoose from "mongoose";
import { ensureIndexes } from "../mongo";

describe("ensureIndexes", () => {
  afterEach(() => jest.restoreAllMocks());

  it("builds indexes on every registered model and tolerates one failing", async () => {
    const good = mongoose.model("EnsureIndexesGood", new mongoose.Schema({ a: String }));
    const bad = mongoose.model("EnsureIndexesBad", new mongoose.Schema({ b: String }));
    const goodSpy = jest.spyOn(good, "createIndexes").mockResolvedValue(undefined as never);
    const badSpy = jest.spyOn(bad, "createIndexes").mockRejectedValue(new Error("E11000 duplicate key"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(ensureIndexes()).resolves.toBeUndefined();

    expect(goodSpy).toHaveBeenCalledTimes(1);
    expect(badSpy).toHaveBeenCalledTimes(1);
    // the failure is reported with the model name and reason, not thrown
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("EnsureIndexesBad"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("E11000"));
  });
});
