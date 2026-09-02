import type { IMInboundMessage } from './types.js';
import type { MessageBus } from '../mq/messageBus.js';
import { agentRegistry } from '../agents/agentRegistry.js';

export interface ParsedCommand {
  action: 'steer' | 'status' | 'memory' | 'stop' | 'unknown';
  targetAgent?: string;
  body?: string;
  query?: string;
  raw: string;
}

export function parseCommand(msg: IMInboundMessage): ParsedCommand {
  const text = msg.text.trim();

  if (/^(status|list|agents)/i.test(text)) {
    return { action: 'status', raw: text };
  }

  const memMatch = text.match(/^(?:memory|mem)\s+(?:query|search)?\s*(.+)/i);
  if (memMatch) {
    return { action: 'memory', query: memMatch[1], raw: text };
  }

  const stopMatch = text.match(/^stop\s+([\w-]+)/i);
  if (stopMatch) {
    return { action: 'stop', targetAgent: stopMatch[1], raw: text };
  }

  const steerMatch = text.match(/^@([\w-]+)\s*:?\s*(.+)/) ?? text.match(/^([\w-]+):\s*(.+)/);
  if (steerMatch) {
    return {
      action: 'steer',
      targetAgent: steerMatch[1],
      body: steerMatch[2],
      raw: text,
    };
  }

  return { action: 'unknown', raw: text };
}

export async function executeCommand(
  cmd: ParsedCommand,
  mq: MessageBus
): Promise<string> {
  switch (cmd.action) {
    case 'steer': {
      const agent = agentRegistry.list().find((a) => a.name === cmd.targetAgent || a.id === cmd.targetAgent);
      if (!agent) return `Agent '${cmd.targetAgent}' not found. Online: ${agentRegistry.listOnline().map((a) => a.name).join(', ')}`;

      await mq.sendToAgent(agent.id, {
        to: agent.id,
        body: cmd.body || '',
        type: 'command',
      }, 'im_leader');
      return `Sent steering command to ${agent.name}: ${cmd.body}`;
    }

    case 'status': {
      const agents = agentRegistry.listOnline();
      if (agents.length === 0) return 'No agents online.';
      return agents.map((a) => `${a.name} (${a.type}) - last seen ${new Date(a.lastSeen).toISOString()}`).join('\n');
    }

    case 'memory': {
      return `Memory query: ${cmd.query} (use /gateway/tools/search_memory API for full results)`;
    }

    case 'stop': {
      const agent = agentRegistry.list().find((a) => a.name === cmd.targetAgent || a.id === cmd.targetAgent);
      if (!agent) return `Agent '${cmd.targetAgent}' not found.`;
      agentRegistry.unregister(agent.id);
      return `Agent ${agent.name} stopped.`;
    }

    default:
      return `Unknown command: ${cmd.raw}`;
  }
}
