
import mongoose from "mongoose";

const Roles = ["USER", "CONFIG_ADMIN"] as const;

// One issued refresh token. Stored as a SHA-256 hash so a read of the users
// collection never yields a usable session. Embedded in the user document, so
// there is no TTL index available: expired entries are pruned on every login
// and refresh (see TokenService.prune).
const refreshTokenSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    userAgent: { type: String, default: "" },
    ip: { type: String, default: "" },
  },
  { _id: true, timestamps: true },
);

// This model is used to store the user profiles
const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true, select: false },
    isActive: { type: Boolean, default: true },
    roles: { type: [String], enum: Roles, default: ["USER"] },
    // select:false so refresh tokens never leak through unrelated user reads.
    refreshTokens: { type: [refreshTokenSchema], default: [], select: false },
  },
  { timestamps: true },
);
// `unique: true` on the email field already builds that index; declaring it
// again here produced a duplicate-index warning at startup.
userSchema.index({ "refreshTokens.tokenHash": 1 });

// Belt and braces: strip credentials from anything that gets serialised.
const stripSecrets = (_doc: unknown, ret: Record<string, any>) => {
  delete ret.password;
  delete ret.refreshTokens;
  return ret;
};
userSchema.set("toJSON", { transform: stripSecrets });
userSchema.set("toObject", { transform: stripSecrets });

export const botType = ["General_Purpose", "KB_Bot", "Code_Interpreter"]
const botProfileSchema = new mongoose.Schema(
  {
    botId: { type: String },
    botName: { type: String, required: true },
    botDesc: { type: String, trim: true },
    botType: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    baseModel: {}, // answer model
    embedModel: {}, // embed model
    toolModel: {}, // tool model
    instruction: { type: String, trim: true }, // instruction for the bot
    kbsearchMethod: { type: String, default: "semantic", trim: true }, // knowledge base search method semantic or hybrid deffault = semantic
    vectorTable: { type: String }, // vector table name for the bot (KB bots only)
    // Code_Interpreter bots only. Written once at creation from the probed
    // embedding model; every code query reads the dimension from here, and it
    // is validated before it is ever interpolated into SQL.
    codeConfig: {
      embedModel: { type: String },
      embedDim: { type: Number },
      embedType: { type: String, enum: ["vector", "halfvec"] },
    },
    publicAccess: { type: Boolean, default: false }, // if true then anyone can access the bot
    owner: {},
    botUsers: {
      users: [], // email addresses of users who can access the bot default user will be the owner
      totalUsersCount: { type: Number, default: 0 },
    },
    stats: {
      kbDocCount: Number,
      kbDocSize: Number,
      kbVectorCount: Number,
      chatMsgCount: Number,           // message count in 30 days
    },
  },
  { timestamps: true },
);
botProfileSchema.index({ botName: 1 });
botProfileSchema.index({ owner: 1 });
botProfileSchema.index({ isActive: 1 });

// This model is used to store the knowledge base entries for each bot
const knowledgeBaseSchema = new mongoose.Schema(
  {
    botId: { type: String, required: true }, // Reference to the bot this knowledge base belongs to
    fileName: { type: String, required: true, trim: true },
    fileSize: { type: Number, required: true },
    content: { type: String, required: true },
    source: { type: String, required: true, trim: true },
    fileHash: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true },
    downloadUrl: { type: String, required: true },
    chunksTotal: { type: Number, required: true },
    // "upload" (default) covers both the manual single-file and zip paths.
    // "google_drive" entries additionally carry connectionId/externalId/
    // externalChecksum so a re-sync can tell which Drive file a row came
    // from and whether its content has changed.
    sourceType: { type: String, enum: ["upload", "google_drive"], default: "upload" },
    connectionId: { type: String },
    externalId: { type: String },
    externalChecksum: { type: String },
  },
  { timestamps: true },
);
knowledgeBaseSchema.index({ botId: 1 });
knowledgeBaseSchema.index({ fileName: 1 });
knowledgeBaseSchema.index({ connectionId: 1, externalId: 1 });

// A per-bot connection to an external knowledge source. Google Drive is the
// only provider today; `provider` is a string (not hard-coded to one value)
// so a second provider doesn't need a schema migration.
const knowledgeConnectionSchema = new mongoose.Schema(
  {
    botId: { type: String, required: true },
    provider: { type: String, enum: ["google_drive"], required: true },
    status: {
      type: String,
      enum: ["pending", "connected", "error", "disconnected"],
      default: "pending",
    },
    accountEmail: { type: String, trim: true }, // the connected Google account, for display
    folderIds: { type: [String], default: [] }, // Drive folders to sync; set after consent
    // select:false for the same reason user.refreshTokens is: a read of this
    // collection must never leak a usable credential.
    refreshTokenEncrypted: { type: String, select: false },
    // Only populated while status="pending" — binds the OAuth callback back
    // to the connection that started it (CSRF defense; the callback route
    // is public and carries no bearer token).
    stateToken: { type: String, select: false },
    stateExpiresAt: { type: Date, select: false },
    lastSyncAt: { type: Date },
    lastSyncStatus: { type: String, enum: ["success", "partial", "failed", null], default: null },
    lastSyncSummary: {
      filesCreated: Number,
      filesUpdated: Number,
      filesDeleted: Number,
      filesSkipped: Number,
      filesFailed: Number,
    },
    createdBy: { type: String, trim: true }, // actor email
  },
  { timestamps: true },
);
knowledgeConnectionSchema.index({ botId: 1 });

// One row per sync run. "running" status doubles as the concurrency guard —
// triggerSync refuses to start a new run while one already has this status,
// so there is a single source of truth instead of a separate boolean flag
// that could drift out of sync with reality.
const knowledgeSyncLogSchema = new mongoose.Schema(
  {
    connectionId: { type: String, required: true },
    botId: { type: String, required: true },
    status: { type: String, enum: ["running", "completed", "failed"], default: "running" },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date },
    triggeredBy: { type: String, trim: true }, // actor email
    summary: {
      filesTotal: { type: Number, default: 0 },
      filesCreated: { type: Number, default: 0 },
      filesUpdated: { type: Number, default: 0 },
      filesDeleted: { type: Number, default: 0 },
      filesSkipped: { type: Number, default: 0 },
      filesFailed: { type: Number, default: 0 },
    },
    fileResults: [
      {
        externalId: { type: String },
        fileName: { type: String },
        action: { type: String, enum: ["created", "updated", "deleted", "skipped", "failed"] },
        reason: { type: String },
      },
    ],
    error: { type: String }, // top-level failure, e.g. "token revoked" — listing itself failed
  },
  { timestamps: true },
);
knowledgeSyncLogSchema.index({ connectionId: 1, createdAt: -1 });



// One row per indexing run of a Code_Interpreter bot. Same "status is the
// guard" idea as KnowledgeSyncLog, but enforced by a partial unique index so
// two simultaneous requests cannot both create a "running" run (the
// find-then-create used for Drive syncs has that race).
const codeIndexRunSchema = new mongoose.Schema(
  {
    botId: { type: String, required: true },
    repoName: { type: String },
    mode: { type: String, enum: ["full", "incremental"], default: "full" },
    status: { type: String, enum: ["running", "completed", "partial", "failed"], default: "running" },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date },
    triggeredBy: { type: String, trim: true }, // actor email
    // files, skipped, units, edges, embedded, summarized, embedCalls, llmCalls, phaseMs
    stats: { type: mongoose.Schema.Types.Mixed, default: {} },
    fileErrors: [{ path: { type: String }, reason: { type: String } }],
    error: { type: String },
  },
  { timestamps: true },
);
codeIndexRunSchema.index({ botId: 1, createdAt: -1 });
codeIndexRunSchema.index(
  { botId: 1 },
  { unique: true, partialFilterExpression: { status: "running" }, name: "one_running_run_per_bot" },
);

const ToolSchema = new mongoose.Schema({
  botId: { type: String, required: true },
  name: { type: String, required: true, },
  description: { type: String, required: true },
  category: { type: String },
  parameters: {
    type: { type: String, default: 'object' },
    properties: {},
    required: [String]
  },
  type: { type: String, enum: ["API", "DATABASE"], required: true },
  endpoint: { type: String },
  method: { type: String, enum: ["GET", "POST", "PUT", "DELETE", "PATCH"], default: "GET", }, headers: { type: Object },
  auth: {
    type: { type: String, enum: ["basic", "bearer", "apiKey", "none"], default: "none" },
    username: { type: String },  // used if basic
    password: { type: String },  // used if basic
    apiKey: { type: String },    // used if apiKey
    apiKeyLocation: {
      type: String,
      enum: ["header", "query"], // where to put apiKey
      default: "header"
    },
    fixedParams: { type: Object }, // for any fixed params that should always be sent with the tool request
    apiKeyName: { type: String }, // e.g., "x-api-key" or "Authorization"
  },

  pathVariable: [{
    name: { type: String },
    description: { type: String, },
    type: { type: String, enum: ["string", "number", "integer", "boolean"], default: "string" },
    required: { type: Boolean, default: true, },
  }],

  queryParam: [{
    name: { type: String, },
    description: { type: String },
    type: { type: String, enum: ["string", "number", "integer", "boolean", "array"], default: "string" },
    required: { type: Boolean, default: false },
    defaultValue: { type: mongoose.Schema.Types.Mixed, },
  }],
  requestBody: {
    contentType: {
      type: String,
      enum: [
        "application/json",
        "application/x-www-form-urlencoded",
        "multipart/form-data",
      ],
      default: "application/json",
    },
    schema: {
      type: mongoose.Schema.Types.Mixed, // JSON Schema
      required: false,
    },
    example: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },
  },
  enabled: { type: Boolean, default: true },
  systemPrompt: { type: String }
}, {
  timestamps: true,
});

const LlmModelSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true }, // "gpt-4.1" | "llama-3"
    provider: { type: String, required: true },           // "openai" | "ollama" | "anthropic"
    endpoint: { type: String, trim: true, required: false },                            // API endpoint
    isActive: { type: Boolean, default: true },
    description: { type: String, trim: true },            // shown in the deployed-models UI
    tags: { type: [String], default: [] },                // free-form labels for filtering (e.g. "fast", "reasoning", "local")
    meta: {
      contextWindow: { type: String, required: true, trim: true },
      maxOutputTokens: { type: Number, required: false }, // generation cap — distinct from contextWindow
      modelType: { type: String, enum: ["chat", "embedding", "code"], required: true, }, // chat | embedding | code
      inputPrice: { type: Number, required: false },
      outputPrice: { type: Number, required: false },
      inputType: { type: String, enum: ["text", "image", "text|image"], required: true },          // "text" | "image" | "text||image"
      supportsTools: { type: Boolean, default: false },     // can this model be used as TOOL_MODEL (function calling)?
      supportsStreaming: { type: Boolean, default: false }, // does the deployment support streamed responses?
    },
  },
  { timestamps: true }
);
// `unique: true` on the name field already builds this index.
LlmModelSchema.index({ provider: 1 });
LlmModelSchema.index({ isActive: 1 });


// Persisted login-attempt counters, keyed by "email|ip". Backs AuthService's
// throttle so a restart or a second instance doesn't reset a lockout — a
// plain in-process Map only protects a single, continuously-running process.
// The TTL index drops the document itself once its window has passed, so
// there is nothing to prune manually.
const loginAttemptSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    count: { type: Number, default: 0 },
    resetAt: { type: Date, required: true },
  },
  { timestamps: true },
);
loginAttemptSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

export const user = mongoose.model("user", userSchema);
export const botProfile = mongoose.model("botProfile", botProfileSchema);
export const KnowledgeBase = mongoose.model("KnowledgeBase", knowledgeBaseSchema);
export const KnowledgeConnection = mongoose.model("KnowledgeConnection", knowledgeConnectionSchema);
export const KnowledgeSyncLog = mongoose.model("KnowledgeSyncLog", knowledgeSyncLogSchema);
export const CodeIndexRun = mongoose.model("CodeIndexRun", codeIndexRunSchema);
export const Tools = mongoose.model("Tools", ToolSchema);
export const llmModel = mongoose.model("llmModel", LlmModelSchema);
export const LoginAttempt = mongoose.model("LoginAttempt", loginAttemptSchema);
