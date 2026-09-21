import { CodeRequestError, deriveRepoName, validateRepoName } from "../codeIndex.service";

describe("validateRepoName", () => {
  it.each(["shop", "shop-frontend", "my.repo_v2", "A1", "a".repeat(64)])("accepts %s", (name) => {
    expect(validateRepoName(name)).toBe(name);
  });

  // ':' and '#' would corrupt unit ids ("<repo>:<path>#<symbol>")
  it.each(["", "-lead", ".hidden", "has space", "a:b", "a#b", "a/b", "../x", "a".repeat(65)])("rejects %j", (name) => {
    expect(() => validateRepoName(name)).toThrow(CodeRequestError);
  });
});

describe("deriveRepoName", () => {
  it.each([
    ["shop.zip", "shop"],
    ["My Shop (v2).ZIP", "My-Shop-v2"],
    ["repo-main.zip", "repo-main"],
    ["  ###.zip", "repository"],
    ["-weird.zip", "weird"],
    [".hidden.zip", "repo-.hidden"],
  ])("%s -> %s", (input, expected) => {
    expect(deriveRepoName(input)).toBe(expected);
  });

  it("always yields a valid name", () => {
    for (const input of ["a b c.zip", "日本語.zip", "x".repeat(200) + ".zip", "..zip", ""]) {
      expect(() => validateRepoName(deriveRepoName(input))).not.toThrow();
    }
  });
});
