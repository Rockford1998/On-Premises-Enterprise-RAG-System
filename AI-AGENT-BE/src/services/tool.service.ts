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
        const toolsList = Object.values(availableTools).map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
        }));

    
        const prompt = `Analyze the following user query and determine if it requires using one of the available tools.
    If yes, respond with a JSON object containing "tool" (the tool name) and "params" (the parameters for the tool).
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
            if (result && result.tool && availableTools[result.tool]) {
                return result;
            }
            return null;
        } catch (error) {
            console.error("Tool detection failed:", error);
            return null;
        }
    };

}