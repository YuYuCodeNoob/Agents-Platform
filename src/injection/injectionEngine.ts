import type { InjectionPoint, InjectionContext } from './types.js';

export class InjectionEngine {
  private injectionPoints: InjectionPoint[] = [];

  add(point: InjectionPoint): void {
    this.injectionPoints.push(point);
  }

  remove(name: string): void {
    this.injectionPoints = this.injectionPoints.filter((p) => p.name !== name);
  }

  apply(requestBody: any, ctx: InjectionContext): any {
    let body = requestBody;
    for (const point of this.injectionPoints) {
      if (point.enabled) {
        body = point.apply(body, ctx);
      }
    }
    return body;
  }

  setEnabled(name: string, enabled: boolean): void {
    const point = this.injectionPoints.find((p) => p.name === name);
    if (point) point.enabled = enabled;
  }
}
