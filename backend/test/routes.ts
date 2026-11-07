import { NestExpressApplication } from '@nestjs/platform-express';

export interface RouteDef {
  method: string;
  path: string;
}

/** Every route registered on the Express router (method + path with :params), sorted. */
export function listRoutes(app: NestExpressApplication): RouteDef[] {
  const inst = app.getHttpAdapter().getInstance() as { router?: { stack: unknown[] }; _router?: { stack: unknown[] } };
  const stack = (inst.router ?? inst._router)?.stack ?? [];
  const out: RouteDef[] = [];
  for (const layer of stack as { route?: { path: string; methods: Record<string, boolean> } }[]) {
    if (!layer.route) continue;
    for (const [m, on] of Object.entries(layer.route.methods)) if (on && m !== '_all') out.push({ method: m.toUpperCase(), path: layer.route.path });
  }
  return out.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
}
