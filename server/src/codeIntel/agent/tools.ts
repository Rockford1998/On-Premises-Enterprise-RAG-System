/**
 * The tools the agent loop may call, as JSON schemas.
 *
 * They are deliberately the same operations the HTTP tool endpoints expose, so
 * what the model can do and what a developer can try by hand never drift apart.
 */

export type ToolName =
  | "search_code" | "find_symbol" | "get_unit" | "read_file"
  | "get_callers" | "get_callees" | "list_routes" | "trace_feature" | "get_summary";

export type ToolSchema = {
  name: ToolName;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
};

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: "search_code",
    description: "Search the indexed code for anything relevant to a question or phrase. Start here when you do not know which file to look in.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "A question or search phrase." },
        kind: { type: "string", description: "Optional filter: function, method, class, component, hook, route, interface, type or file." },
        path_prefix: { type: "string", description: "Optional filter: only return units whose path starts with this." },
        limit: { type: "integer", description: "Maximum results (default 12)." },
      },
      required: ["query"],
    },
  },
  {
    name: "find_symbol",
    description: "Find a function, class, component or method by name when you already know what it is called.",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "get_unit",
    description: "Fetch the full source of one code unit by its id, as returned by search_code or find_symbol.",
    parameters: { type: "object", properties: { uid: { type: "string" } }, required: ["uid"] },
  },
  {
    name: "read_file",
    description: "Read a slice of an indexed file. Use it to see code around a unit, such as imports at the top of the file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repository-relative path." },
        repo: { type: "string", description: "Repository name, when several are indexed." },
        start_line: { type: "integer" },
        end_line: { type: "integer" },
      },
      required: ["path"],
    },
  },
  {
    name: "get_callers",
    description: "What calls, imports or renders this unit. Use it to judge the impact of changing something.",
    parameters: { type: "object", properties: { uid: { type: "string" } }, required: ["uid"] },
  },
  {
    name: "get_callees",
    description: "What this unit calls, imports or renders. Use it to follow what happens next.",
    parameters: { type: "object", properties: { uid: { type: "string" } }, required: ["uid"] },
  },
  {
    name: "list_routes",
    description: "List the backend HTTP endpoints and the handler behind each one.",
    parameters: {
      type: "object",
      properties: {
        method: { type: "string", description: "Optional: GET, POST, …" },
        path_contains: { type: "string", description: "Optional: only routes whose path contains this." },
      },
    },
  },
  {
    name: "trace_feature",
    description: "Follow one unit all the way through: page → hook → API call → route → handler → service. Best for 'what happens when…' questions.",
    parameters: { type: "object", properties: { uid: { type: "string" } }, required: ["uid"] },
  },
  {
    name: "get_summary",
    description: "The stored summary of a file or folder, when summaries were generated at index time.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
];

export const TOOL_NAMES = new Set<string>(TOOL_SCHEMAS.map((t) => t.name));

/** Ollama's /api/chat tool format. */
export const toOllamaTools = () => TOOL_SCHEMAS.map((tool) => ({ type: "function", function: tool }));

/** The prompt-only fallback, for models that cannot do native tool calling. */
export const toolInstructions = (): string =>
  `You can inspect the codebase with these tools:
${TOOL_SCHEMAS.map((t) => `- ${t.name}(${Object.keys(t.parameters.properties).join(", ")}): ${t.description}`).join("\n")}

To use one, reply with only this JSON and nothing else:
{"tool": "<name>", "arguments": { … }}

When you have enough information, reply with the final answer as Markdown text (no JSON), citing path:startLine-endLine for every claim.`;
