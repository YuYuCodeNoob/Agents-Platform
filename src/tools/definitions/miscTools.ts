import type { ToolDef } from '../../proxy/protocolAdapters/types.js';

export const checkInboxToolDef: ToolDef = {
  type: 'function',
  function: {
    name: 'gateway_check_inbox',
    description: `Check your inbox for messages from other agents. Execute via:
      curl http://127.0.0.1:9800/gateway/tools/inbox \\
        -H "X-Agent-Id: <your-agent-id>"`,
    parameters: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Max messages to retrieve (default: 10)' },
      },
    },
  },
};

export const registerCallbackToolDef: ToolDef = {
  type: 'function',
  function: {
    name: 'gateway_register_callback',
    description: `Register a callback for task completion. This sends a callback message to the target agent.
      Execute via:
      curl -X POST http://127.0.0.1:9800/gateway/tools/register_callback \\
        -H "Content-Type: application/json" \\
        -H "X-Agent-Id: <your-agent-id>" \\
        -d '{"to": "agent_id", "replyTo": "original_msg_id", "body": "task completed"}'`,
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Agent to notify' },
        replyTo: { type: 'string', description: 'Original message ID being answered' },
        body: { type: 'string', description: 'Callback message body' },
      },
      required: ['to', 'body'],
    },
  },
};

export const getAgentsToolDef: ToolDef = {
  type: 'function',
  function: {
    name: 'gateway_get_agents',
    description: `List all online agents. Execute via:
      curl http://127.0.0.1:9800/gateway/tools/agents \\
        -H "X-Agent-Id: <your-agent-id>"`,
    parameters: {
      type: 'object',
      properties: {},
    },
  },
};
