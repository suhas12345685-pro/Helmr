import { type RoutingConfig, type TaskKind, type ModelRoute, DEFAULT_ROUTING, toMastraModelId, loadRoutingConfig } from './routing-config.js';

export class ModelRouter {
  private config: RoutingConfig;

  constructor(config: RoutingConfig = DEFAULT_ROUTING) {
    this.config = config;
  }

  static async fromFile(configPath: string): Promise<ModelRouter> {
    const config = await loadRoutingConfig(configPath);
    return new ModelRouter(config);
  }

  route(task: TaskKind): ModelRoute {
    return this.config.tasks[task] ?? this.config.default;
  }

  modelId(task: TaskKind): string {
    return toMastraModelId(this.route(task));
  }

  updateRoute(task: TaskKind, route: ModelRoute): void {
    this.config.tasks[task] = route;
  }

  getConfig(): RoutingConfig {
    return { ...this.config, tasks: { ...this.config.tasks } };
  }

  setConfig(config: RoutingConfig): void {
    this.config = config;
  }

  allRoutes(): Array<{ task: string; provider: string; model: string }> {
    const rows: Array<{ task: string; provider: string; model: string }> = [];
    rows.push({ task: 'default', ...this.config.default });
    for (const [task, route] of Object.entries(this.config.tasks)) {
      if (route) rows.push({ task, ...route });
    }
    return rows;
  }
}
