import { McpServerProfile } from "../models/mcp.model";
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'

export class MCPService {

    //create
    create = async (data: any) => {
        const { serverUrl } = data;
        console.log({ serverUrl })
        let client = await this.getMcpClient(serverUrl) as any
        if (client.error) {
            return client
        }
        console.log("got the client")

        let serverCapabilities = client.getServerCapabilities()
        let serverInfo = client.getServerVersion()
        let instructions = client.getInstructions()

        let tools = []
        try {
            let toolsRet = await client.listTools()
            tools = toolsRet.tools || []
        } catch (err) {
            console.error('Error loading MCP tools:', err)
        }

        let prompts = []
        if (serverCapabilities.prompts) {
            try {
                let promptsRet = await client.listPrompts()
                prompts = promptsRet.prompts || []
            } catch (err) {
                console.error('Error loading MCP prompts:', err)
            }
        }
        return { instructions, tools, prompts, ...serverInfo }

    }


    // register the mcp in bot.
    //get tools

    // execute 


    getMcpClient = async (url: string) => {
        let client = undefined
        console.log("get mcpp client")
        const baseUrl = new URL(url);
        console.log(baseUrl)
        try {
            if (baseUrl.pathname.endsWith('/sse')) {
                client = new Client({
                    name: 'sse-client',
                    version: '1.0.0'
                });
                const sseTransport = new SSEClientTransport(baseUrl);
                await client.connect(sseTransport);
                console.log("Connected using SSE transport - " + url);
            } else if (baseUrl.pathname.endsWith('/mcp')) {
                client = new Client({
                    name: 'streamable-http-client',
                    version: '1.0.0'
                });
                const transport = new StreamableHTTPClientTransport(baseUrl);
                await client.connect(transport);
                console.log("Connected using Streamable HTTP transport - " + url);
            } else {
                throw new Error("Unsupported URL path. Use either '/sse' or '/mcp' - " + url);
            }
        } catch (error: any) {
            console.log("Connection failed: " + url, error.message);
            return null;
        }
        return client
    }

}


