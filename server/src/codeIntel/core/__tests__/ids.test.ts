import { dedupeUids, fileUid, partUid, routeQualifiedName, summaryUid, unitUid } from "../ids";

describe("codeIntel ids", () => {
  it("builds <repo>:<path>#<qualifiedName>", () => {
    expect(unitUid({ repoName: "shop", path: "src/services/user.ts", qualifiedName: "UserService.getUser" }))
      .toBe("shop:src/services/user.ts#UserService.getUser");
  });

  it("builds route and file ids", () => {
    const route = routeQualifiedName({ method: "get", path: "/api/users/:id" });
    expect(route).toBe("route:GET /api/users/:id");
    expect(unitUid({ repoName: "shop", path: "src/routes/user.ts", qualifiedName: route }))
      .toBe("shop:src/routes/user.ts#route:GET /api/users/:id");
    expect(fileUid({ repoName: "shop", path: "src/a.ts" })).toBe("shop:src/a.ts#<file>");
  });

  it("is deterministic", () => {
    const args = { repoName: "r", path: "p.ts", qualifiedName: "f" };
    expect(unitUid(args)).toBe(unitUid({ ...args }));
  });

  it("suffixes part ids", () => {
    expect(partUid({ uid: "r:p.ts#f", part: 2 })).toBe("r:p.ts#f#part2");
  });

  it("disambiguates collisions with @startLine and keeps the first plain", () => {
    const out = dedupeUids([
      { uid: "r:p.ts#f", startLine: 3 },
      { uid: "r:p.ts#f", startLine: 10 },
      { uid: "r:p.ts#g", startLine: 20 },
    ]);
    expect(out.map((u) => u.uid)).toEqual(["r:p.ts#f", "r:p.ts#f@10", "r:p.ts#g"]);
  });

  it("stays unique even when the line-suffixed id collides too", () => {
    const out = dedupeUids([
      { uid: "u", startLine: 5 },
      { uid: "u", startLine: 5 },
      { uid: "u", startLine: 5 },
    ]);
    expect(new Set(out.map((u) => u.uid)).size).toBe(3);
  });

  it("prefixes summary ids so they cannot collide with unit ids", () => {
    expect(summaryUid({ kind: "repo", repoName: "shop" })).toBe("repo:shop");
    expect(summaryUid({ kind: "file", repoName: "shop", path: "a.ts" })).toBe("file:shop:a.ts");
    expect(summaryUid({ kind: "module", repoName: "shop", path: "src" })).toBe("module:shop:src");
  });
});
