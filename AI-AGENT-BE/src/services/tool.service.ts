import axios from "axios";
import { ITool, Tools } from "../models/shared.model";

export class ToolService {

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

    create = async (toolData: ITool) => {
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


    // Detect if a tool should be used using LLM
    detectToolUse = async ({ botId, query }: { botId: string; query: string }): Promise<{ tool: string, params: any } | null> => {
        const availableTools = await this.readToolsByBotId({ botId });
        console.log("availableTools============================")
        console.log(availableTools)
        if (availableTools.length === 0) {
            return null;
        }
        const toolsList = availableTools.map(t => ({
            id: t._id,
            name: t.name,
            description: t.description,
            parameters: {
                type: "object",
                properties: t.parameters,
                required: Object.keys(t.parameters).filter(
                    key => t.parameters[key].required
                )
            }
        }));

        const prompt = `Analyze the following user query and determine if it requires using one of the available tools.
                        If yes, respond with a JSON object containing "id" (the tool ID), "tool" (the tool name) and "params" (the parameters for the tool).
                        If no tool is needed, respond with null.
    
                        Available tools:
                        ${JSON.stringify(toolsList, null, 2)}
                        
                        User query: "${query}"
                        
                        Respond ONLY with valid JSON (either null or a tool object):`;
        try {
            const res = await axios.post("http://localhost:11434/api/generate", {
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
            let url: string = tool.endpoint ?? "";
            if (!url) throw new Error("Tool endpoint is missing");

            // Collect path variables in order
            const pathVars: string[] = [];
            const queryPairs: string[] = [];

            for (const [key, defRaw] of Object.entries(tool.parameters)) {
                const def = defRaw as { default?: any; required?: boolean; in?: string; mapTo?: string };
                const value = args[key] ?? def.default;
                if (value === undefined) {
                    if (def.required) throw new Error(`Missing required param: ${key}`);
                    continue;
                }
                if (def.in === "path") {
                    pathVars.push(encodeURIComponent(value));
                } else if (def.in === "query") {
                    const qpKey = def.mapTo || key;
                    queryPairs.push(`${encodeURIComponent(qpKey)}=${encodeURIComponent(value)}`);
                }
            }

            // Append path variables to the endpoint
            if (pathVars.length > 0) {
                url = url.replace(/\/$/, ""); // Remove trailing slash if any
                url += "/" + pathVars.join("/");
            }

            // Append query parameters to the endpoint
            if (queryPairs.length > 0) {
                url += (url.includes("?") ? "&" : "?") + queryPairs.join("&");
            }

            const res = await axios({
                method: tool.method || "GET",
                url,
                headers: tool.headers
            });

            return res.data;
        }

        return { error: "Unsupported tool type" };
    };

}