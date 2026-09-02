import { randomUUID } from 'crypto';
import type { AgentInfo, RegisterAgentRequest } from './types.js';
import { eventBus } from '../events/eventBus.js';

class AgentRegistry {
  private agents = new Map<string, AgentInfo>();

  register(req: RegisterAgentRequest): AgentInfo {
    const id = `agent_${req.name}_${randomUUID().slice(0, 8)}`;
    const now = Date.now();

    const info: AgentInfo = {
      id,
      name: req.name,
      type: req.type,
      status: 'online',
      registeredAt: now,
      lastSeen: now,
      llmConfig: req.llmConfig,
    };

    this.agents.set(id, info);
    eventBus.emitEvent('agent.registered', id, { name: req.name, type: req.type });
    return info;
  }

  unregister(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    agent.status = 'offline';
    this.agents.delete(agentId);
    eventBus.emitEvent('agent.unregistered', agentId, { name: agent.name });
    return true;
  }

  get(agentId: string): AgentInfo | undefined {
    return this.agents.get(agentId);
  }

  touch(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastSeen = Date.now();
    }
  }

  list(): AgentInfo[] {
    return Array.from(this.agents.values());
  }

  listOnline(): AgentInfo[] {
    return this.list().filter((a) => a.status === 'online');
  }
}

export const agentRegistry = new AgentRegistry();
