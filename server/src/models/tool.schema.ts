import mongoose from "mongoose";

const ToolSchema = new mongoose.Schema({
    botId: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    name: { type: String, required: true, },
    description: { type: String, required: true },
    Parameters: {
        type: { type: String, default: "object" },
        properties: {},
        required: [String]
    },
    toolExe: {
        type: { type: String, enum: ["http", "database"], required: true },
        method: { type: String, enum: ["GET", "POST", "PUT", "DELETE", "PATCH"], default: "GET", }, headers: { type: Object },
        url: { type: String },
        auth: {
            type: { type: String, enum: ["basic", "bearer", "none"], default: "none" },
            basicUser: { type: String },  // used if basic
            basicPass: { type: String },  // used if basic
            bearerToken: { type: String },
            fixedParams: {}, // may be api keys
            fixedParamsStr: String,
            apiHeaders: {},
            apiHeadersStr: String
        },
    },
}, {
    timestamps: true,
});