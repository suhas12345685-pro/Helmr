import { MCPClient } from '@mastra/mcp';
import type { Tool } from '@mastra/core/tools';

export interface McpServerConfig {
  name: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export async function createMcpToolset(servers: McpServerConfig[]): Promise<MCPClient> {
  const serverMap: ConstructorParameters<typeof MCPClient>[0]['servers'] = {};

  for (const srv of servers) {
    if (srv.url) {
      serverMap[srv.name] = { url: new URL(srv.url) };
    } else if (srv.command) {
      serverMap[srv.name] = { command: srv.command, args: srv.args, env: srv.env };
    }
  }

  return new MCPClient({ servers: serverMap });
}

export async function getToolsFromMcp(client: MCPClient): Promise<Record<string, Tool>> {
  return client.listTools();
}
