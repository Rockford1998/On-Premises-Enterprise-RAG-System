import mongoose from "mongoose";

const pathVariableSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    type: {
        type: String,
        enum: ["string", "number", "integer", "boolean"],
        default: "string",
    },
    required: {
        type: Boolean,
        default: true,
    },
});

const queryParamSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    type: {
        type: String,
        enum: ["string", "number", "integer", "boolean", "array"],
        default: "string",
    },
    required: {
        type: Boolean,
        default: false,
    },
    defaultValue: {
        type: mongoose.Schema.Types.Mixed,
    },
});

const requestBodySchema = new mongoose.Schema({
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
});


const toolSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true, },
    description: { type: String, required: true, },
    endpoint: { type: String, required: true, },
    method: { type: String, enum: ["GET", "POST", "PUT", "DELETE", "PATCH"], default: "GET", },
    pathVariables: [pathVariableSchema],
    queryParams: [queryParamSchema],
    requestBody: requestBodySchema,
    headers: {
        type: Map, of: String, default: { "Content-Type": "application/json" },
    },
    auth: {
        type: {
            type: String,
            enum: ["none", "api_key", "bearer_token", "basic_auth", "oauth2"],
            default: "none",
        },
        apiKeyHeader: {
            type: String,
            default: "X-API-Key",
        },
        apiKeyValue: {
            type: String,
            select: false, // Don't return in queries
        },
        token: {
            type: String,
            select: false,
        },
        username: {
            type: String,
            select: false,
        },
        password: {
            type: String,
            select: false,
        },
    },
    responseMapping: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },
    isActive: { type: Boolean, default: true, },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
});


// Indexes
toolSchema.index({ isActive: 1 });
toolSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Tool", toolSchema);
