
import mongoose, { Schema } from "mongoose";

const Roles = ["USER", "CONFIG_ADMIN"] as const;
// This model is used to store the user profiles
const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    roles: { type: [String], enum: Roles, default: ["USER"] }
  },
  { timestamps: true },
);
userSchema.index({ email: 1 });

export const botType = ["General_Purpose", "KB_Bot"]
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
    vectorTable: { type: String }, // vector table name for the bot
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
  },
  { timestamps: true },
);
knowledgeBaseSchema.index({ botId: 1 });
knowledgeBaseSchema.index({ fileName: 1 });



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
  type: { type: String, enum: ["API", "database"], required: true },
  endpoint: { type: String },
  method: { type: String },
  headers: { type: Object },
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
    meta: {
      contextWindow: { type: String, required: true, trim: true },
      modelType: { type: String, enum: ["chat", "embedding", "code"], required: true, }, // chat | embedding | code
      inputPrice: { type: Number, required: false },
      outputPrice: { type: Number, required: false },
      inputType: { type: String, enum: ["text", "image", "text|image"], required: true }          // "text" | "image" | "text||image"
    },
  },
  { timestamps: true }
);
LlmModelSchema.index({ name: 1 }, { unique: true });
LlmModelSchema.index({ provider: 1 });
LlmModelSchema.index({ isActive: 1 });


export const user = mongoose.model("user", userSchema);
export const botProfile = mongoose.model("botProfile", botProfileSchema);
export const KnowledgeBase = mongoose.model("KnowledgeBase", knowledgeBaseSchema);
export const Tools = mongoose.model("Tools", ToolSchema);
export const llmModel = mongoose.model("llmModel", LlmModelSchema);
