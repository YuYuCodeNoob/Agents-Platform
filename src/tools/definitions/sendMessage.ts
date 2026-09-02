import type { ToolDef } from '../../proxy/protocolAdapters/types.js';

export const sendMessageToolDef: ToolDef = {
  type: 'function',
  function: {
    name: 'gateway_send_message',
    description: `Send a message to another agent. Execute via:
      curl -X POST http://127.0.0.1:9800/gateway/tools/send_message \\
        -H "Content-Type: application/json" \\
        -H "X-Agent-Id: <your-agent-id>" \\
        -d '{"to": "agent_target_id", "body": "message content", "type": "task"}'`,
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Target agent ID' },
        body: { type: 'string', description: 'Message body' },
        type: {
          type: 'string',
          enum: ['task', 'callback', 'chat', 'command'],
          description: 'Message type (default: chat)',
        },
        replyTo: { type: 'string', description: 'Original message ID for callbacks' },
      },
      required: ['to', 'body'],
    },
  },
};
