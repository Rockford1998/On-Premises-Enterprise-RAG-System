import axios from "axios";
import { ITool, Tools } from "../models/shared.model";

export class ToolService {
    OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

    readToolsByBotId = async ({ botId }: { botId: string }) => {
        const tools = await Tools.find({ botId });
        return tools;
    }

    readToolById = async ({ id }: { id: string }) => {
        const tool = await Tools.findById(id);
        return tool;
    }

    readEnabledToolById = async ({ id }: { id: string }) => {
        const tool = await Tools.findById({ _id: id, enabled: true });
        return tool;
    }

    create = async (toolData: any) => {
        const tool = new Tools(toolData);
        await tool.save();
        return tool;
    }

    update = async ({ id, toolData }: { id: string, toolData: Partial<ITool> }) => {
        const tool = await Tools.findByIdAndUpdate(id, toolData, { new: true });
        return tool;
    }

    delete = async ({ id }: { id: string }) => {
        await Tools.findByIdAndDelete(id);
    }

    // Helper method to construct parameters object from schema
    private constructParametersFromSchema(tool: ITool) {
        const parameters: Record<string, any> = {};

        // Add path variable if exists
        if (tool.pathVariable?.[0]?.name) {
            const pathVar = tool.pathVariable[0];
            parameters[pathVar.name] = {
                type: pathVar.type,
                description: pathVar.description,
                required: pathVar.required,
                in: "path"
            };
        }

        // Add query parameter if exists
        if (tool.queryParam?.[0]?.name) {
            const queryParam = tool.queryParam[0];
            parameters[queryParam.name] = {
                type: queryParam.type,
                description: queryParam.description,
                required: queryParam.required,
                default: queryParam.defaultValue,
                in: "query"
            };
        }

        // Add request body schema if exists
        if (tool.requestBody?.schema) {
            // For request body, we'll create a special parameter
            parameters["requestBody"] = {
                type: "object",
                description: "Request body data",
                required: true,
                in: "body",
                schema: tool.requestBody.schema,
                contentType: tool.requestBody.contentType
            };
        }

        return parameters;
    }

    // Detect if a tool should be used using LLM
    detectToolUse = async ({ botId, query }: { botId: string; query: string }): Promise<{ tool: string, params: any, systemPrompt?: string } | null> => {
        const availableTools = await this.readToolsByBotId({ botId });

        if (availableTools.length === 0) {
            return null;
        }

        // Construct tool list with proper parameters
        const toolsList = availableTools.map((t: any) => {
            const parameters = this.constructParametersFromSchema(t);

            return {
                id: t._id,
                name: t.name,
                description: t.description,
                type: t.type,
                parameters: {
                    type: "object",
                    properties: parameters,
                    required: Object.keys(parameters).filter(
                        key => parameters[key]?.required
                    )
                }
            };
        });

        const prompt = `Analyze the following user query and determine if it requires using one of the available tools.
                        If yes, respond with a JSON object containing "id" (the tool ID), "tool" (the tool name) and "params" (the parameters for the tool).
                        If no tool is needed, respond with null.

                        Available tools:
                        ${JSON.stringify(toolsList, null, 2)}
                        
                        User query: "${query}"
                        
                        Respond ONLY with valid JSON (either null or a tool object):`;

        try {
            const res = await axios.post(`${this.OLLAMA_BASE_URL}/api/generate`, {
                model: process.env.TOOL_MODEL || "llama3.2:latest",
                prompt,
                format: "json",
                stream: false,
            });

            const responseText = res.data?.response?.trim();
            if (!responseText) return null;

            const result = JSON.parse(responseText);

            if (result && result.tool) {
                const toolData = availableTools.find(tool => tool.name === result.tool);
                if (toolData) {
                    result.systemPrompt = toolData.systemPrompt;
                    return result;
                }
            }

            return null;
        } catch (error) {
            console.error("Tool detection failed:", error);
            return null;
        }
    };

    toolExecution = async ({ toolId, args }: { toolId: string, args: any }) => {
        const tool = await this.readEnabledToolById({ id: toolId });
        if (!tool) throw new Error("Tool not found");

        if (tool.type === "http") {
            let url = tool.endpoint ?? "";
            if (!url) throw new Error("Tool endpoint is missing");

            const method = tool.httpMethod || "GET";
            const headers: Record<string, any> = { ...(tool.headers || {}) };

            // Prepare body data for POST/PUT/PATCH requests
            let requestBody: any = null;

            // Collect path variables, query params, and request body
            const pathVariables: string[] = [];
            const queryPairs: string[] = [];

            // Handle path variable
            if (tool.pathVariable?.[0]?.name && args[tool.pathVariable[0].name] !== undefined) {
                const pathValue = args[tool.pathVariable[0].name];
                pathVariables.push(encodeURIComponent(pathValue));
            }

            // Handle query parameter
            if (tool.queryParam?.[0]?.name && args[tool.queryParam[0].name] !== undefined) {
                const queryValue = args[tool.queryParam[0].name];
                const paramName = encodeURIComponent(tool.queryParam[0].name);
                queryPairs.push(`${paramName}=${encodeURIComponent(queryValue)}`);
            }

            // Handle request body
            if (tool.requestBody?.schema && (method === "POST" || method === "PUT" || method === "PATCH")) {
                if (tool.requestBody.contentType === "application/json") {
                    requestBody = args.requestBody || args;
                    headers["Content-Type"] = "application/json";
                } else if (tool.requestBody.contentType === "application/x-www-form-urlencoded") {
                    requestBody = new URLSearchParams();
                    if (args.requestBody && typeof args.requestBody === "object") {
                        Object.entries(args.requestBody).forEach(([key, value]) => {
                            requestBody.append(key, String(value));
                        });
                    }
                    headers["Content-Type"] = "application/x-www-form-urlencoded";
                }
                // Note: multipart/form-data would require FormData and different handling
            }

            // Append path variables to the endpoint
            if (pathVariables.length > 0) {
                url = url.replace(/\/$/, "");
                url += "/" + pathVariables.join("/");
            }

            // Append query parameters to the endpoint
            if (queryPairs.length > 0) {
                url += (url.includes("?") ? "&" : "?") + queryPairs.join("&");
            }

            // Handle authentication
            if (tool.auth && tool.auth.type && tool.auth.type !== "none") {
                if (tool.auth.type === "basic" && tool.auth.username && tool.auth.password) {
                    const basicToken = Buffer.from(`${tool.auth.username}:${tool.auth.password}`).toString("base64");
                    headers["Authorization"] = `Basic ${basicToken}`;
                } else if (tool.auth.type === "bearer" && tool.auth.apiKey) {
                    headers["Authorization"] = `Bearer ${tool.auth.apiKey}`;
                } else if (tool.auth.type === "apiKey" && tool.auth.apiKey && tool.auth.apiKeyName) {
                    if (tool.auth.apiKeyLocation === "query") {
                        // Add API key to query string
                        url += (url.includes("?") ? "&" : "?") +
                            `${encodeURIComponent(tool.auth.apiKeyName)}=${encodeURIComponent(tool.auth.apiKey)}`;
                    } else {
                        // Default to header
                        headers[tool.auth.apiKeyName] = tool.auth.apiKey;
                    }
                }
            }

            try {
                const config: any = {
                    method,
                    url,
                    headers
                };

                // Add request body if present
                if (requestBody) {
                    config.data = requestBody;
                }

                const res = await axios(config);
                return res.data;
            } catch (err: any) {
                return { error: err?.response?.data || err.message || "Tool execution failed" };
            }
        }

        // Future: handle database tool type
        if (tool.type === "database") {
            // Database tool implementation would go here
            return { error: "Database tools not yet implemented" };
        }

        return { error: "Unsupported tool type" };
    };
}