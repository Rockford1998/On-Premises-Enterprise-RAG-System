import axios from "axios";
import { Tools } from "../models/shared.model";
import https from "https";

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

    update = async ({ id, toolData }: { id: string, toolData: any }) => {
        const tool = await Tools.findByIdAndUpdate(id, toolData, { new: true });
        return tool;
    }

    delete = async ({ id }: { id: string }) => {
        await Tools.findByIdAndDelete(id);
    }

    // Detect if a tool should be used using LLM
    detectToolUse = async ({ botId, query }: { botId: string; query: string }): Promise<{ tool: string, params: any } | null> => {
        const availableTools = await this.readToolsByBotId({ botId }) as Array<any>;
        if (availableTools.length === 0) {
            return null;
        }
        const toolsList = availableTools.map(t => ({
            id: t._id,
            name: t.name,
            description: t.description,
            parameters: t.parameters,
        }));

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
                    result.toolData = toolData;
                    return result;
                }
            }

            return null;
        } catch (error) {
            console.error("Tool detection failed:", error);
            return null;
        }
    };

    async getToolAuthHeaders(tool: any): Promise<Record<string, string>> {
        const headers: Record<string, string> = {};
        switch (tool.auth?.type) {
            case "basic":
                headers["Authorization"] = `Basic ${Buffer.from(`${tool.auth.username}:${tool.auth.password}`).toString("base64")}`;
                break;
            case "bearer":
                headers["Authorization"] = `Bearer ${tool.auth.apiKey}`;
                break; ``
            case "apiKey":
                if (tool.auth.apiKeyLocation === "header") {
                    headers[tool.auth.apiKeyName] = tool.auth.apiKey;
                }
                break;
            default:
                break;
        }
        return headers;
    }

    renderTemplateByData(template: any, data: any, isAddRestData: any = true): any {
        // If template is a string, process directly
        if (typeof template === 'string') {
            let result = template;
            // Match all ${...}
            const matches = result.match(/\${([^}]+)}/g) as any;
            if (matches) {
                for (const match of matches) {
                    const path = match.match(/\${([^}]+)}/)[1];
                    let value = data;
                    let found = true;
                    for (const p of path.split('.')) {
                        if (value && value.hasOwnProperty(p)) {
                            value = value[p];
                        } else {
                            value = undefined;
                            found = false;
                            break;
                        }
                    }
                    if (found && value !== undefined) {
                        result = result.replace(match, value);
                    }
                }
            }
            return result;
        }
        if (template === undefined) { template = {} }   // if template is undefined, set it to empty object
        let templateString = JSON.stringify(template);

        const templateCopy = JSON.parse(templateString);
        const dataCopy = JSON.parse(JSON.stringify(data));

        // Used to record the paths of all used data fields
        const usedPaths = new Set();
        function process(obj: any) {
            for (const key in obj) {
                if (typeof obj[key] === 'object' && obj[key] !== null) {
                    process(obj[key]); // Recursively process nested objects
                } else if (typeof obj[key] === 'string') {
                    // New regular expression to match all occurrences of ${...}
                    const matches = obj[key].match(/\${([^}]+)}/g);
                    if (matches) {
                        // If the entire string is a single placeholder, replace with the value directly (preserve type)
                        if (matches.length === 1 && obj[key].trim() === matches[0]) {
                            let path = matches[0].match(/\${([^}]+)}/) as any;

                            if (!path || path.length < 2) continue;
                            path = path[1];

                            let value = dataCopy;
                            let found = true;
                            for (const p of path.split('.')) {
                                if (value && value.hasOwnProperty(p)) {
                                    value = value[p];
                                } else {
                                    value = undefined;
                                    found = false;
                                    break;
                                }
                            }
                            if (found && value !== undefined) {
                                obj[key] = value;
                                usedPaths.add(path);
                            }
                        } else {
                            let resultString = obj[key];
                            for (const match of matches) {
                                let path = match.match(/\${([^}]+)}/) as any;
                                if (!path || path.length < 2) continue;
                                path = path[1];
                                let value = dataCopy;
                                let found = true;
                                for (const p of path.split('.')) {
                                    if (value && value.hasOwnProperty(p)) {
                                        value = value[p];
                                    } else {
                                        value = undefined;
                                        found = false;
                                        break;
                                    }
                                }
                                if (found && value !== undefined) {
                                    resultString = resultString.replace(match, value);
                                    usedPaths.add(path);
                                }
                            }
                            obj[key] = resultString;
                        }
                    }
                }
            }
        }

        // Process template copy
        process(templateCopy);


        // Delete all used fields from the data copy
        function deleteUsedPaths(dataObj: any, paths: any) {
            paths.forEach((path: any) => {
                const parts = path.split('.');
                let current = dataObj;

                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i];
                    if (current && current.hasOwnProperty(part)) {
                        if (i === parts.length - 1) {
                            // Reach the end of the path and delete the property
                            delete current[part];

                            // If the parent object becomes empty, further cleanup may be required.
                            let parent = dataObj;
                            for (let j = 0; j < parts.length - 1; j++) {
                                const parentPart = parts[j];
                                if (parent[parentPart] && Object.keys(parent[parentPart]).length === 0) {
                                    delete parent[parentPart];
                                    parent = parent[parentPart];
                                } else {
                                    break;
                                }
                            }
                        } else {
                            current = current[part];
                        }
                    } else {
                        break;
                    }
                }
            });
        }

        usedPaths.add('user')   // remove unused user object
        deleteUsedPaths(dataCopy, Array.from(usedPaths));
        if (typeof templateCopy == 'string' || isAddRestData === false) {
            console.log("if", template);
            console.log(templateCopy);
            return templateCopy
        } else {
            console.log("else:", template);
            return { ...templateCopy, ...dataCopy };
        }
    }

    httpCall = async function (method: any, url: any, data: any, headers: any = { 'Content-Type': 'application/json' }) {
        let config: any = {
            method: method,
            url: url,
            headers: headers,
            httpsAgent: new https.Agent({
                rejectUnauthorized: false
            })
        };
        if (method.toLowerCase() === 'get') {
            config.params = data
        } else {
            config.data = data
        }
        try {
            let response = await axios.request(config)
            if (response.data) {
                return response.data
            } else if (response.status == 200) {
                return { message: 'Status 200 - Success (Empty response)' }
            } else if (response.status == 204) {
                return { message: 'Status 204 - No content in response' }
            } else {
                console.log('http ' + method + ' response error: ' + JSON.stringify(response.data));
                return { message: 'Error: http ' + method + ' response error: ' + JSON.stringify(response.data), error: true }
            }
        } catch (error: any) {
            let errMsg = error.message
            if (error.response && error.response.data) {
                if (error.response.data.message) {
                    errMsg += '; ' + error.response.data.message
                } else if (error.response.data.detail) {
                    errMsg += '; ' + error.response.data.detail
                } else if (error.response.data?.error?.message) {
                    errMsg += '; ' + error.response.data.error.message
                }
            }
            console.log('http ' + method + ' error: Url - ' + url + ' - ' + errMsg);
            return { message: 'Error: http ' + method + ' - ' + errMsg, error: true }
        }
    }


    toolExecution = async ({ tool, args }: { tool: any, args: any }) => {
        let headers = {}
        if (tool.type === "API") {
            if (tool.auth.type === "apiKey" && tool.auth.apiKeyLocation === "query") {
                const separator = tool.endpoint?.includes('?') ? '&' : '?';
                tool.endpoint = `${tool.endpoint}${separator}${tool.auth.apiKeyName}=${tool.auth.apiKey}`;
            } else {
                headers = await this.getToolAuthHeaders(tool);
            }
            if (tool.headers) {
                const renderApiHeaders = this.renderTemplateByData(tool.headers, args, false)
                headers = Object.assign(headers, renderApiHeaders)
            }
            const renderParams = this.renderTemplateByData(tool.fixedParams, args)
            const renderUrl = this.renderTemplateByData(tool.endpoint, args)
            let ret = await this.httpCall(tool.method, renderUrl, renderParams, headers)
            let strRet = JSON.stringify(ret)
            const toolReturnLengthLimit = 28000
            let isOverLengthLimit = false
            if (strRet.length > toolReturnLengthLimit) {
                strRet = strRet.slice(0, toolReturnLengthLimit)
                isOverLengthLimit = true
            }
            return { content: strRet, toolName: tool.name, url: renderUrl, params: renderParams, }
        }
        // Future: handle other tool types (database)
        return { error: "Unsupported tool type" };
    };

}