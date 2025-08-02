////////////////////////////////////////////////////////////////// Test phase
import axios from "axios";

type Tool = {
    name: string;
    description: string;
    parameters: Record<string, any>;
    execute: (params: any) => Promise<string>;
};

// Define your available tools
const availableTools: Record<string, Tool> = {
    // Add more tools as needed:
    weather: {
        name: "weather",
        description: "Gets weather information for a location",
        parameters: {
            type: "object",
            properties: {
                location: {
                    type: "string",
                    description: "The city and state/country(e.g., 'New York, US')"
                }
            },
            required: ["location"]
        },
        execute: async ({ location }) => {
            // In production, call a real weather API
            return `The weather in ${location} is 72°F and sunny (mock response)`;
        }
    }
};

// Detect if a tool should be used using LLM
export const detectToolUse = async (query: string): Promise<{ tool: string, params: any } | null> => {
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

// Execute a detected tool
export const executeTool = async (toolName: string, params: any): Promise<string> => {
    const tool = availableTools[toolName];
    if (!tool) {
        throw new Error(`Tool ${toolName} not found`);
    }
    return await tool.execute(params);
};