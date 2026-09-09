import axios from "axios";
import { Tools } from "../models/shared.model";
import https from "https";
import { BotService } from "./bot.service";
import { Actor, assertCanManage, assertCanView } from "../util/botAccess";

export class ToolService {
    OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    botService = new BotService();

    readToolsByBotId = async ({ botId, actor }: { botId: string; actor: Actor }) => {
        const bot = await this.botService.readByBotId(botId);
        if (!bot) return [];
        assertCanView(bot, actor);
        const tools = await Tools.find({ botId });
        return tools;
    }

    // A tool's stored auth (API keys, basic-auth credentials) makes reading
    // one exactly as sensitive as reading the bot it belongs to.
    readToolById = async ({ id, actor }: { id: string; actor: Actor }) => {
        const tool = await Tools.findById(id);
        if (!tool) return null;
        const bot = await this.botService.readByBotId(tool.botId);
        if (!bot) return null;
        assertCanView(bot, actor);
        return tool;
    }

    readEnabledToolById = async ({ id }: { id: string }) => {
        const tool = await Tools.findById({ _id: id, enabled: true });
        return tool;
    }

    create = async (toolData: any, actor: Actor) => {
        const bot = await this.botService.readByBotId(toolData.botId);
        if (!bot) {
            throw new Error("Bot not found");
        }
        assertCanManage(bot, actor);
        const tool = new Tools(toolData);
        await tool.save();
        return tool;
    }

    update = async ({ id, toolData, actor }: { id: string, toolData: any, actor: Actor }) => {
        const existing = await Tools.findById(id);
        if (!existing) return null;
        // Ownership is checked against the tool's own botId, never the body's
        // — a caller could otherwise smuggle in a botId they do control.
        const bot = await this.botService.readByBotId(existing.botId);
        if (!bot) return null;
        assertCanManage(bot, actor);
        const tool = await Tools.findByIdAndUpdate(id, toolData, { new: true });
        return tool;
    }

    delete = async ({ id, actor }: { id: string, actor: Actor }) => {
        const existing = await Tools.findById(id);
        if (!existing) return;
        const bot = await this.botService.readByBotId(existing.botId);
        if (!bot) return;
        assertCanManage(bot, actor);
        await Tools.findByIdAndDelete(id);
    }

    // Detect if a tool should be used using LLM
    //
    // Queries Tools directly rather than through readToolsByBotId: this runs
    // inside the chat flow, which isn't gated by bot ownership in this pass
    // (see chat.controller.ts), so there is no "actor" to check against here.
    detectToolUse = async ({ botId, query }: { botId: string; query: string }): Promise<{ tool: string, params: any } | null> => {
        const availableTools = await Tools.find({ botId }) as Array<any>;
        if (availableTools.length === 0) {
            return null;
        }
        const toolsList = availableTools.map(t => ({
            id: t._id,
            name: t.name,
            description: t.description,
            // Every place an argument can be substituted into the request —
            // detectToolUse used to send only `parameters`, so the model had
            // no idea path/query args or a request body even existed and
            // routinely left them out of `params`.
            pathVariables: t.pathVariable?.map((p: any) => ({
                name: p.name,
                type: p.type,
                description: p.description,
                required: p.required,
            })),
            queryParams: t.queryParam?.map((p: any) => ({
                name: p.name,
                type: p.type,
                description: p.description,
                required: p.required,
            })),
            requestBody: t.requestBody?.schema,
        }));

        const prompt = `Analyze the following user query and determine if it requires using one of the available tools.
                        If yes, respond with a JSON object containing "id" (the tool ID), "tool" (the tool name) and "params" (a single flat object
                        with one key per argument name declared in that tool's pathVariables, queryParams, and requestBody — fill in every "required" one).
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
                console.log("Detected tool:", toolData);
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
                break;
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
                        if (value && Object.prototype.hasOwnProperty.call(value, p)) {
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
        const templateString = JSON.stringify(template);

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
                                if (value && Object.prototype.hasOwnProperty.call(value, p)) {
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
                                    if (value && Object.prototype.hasOwnProperty.call(value, p)) {
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
                    if (current && Object.prototype.hasOwnProperty.call(current, part)) {
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
        const config: any = {
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
            const response = await axios.request(config)
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


    // Splits the model's single flat `args` object into where each value
    // actually belongs — substituted into the URL path, appended as a query
    // param, or placed in the request body — by matching each arg's key
    // against the tool's own declared pathVariable/queryParam/requestBody
    // field names. Also checks that every field marked `required` was
    // supplied, so a malformed call (e.g. a literal "undefined" in the URL)
    // fails loudly instead of silently hitting the wrong endpoint.
    routeToolArgs = ({ tool, args }: { tool: any; args: any }) => {
        const source = args && typeof args === "object" ? args : {};
        const missing: string[] = [];

        let endpoint = tool.endpoint || "";
        const pathVariables: Array<{ name: string; required?: boolean }> = tool.pathVariable || [];
        for (const pv of pathVariables) {
            const value = source[pv.name];
            if (value === undefined || value === null || value === "") {
                if (pv.required) missing.push(pv.name);
                continue;
            }
            endpoint = endpoint.replace(`:${pv.name}`, encodeURIComponent(String(value)))
                .replace(`{${pv.name}}`, encodeURIComponent(String(value)));
        }

        const queryParams: Record<string, unknown> = {};
        const queryDefs: Array<{ name: string; required?: boolean; defaultValue?: unknown }> = tool.queryParam || [];
        for (const qp of queryDefs) {
            const value = source[qp.name];
            if (value === undefined || value === null || value === "") {
                if (qp.defaultValue !== undefined) queryParams[qp.name] = qp.defaultValue;
                else if (qp.required) missing.push(qp.name);
                continue;
            }
            queryParams[qp.name] = value;
        }

        const bodySchemaProps = tool.requestBody?.schema?.properties;
        const bodyRequired: string[] = tool.requestBody?.schema?.required || [];
        let body: Record<string, unknown> | undefined;
        if (bodySchemaProps) {
            body = {};
            for (const fieldName of Object.keys(bodySchemaProps)) {
                const value = source[fieldName];
                if (value === undefined || value === null || value === "") {
                    if (bodyRequired.includes(fieldName)) missing.push(fieldName);
                    continue;
                }
                body[fieldName] = value;
            }
        }

        // Fields the model returned that don't match any declared path/query/body
        // name — fall back to sending them as query (GET) or body (others) data,
        // same as the tool's static fixedParams, rather than dropping them.
        const declaredNames = new Set([
            ...pathVariables.map((p) => p.name),
            ...queryDefs.map((p) => p.name),
            ...(bodySchemaProps ? Object.keys(bodySchemaProps) : []),
        ]);
        const unmatched: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(source)) {
            if (!declaredNames.has(key)) unmatched[key] = value;
        }

        return { endpoint, queryParams, body, unmatched, missing };
    };

    toolExecution = async ({ tool, args }: { tool: any, args: any }) => {
        let headers = {}
        if (tool.type === "API") {
            const { endpoint, queryParams, body, unmatched, missing } = this.routeToolArgs({ tool, args });
            if (missing.length > 0) {
                return {
                    error: true,
                    content: `Missing required parameter(s) for tool "${tool.name}": ${missing.join(", ")}`,
                    toolName: tool.name,
                };
            }

            let renderUrl = endpoint;
            if (tool.auth?.type === "apiKey" && tool.auth.apiKeyLocation === "query") {
                const separator = renderUrl.includes('?') ? '&' : '?';
                renderUrl = `${renderUrl}${separator}${tool.auth.apiKeyName}=${tool.auth.apiKey}`;
            } else {
                headers = await this.getToolAuthHeaders(tool);
            }
            if (tool.headers) {
                const renderApiHeaders = this.renderTemplateByData(tool.headers, args, false)
                headers = Object.assign(headers, renderApiHeaders)
            }

            // Admin-configured static params always apply; the model-supplied
            // query/body args (matched above by declared name) layer on top.
            const fixedParams = tool.auth?.fixedParams;
            const isGet = String(tool.method).toUpperCase() === "GET";
            const requestData = isGet
                ? { ...fixedParams, ...queryParams, ...unmatched }
                : { ...fixedParams, ...body, ...unmatched, ...queryParams };

            console.log("Executing tool with method:", tool.method, "url:", renderUrl, "data:", requestData, "headers:", headers);
            const ret = await this.httpCall(tool.method, renderUrl, requestData, headers)
            let strRet = JSON.stringify(ret)
            const toolReturnLengthLimit = 28000
            if (strRet.length > toolReturnLengthLimit) {
                strRet = strRet.slice(0, toolReturnLengthLimit)
            }
            return { content: strRet, toolName: tool.name, url: renderUrl, params: requestData, }
        }
        // Future: handle other tool types (database)
        return { error: "Unsupported tool type" };
    };
}