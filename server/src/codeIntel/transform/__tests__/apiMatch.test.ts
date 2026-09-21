import { matchApiCall, normalizeApiPath } from "../apiMatch";

describe("normalizeApiPath", () => {
  it.each([
    ["/api/users", "/api/users"],
    ["/api/users/", "/api/users"],
    ["api/users", "/api/users"],
    ["/api/users/:id", "/api/users/:param"],
    ["/api/users/{id}", "/api/users/:param"],
    ["/api/users/${id}", "/api/users/:param"],
    ["/api/users/<int:id>", "/api/users/:param"],
    ["/api/users?page=2#top", "/api/users"],
    ["http://localhost:4000/api/users", "/api/users"],
    ["https://api.example.com", "/"],
    ["${BASE_URL}/users", "/:param/users"],
    ["/", "/"],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizeApiPath(raw)).toBe(expected);
  });
});

describe("matchApiCall", () => {
  const routes = [
    { uid: "list", method: "GET", path: "/api/users" },
    { uid: "create", method: "POST", path: "/api/users" },
    { uid: "byId", method: "GET", path: "/api/users/:id" },
    { uid: "me", method: "GET", path: "/api/users/me" },
    { uid: "orders", method: "GET", path: "/api/orders" },
  ];

  it("matches on method and path", () => {
    expect(matchApiCall({ method: "get", path: "/api/users", routes })).toBe("list");
    expect(matchApiCall({ method: "POST", path: "/api/users", routes })).toBe("create");
  });

  it("treats parameters as wildcards in either direction", () => {
    expect(matchApiCall({ method: "GET", path: "/api/users/${id}", routes })).toBe("byId");
    expect(matchApiCall({ method: "GET", path: "/api/users/42", routes })).toBe("byId");
  });

  it("prefers the more specific route over a parameter route", () => {
    expect(matchApiCall({ method: "GET", path: "/api/users/me", routes })).toBe("me");
  });

  it("does not match a different method or an unknown path", () => {
    expect(matchApiCall({ method: "DELETE", path: "/api/users", routes })).toBeNull();
    expect(matchApiCall({ method: "GET", path: "/api/nothing", routes })).toBeNull();
  });

  it("accepts ALL/ANY routes for any method", () => {
    const all = [{ uid: "health", method: "ALL", path: "/health" }];
    expect(matchApiCall({ method: "GET", path: "/health", routes: all })).toBe("health");
    expect(matchApiCall({ method: "PUT", path: "/health", routes: all })).toBe("health");
  });

  it("strips scheme and host", () => {
    expect(matchApiCall({ method: "GET", path: "http://localhost:4000/api/orders", routes })).toBe("orders");
  });

  it("matches when the call omits a base path, but only if exactly one route ends that way", () => {
    // axios.create({ baseURL: "/api" }); api.get("/orders")
    expect(matchApiCall({ method: "GET", path: "/orders", routes })).toBe("orders");
    // "/users" is a suffix of both GET /api/users and ... only one GET route ends in /users
    expect(matchApiCall({ method: "GET", path: "/users", routes })).toBe("list");
    const ambiguous = [
      { uid: "a", method: "GET", path: "/api/v1/items" },
      { uid: "b", method: "GET", path: "/admin/items" },
    ];
    expect(matchApiCall({ method: "GET", path: "/items", routes: ambiguous })).toBeNull();
  });

  it("matches a call that starts with an unknown base (template placeholder)", () => {
    expect(matchApiCall({ method: "GET", path: "${API_URL}/orders", routes })).toBe("orders");
  });

  it("refuses to match on a bare wildcard", () => {
    expect(matchApiCall({ method: "GET", path: "${API_URL}", routes })).toBeNull();
  });

  it("returns null when two routes are equally good rather than guessing", () => {
    const dup = [
      { uid: "x", method: "GET", path: "/api/things/:a" },
      { uid: "y", method: "GET", path: "/api/things/:b" },
    ];
    expect(matchApiCall({ method: "GET", path: "/api/things/7", routes: dup })).toBeNull();
  });
});
