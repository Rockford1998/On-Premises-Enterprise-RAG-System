import { ToolService } from "../tool.service";

describe("ToolService.renderTemplateByData", () => {
  const toolService = new ToolService();

  it("substitutes a placeholder in a plain string template", () => {
    const result = toolService.renderTemplateByData(
      "https://api.example.com/${city}",
      { city: "Pune" },
    );
    expect(result).toBe("https://api.example.com/Pune");
  });

  it("leaves an unresolved placeholder untouched", () => {
    const result = toolService.renderTemplateByData("${missing}", {});
    expect(result).toBe("${missing}");
  });

  it("resolves a nested dot-path placeholder in an object template", () => {
    const result = toolService.renderTemplateByData(
      { location: "${user.city}" },
      { user: { city: "Delhi" } },
    );
    expect(result).toEqual({ location: "Delhi" });
  });

  it("merges unused data fields back in by default (isAddRestData: true)", () => {
    const result = toolService.renderTemplateByData(
      { q: "${city}" },
      { city: "Mumbai", extra: "leftover" },
    );
    expect(result).toEqual({ q: "Mumbai", extra: "leftover" });
  });

  it("always strips a top-level 'user' field from the merged leftovers", () => {
    const result = toolService.renderTemplateByData(
      {},
      { user: { email: "a@b.com" }, city: "Mumbai" },
    );
    expect(result).toEqual({ city: "Mumbai" });
  });

  it("does not merge leftover data when isAddRestData is false", () => {
    const result = toolService.renderTemplateByData(
      { q: "${city}" },
      { city: "Pune", other: "ignored" },
      false,
    );
    expect(result).toEqual({ q: "Pune" });
  });
});
