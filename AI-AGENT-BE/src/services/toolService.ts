////////////////////////////////////////////////////////////////// Test phase
import axios from "axios";

type Tool = {
    name: string;
    description: string;
    parameters: Record<string, any>;
    execute: (params: any) => Promise<string>;
};

const availableTools: Record<string, Tool> = {
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


// Execute a detected tool
export const executeTool = async (toolName: string, params: any): Promise<string> => {
    const tool = availableTools[toolName];
    if (!tool) {
        throw new Error(`Tool ${toolName} not found`);
    }
    return await tool.execute(params);
};