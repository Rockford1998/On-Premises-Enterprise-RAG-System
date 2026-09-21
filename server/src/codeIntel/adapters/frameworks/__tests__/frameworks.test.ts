import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { FileRecord, FrameworkAdapter, ParseResult, RepoContext } from "../../../core/types";
import { disposeParsers, disposeTree } from "../../../parse/treesitter";
import { typescriptAdapter } from "../../languages/typescript";
import { expressAdapter, recordMounts, resetMounts } from "../express";
import { nestjsAdapter } from "../nestjs";
import { reactAdapter } from "../react";

jest.setTimeout(60_000);

const FIXTURE = path.resolve(__dirname, "../../../../../test-fixtures/sample-mern");
const readFixture = (rel: string) => fs.readFileSync(path.join(FIXTURE, rel), "utf8");

const pkg = (deps: Record<string, string>): RepoContext => ({
  name: "shop",
  manifests: { "package.json": { dependencies: deps } },
  pathAliases: { "@/*": ["src/*"] },
});

const record = (filePath: string, content: string): FileRecord => ({
  path: filePath,
  language: "typescript",
  category: "source",
  content,
  contentHash: crypto.createHash("sha256").update(content).digest("hex"),
  lineCount: content.split("\n").length,
});

/** Parse then enrich, the way the pipeline does, and always release the tree. */
const enrich = async (
  adapter: FrameworkAdapter,
  files: { path: string; content: string }[],
  repo: RepoContext,
  target = files[0].path,
): Promise<ParseResult> => {
  const known = new Set(files.map((f) => f.path));
  const parsed = new Map<string, ParseResult>();
  resetMounts();
  try {
    for (const file of files) {
      const result = await typescriptAdapter.parse({ file: record(file.path, file.content), repo });
      parsed.set(file.path, result);
      if (adapter === expressAdapter) {
        recordMounts({
          file: { path: file.path },
          tree: result.tree,
          resolveImport: (specifier) =>
            typescriptAdapter.resolveImport({ fromPath: file.path, specifier, repo, hasFile: (p) => known.has(p) }),
        });
      }
    }
    const base = parsed.get(target)!;
    const file = files.find((f) => f.path === target)!;
    return await adapter.enrich({ file: record(file.path, file.content), base, tree: base.tree, repo });
  } finally {
    for (const result of parsed.values()) disposeTree(result.tree);
  }
};

const routes = (result: ParseResult) =>
  result.units.filter((u) => u.kind === "route").map((u) => ({
    name: u.qualifiedName,
    method: u.metadata.httpMethod,
    path: u.metadata.routePath,
    lines: [u.startLine, u.endLine],
  }));

const refsFrom = (result: ParseResult, uidEnd: string, type: string) =>
  result.references.filter((r) => r.fromUid.endsWith(uidEnd) && r.type === type)
    .map((r) => (r.target.kind === "symbol" ? r.target.name : r.target.kind === "api" ? `${r.target.method} ${r.target.path}` : ""));

afterAll(() => disposeParsers());

describe("express", () => {
  const repo = pkg({ express: "^5.1.0" });

  it("detects itself only when express is a dependency", () => {
    expect(expressAdapter.detect(repo)).toBe(true);
    expect(expressAdapter.detect(pkg({ react: "^19" }))).toBe(false);
  });

  it("resolves the mount prefix declared in another file", async () => {
    const result = await enrich(
      expressAdapter,
      [
        { path: "routes/users.js", content: readFixture("routes/users.js") },
        { path: "server.js", content: readFixture("server.js") },
      ],
      repo,
      "routes/users.js",
    );
    expect(routes(result).map((r) => r.name)).toEqual(["route:GET /api/users", "route:POST /api/users"]);
    expect(refsFrom(result, "#route:GET /api/users", "handles_route")).toEqual(["listUsers"]);
    expect(refsFrom(result, "#route:POST /api/users", "handles_route")).toEqual(["createUser"]);
  });

  it("joins prefix and path, including parameters and a bare '/'", async () => {
    const result = await enrich(
      expressAdapter,
      [
        {
          path: "routes/items.js",
          content: `const router = require("express").Router();
router.get("/", list);
router.get("/:id", getOne);
router.post("/:id/comments", addComment);
module.exports = router;`,
        },
        { path: "app.js", content: `const items = require("./routes/items");\napp.use("/api/items/", items);` },
      ],
      repo,
      "routes/items.js",
    );
    expect(routes(result).map((r) => r.path)).toEqual(["/api/items", "/api/items/:id", "/api/items/:id/comments"]);
  });

  it("indexes routes declared directly on app, with no mount", async () => {
    const result = await enrich(
      expressAdapter,
      [{ path: "server.js", content: `app.get("/health", (req, res) => res.json({ ok: true }));\napp.delete("/v1/items/:id", remove);` }],
      repo,
    );
    expect(routes(result).map((r) => `${r.method} ${r.path}`)).toEqual(["GET /health", "DELETE /v1/items/:id"]);
  });

  it("records middleware and links an inline handler's own calls to the route", async () => {
    const result = await enrich(
      expressAdapter,
      [{ path: "server.js", content: `app.post("/upload", requireAuth, validate, (req, res) => { saveUpload(req.body); res.end(); });` }],
      repo,
    );
    const route = result.units.find((u) => u.kind === "route")!;
    expect(route.metadata.middleware).toEqual(["requireAuth", "validate"]);
    expect(route.metadata.inlineHandler).toBe(true);
    expect(refsFrom(result, "#route:POST /upload", "calls")).toEqual(expect.arrayContaining(["saveUpload", "requireAuth", "validate"]));
  });

  it("does not mistake an HTTP client call for a route", async () => {
    const result = await enrich(
      expressAdapter,
      [{ path: "src/client.js", content: `axios.get("/api/users");\nhttp.post("/x", body);\nthis.service.get("/y");` }],
      repo,
    );
    expect(result.units.filter((u) => u.kind === "route")).toEqual([]);
  });

  it("ignores app.use calls that are not mounts", async () => {
    const result = await enrich(
      expressAdapter,
      [{ path: "server.js", content: `app.use(express.json());\napp.use(cors());\napp.get("/ok", h);` }],
      repo,
    );
    expect(routes(result).map((r) => r.path)).toEqual(["/ok"]);
  });
});

describe("react", () => {
  const repo = pkg({ react: "^19.0.0", axios: "^1.9.0" });

  it("detects itself only when react is a dependency", () => {
    expect(reactAdapter.detect(repo)).toBe(true);
    expect(reactAdapter.detect(pkg({ express: "^5" }))).toBe(false);
  });

  it("re-classifies components and hooks, and leaves plain functions alone", async () => {
    const result = await enrich(
      reactAdapter,
      [{
        path: "src/x.tsx",
        content: `export function UserCard({ name }: UserCardProps) { return <p>{name}</p>; }
export function useUsers() { const [u] = useState([]); return u; }
export function formatName(a: string) { return a.trim(); }
export function NotAComponent() { return 42; }`,
      }],
      repo,
    );
    expect(Object.fromEntries(result.units.map((u) => [u.name, u.kind]))).toEqual({
      UserCard: "component",
      useUsers: "hook",
      formatName: "function",
      NotAComponent: "function",
    });
    expect(result.units.find((u) => u.name === "UserCard")!.metadata.props).toBe("UserCardProps");
  });

  it("records what a component renders, ignoring HTML tags", async () => {
    const result = await enrich(
      reactAdapter,
      [{ path: "src/p.tsx", content: `export function Page() { return <div><UserCard/><Icons.Star/><span>x</span></div>; }` }],
      repo,
    );
    expect(refsFrom(result, "#Page", "renders")).toEqual(["UserCard", "Icons.Star"]);
  });

  it("records hook usage, attributed to the component that calls it", async () => {
    const result = await enrich(
      reactAdapter,
      [{ path: "src/p.tsx", content: `export function Page() { const { users } = useUsers(); useEffect(() => {}, []); return <div/>; }` }],
      repo,
    );
    expect(refsFrom(result, "#Page", "uses_hook")).toEqual(["useUsers", "useEffect"]);
  });

  it("reads the client route from <Route> and from createBrowserRouter", async () => {
    const jsx = await enrich(
      reactAdapter,
      [{
        path: "src/App.tsx",
        content: `export function App() { return <Routes><Route path="/users" element={<UsersPage/>}/></Routes>; }
export function UsersPage() { return <div/>; }`,
      }],
      repo,
    );
    expect(jsx.units.find((u) => u.name === "UsersPage")!.metadata.clientRoute).toBe("/users");

    const objectForm = await enrich(
      reactAdapter,
      [{
        path: "src/router.tsx",
        content: `const router = createBrowserRouter([{ path: "/settings", element: <SettingsPage/> }]);
export function SettingsPage() { return <div/>; }`,
      }],
      repo,
    );
    expect(objectForm.units.find((u) => u.name === "SettingsPage")!.metadata.clientRoute).toBe("/settings");
  });

  it("extracts API calls from fetch, axios methods, the axios object form and a configured instance", async () => {
    const result = await enrich(
      reactAdapter,
      [{
        path: "src/api.ts",
        content: `const api = axios.create({ baseURL: "/api" });
export function loadAll() { return axios.get("/api/users"); }
export function createOne(body) { return axios.post("/api/users", body); }
export function viaInstance(id) { return api.get("/orders/" + id); }
export function viaObject() { return axios({ url: "/api/stats", method: "put" }); }
export function viaFetch() { return fetch("/api/health", { method: "DELETE" }); }
export function plainFetch() { return fetch("/api/ping"); }`,
      }],
      repo,
    );
    expect(refsFrom(result, "#loadAll", "calls_api")).toEqual(["GET /api/users"]);
    expect(refsFrom(result, "#createOne", "calls_api")).toEqual(["POST /api/users"]);
    // The instance's baseURL is prepended, and the concatenated id becomes a
    // placeholder so the matcher can pair it with GET /api/orders/:id.
    expect(refsFrom(result, "#viaInstance", "calls_api")).toEqual(["GET /api/orders/${}"]);
    expect(refsFrom(result, "#viaObject", "calls_api")).toEqual(["PUT /api/stats"]);
    expect(refsFrom(result, "#viaFetch", "calls_api")).toEqual(["DELETE /api/health"]);
    expect(refsFrom(result, "#plainFetch", "calls_api")).toEqual(["GET /api/ping"]);
  });

  it("keeps a template literal's placeholders so the matcher can treat them as wildcards", async () => {
    const result = await enrich(
      reactAdapter,
      [{ path: "src/api.ts", content: "export function one(id) { return axios.get(`/api/users/${id}`); }" }],
      repo,
    );
    expect(refsFrom(result, "#one", "calls_api")).toEqual(["GET /api/users/${id}"]);
  });

  it("enriches the fixture's page and hook", async () => {
    const page = await enrich(reactAdapter, [{ path: "src/pages/UsersPage.tsx", content: readFixture("src/pages/UsersPage.tsx") }], repo);
    expect(page.units.find((u) => u.name === "UsersPage")!.kind).toBe("component");
    expect(refsFrom(page, "#UsersPage", "renders")).toEqual(["UserCard"]);
    expect(refsFrom(page, "#UsersPage", "uses_hook")).toEqual(["useUsers"]);

    const hook = await enrich(reactAdapter, [{ path: "src/hooks/useUsers.ts", content: readFixture("src/hooks/useUsers.ts") }], repo);
    expect(hook.units.find((u) => u.name === "useUsers")!.kind).toBe("hook");
    expect(refsFrom(hook, "#useUsers", "calls_api")).toEqual(["GET /api/users"]);
  });
});

describe("nestjs", () => {
  const repo = pkg({ "@nestjs/core": "^10" });

  it("detects itself only when nest is a dependency", () => {
    expect(nestjsAdapter.detect(repo)).toBe(true);
    expect(nestjsAdapter.detect(pkg({ express: "^5" }))).toBe(false);
  });

  it("builds routes from the controller prefix and the method decorator", async () => {
    const result = await enrich(
      nestjsAdapter,
      [{
        path: "src/users.controller.ts",
        content: `@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService, private readonly logger: Logger) {}
  @Get()
  findAll() { return this.usersService.findAll(); }
  @Get(":id")
  findOne(@Param("id") id: string) { return this.usersService.findOne(id); }
  @Post()
  create(@Body() body: CreateUserDto) { return this.usersService.create(body); }
  helper() { return 1; }
}`,
      }],
      repo,
    );
    expect(routes(result).map((r) => `${r.method} ${r.path}`)).toEqual(["GET /users", "GET /users/:id", "POST /users"]);
    expect(refsFrom(result, "#route:GET /users/:id", "handles_route")).toEqual(["UsersController.findOne"]);
    const controller = result.units.find((u) => u.name === "UsersController")!;
    expect(controller.metadata.nestRole).toBe("Controller");
    expect(controller.metadata.injects).toEqual(["UsersService", "Logger"]);
    expect(refsFrom(result, "#UsersController", "calls")).toEqual(expect.arrayContaining(["UsersService", "Logger"]));
  });

  it("marks a service's role and ignores classes with no route decorators", async () => {
    const result = await enrich(
      nestjsAdapter,
      [{ path: "src/users.service.ts", content: `@Injectable()\nexport class UsersService {\n  findAll() { return []; }\n}` }],
      repo,
    );
    expect(result.units.filter((u) => u.kind === "route")).toEqual([]);
    expect(result.units.find((u) => u.name === "UsersService")!.metadata.nestRole).toBe("Injectable");
  });
});
