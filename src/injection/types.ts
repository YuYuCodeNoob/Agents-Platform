import type { ProtocolAdapter } from '../proxy/protocolAdapters/types.js';
import type { ToolDef } from '../proxy/protocolAdapters/types.js';

export interface InjectionContext {
  agentId?: string;
  agentType?: string;
  adapter: ProtocolAdapter;
}

export interface InjectionPoint {
  name: string;
  enabled: boolean;
  apply(requestBody: any, ctx: InjectionContext): any;
}
