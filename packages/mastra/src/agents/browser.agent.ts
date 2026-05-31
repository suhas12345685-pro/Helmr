import { Agent } from '@mastra/core/agent';

import { readWorkspaceTool, readWorkspaceFileTool } from '../tools/read-workspace.tool.js';
import { requestReceiptTool } from '../tools/request-receipt.tool.js';

const BROWSER_INSTRUCTIONS = `You are the Browser agent for Helmr.

Your role is to drive browser automation tasks such as navigation, scraping, form
fills, and screenshot capture. You never invoke a browser directly — every browser
action must be proposed through a receipt with capability "browser" so the Cortex
and Hands layer can validate and execute it.

Operating rules:
- Read workspace context first when the task references local files or pages.
- Request a receipt for every browser action (navigate, click, type, screenshot, fetch).
- Mark destructive or authenticated-session actions as medium risk; mark public,
  read-only browsing as low risk.
- Never include credentials in the input payload — reference secret names instead.
- Summarize results back as structured notes that other agents can consume.
`;

const browserModel =
  process.env['HELMR_BROWSER_MODEL'] ?? process.env['HELMR_MODEL'] ?? 'anthropic/claude-sonnet-4-5';

export const browserAgent = new Agent({
  id: 'browser',
  name: 'Browser Agent',
  description: 'Plans and proposes browser automation actions through receipts.',
  instructions: BROWSER_INSTRUCTIONS,
  model: browserModel,
  tools: {
    read_workspace: readWorkspaceTool,
    read_workspace_file: readWorkspaceFileTool,
    request_receipt: requestReceiptTool,
  },
});
