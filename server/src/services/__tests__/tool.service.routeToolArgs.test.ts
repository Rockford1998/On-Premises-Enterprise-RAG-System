import { ToolService } from "../tool.service";

describe("ToolService.routeToolArgs", () => {
  const toolService = new ToolService();

  it("substitutes a required path variable into the endpoint (:name style)", () => {
    const tool = {
      endpoint: "https://api.example.com/users/:userId",
      pathVariable: [{ name: "userId", required: true }],
    };
    const result = toolService.routeToolArgs({ tool, args: { userId: "42" } });
    expect(result.endpoint).toBe("https://api.example.com/users/42");
    expect(result.missing).toEqual([]);
  });

  it("substitutes a required path variable into the endpoint ({name} style)", () => {
    const tool = {
      endpoint: "https://api.example.com/users/{userId}/orders",
      pathVariable: [{ name: "userId", required: true }],
    };
    const result = toolService.routeToolArgs({ tool, args: { userId: "42" } });
    expect(result.endpoint).toBe("https://api.example.com/users/42/orders");
  });

  it("flags a missing required path variable", () => {
    const tool = {
      endpoint: "https://api.example.com/users/:userId",
      pathVariable: [{ name: "userId", required: true }],
    };
    const result = toolService.routeToolArgs({ tool, args: {} });
    expect(result.missing).toContain("userId");
  });

  it("routes declared query params and applies a defaultValue when omitted", () => {
    const tool = {
      endpoint: "https://api.example.com/search",
      queryParam: [
        { name: "q", required: true },
        { name: "page", required: false, defaultValue: 1 },
      ],
    };
    const result = toolService.routeToolArgs({
      tool,
      args: { q: "pune" },
    });
    expect(result.queryParams).toEqual({ q: "pune", page: 1 });
    expect(result.missing).toEqual([]);
  });

  it("routes declared request-body fields by schema property name", () => {
    const tool = {
      endpoint: "https://api.example.com/tickets",
      requestBody: {
        schema: {
          properties: { title: {}, priority: {} },
          required: ["title"],
        },
      },
    };
    const result = toolService.routeToolArgs({
      tool,
      args: { title: "Broken login", priority: "high" },
    });
    expect(result.body).toEqual({ title: "Broken login", priority: "high" });
    expect(result.missing).toEqual([]);
  });

  it("flags a missing required body field", () => {
    const tool = {
      endpoint: "https://api.example.com/tickets",
      requestBody: {
        schema: { properties: { title: {} }, required: ["title"] },
      },
    };
    const result = toolService.routeToolArgs({ tool, args: {} });
    expect(result.missing).toContain("title");
  });

  it("puts args that match no declared name into `unmatched` instead of dropping them", () => {
    const tool = {
      endpoint: "https://api.example.com/search",
      queryParam: [{ name: "q", required: true }],
    };
    const result = toolService.routeToolArgs({
      tool,
      args: { q: "pune", extraField: "keep-me" },
    });
    expect(result.unmatched).toEqual({ extraField: "keep-me" });
  });
});
