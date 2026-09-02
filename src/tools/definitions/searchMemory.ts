import type { ToolDef } from '../../proxy/protocolAdapters/types.js';

export const searchMemoryToolDef: ToolDef = {
  type: 'function',
  function: {
    name: 'gateway_search_memory',
    description: `Search shared memory across all agents. Execute via:
      curl -X POST http://127.0.0.1:9800/gateway/tools/search_memory \\
        -H "Content-Type: application/json" \\
        -H "X-Agent-Id: <your-agent-id>" \\
        -d '{"query": "search terms", "layer": "all"}'`,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query terms' },
        layer: {
          type: 'string',
          enum: ['raw', 'structured', 'skill', 'personality', 'all'],
          description: 'Memory layer to search (default: all)',
        },
        limit: { type: 'number', description: 'Max results (default: 20)' },
      },
      required: ['query'],
    },
  },
};
