import type { InjectionPoint, InjectionContext } from './types.js';
import type { ToolDef } from '../proxy/protocolAdapters/types.js';

export class ToolListSuffixInjector implements InjectionPoint {
  name = 'ToolListSuffix';
  enabled = true;

  constructor(private tools: ToolDef[]) {}

  apply(requestBody: any, ctx: InjectionContext): any {
    return ctx.adapter.injectTools(requestBody, this.tools);
  }
}
