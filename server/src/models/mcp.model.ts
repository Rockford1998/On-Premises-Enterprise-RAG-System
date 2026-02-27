import mongoose, { Schema } from "mongoose";
import { uniqueDocID } from "../services/UniqueDocIDGenerator";
import { ObjectId } from "typeorm";

// McpServerProfile is registered a MCP Server in MCP marketplace, then used by any Bot.
const McpServerProfileSchema = new mongoose.Schema({
    docType: { type: String, default: 'McpServerProfile' },                // McpServerProfile
    mcpType: String,                        // MCP Type: Built-in - Bot tool as MCP, Internal - Developed by Atlas Copco Team, External - Developed by 3rd party.
    mcpId: {                                // MCP Server ID, MCP-XXXXXXXX
        type: String,
        default: function () {
            return uniqueDocID({ docType: 'MCP' })
        }
    },
    name: String,                           // MCP Server Name
    description: String,                    // MCP Server Description
    url: String,                            // MCP Server URL, example: https://mcp.example.com/mcp
    enabled: { type: Boolean }, // if true, will load this server for bot
    createdBy: String,                       // User who created the MCP server

    tools: [{
        type: { type: String },             // Type of MCP tool: BotTool / Bot.
        botId: String,                      // Bot namespace
        name: String,                       // Tool name
        title: String,                      // Tool title for UI
        description: String,                // Tool description
        inputSchema: {},                    // Input schema for tool execution in JSON Schema format (MCP Standard)
        enabled: { type: Boolean, default: true },
        parentBot: {},                      // From which Bot
    }],

    // Prompts: only load "ai-brains-mcp-instructions" prompt for MCP server now.
    prompts: [{
        name: String,                       // Prompt name
        title: String,                      // Prompt title for UI
        description: String,                // Prompt description
    }],

}, { timestamps: true })

//
const McpToolProfileSchema = new mongoose.Schema({
    docType: { type: String, default: 'McpToolProfile' },                // McpToolProfile
    namespace: String,              // Host BotID
    enabled: { type: Boolean, default: true },          // if true, will load this tool for bot

    mcpServer: {
        _id: ObjectId,              // MCP Server Profile ID
        mcpId: String,              // MCP Server ID, MCP-XXXXXXXX
        mcpType: String,           // MCP Type: Built-in - Bot tool as MCP, Internal - Developed by Atlas Copco Team, External - Developed by 3rd party.
        name: String,               // MCP Server Nabme
        title: String,              // MCP Server Title
        description: String,        // MCP Server Description
        url: String,                // MCP Server URL for remote MCP
        tools: [{}],                 // MCP tools
    }
}, { timestamps: true });
McpToolProfileSchema.index({ namespace: 1 })


export const McpServerProfile = mongoose.model("McpServerProfile", McpServerProfileSchema);
export const McpToolProfile = mongoose.model("llmModel", McpToolProfileSchema);
// create and call the mcp server
// function to sync the mcp tools
// execution of the mcp tools
