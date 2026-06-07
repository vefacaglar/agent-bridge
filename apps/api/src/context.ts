import path from "node:path";
import { ProviderRegistry } from "./providers/ProviderRegistry.js";
import { RunRepository, MessageRepository, ProjectRepository, PermissionRepository, PlanRepository, MemoryRepository } from "./database/repositories.js";
import { Orchestrator } from "./orchestrator/Orchestrator.js";
import { AppSettingsStore } from "./config/AppSettingsStore.js";

/**
 * Shared application dependencies, instantiated once and passed to every
 * route module. Keeps wiring in one place instead of module-level globals.
 */
export interface AppContext {
  registry: ProviderRegistry;
  runRepo: RunRepository;
  messageRepo: MessageRepository;
  projectRepo: ProjectRepository;
  permissionRepo: PermissionRepository;
  planRepo: PlanRepository;
  memoryRepo: MemoryRepository;
  orchestrator: Orchestrator;
  settingsStore: AppSettingsStore;
  defaultProjectPath: string;
}

export function createAppContext(): AppContext {
  const registry = new ProviderRegistry();
  const runRepo = new RunRepository();
  const messageRepo = new MessageRepository();
  const projectRepo = new ProjectRepository();
  const permissionRepo = new PermissionRepository();
  const planRepo = new PlanRepository();
  const memoryRepo = new MemoryRepository();
  const orchestrator = new Orchestrator(runRepo, messageRepo, registry, planRepo, memoryRepo);
  const settingsStore = new AppSettingsStore();

  return {
    registry,
    runRepo,
    messageRepo,
    projectRepo,
    permissionRepo,
    planRepo,
    memoryRepo,
    orchestrator,
    settingsStore,
    defaultProjectPath: process.cwd()
  };
}

/** Normalizes an optional project path/name pair to concrete values. */
export function normalizeProject(ctx: AppContext, projectPath?: string, projectName?: string) {
  const normalizedPath = projectPath?.trim() || ctx.defaultProjectPath;
  return {
    projectPath: normalizedPath,
    projectName: projectName?.trim() || path.basename(normalizedPath) || "Workspace"
  };
}
