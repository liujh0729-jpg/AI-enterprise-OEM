import {
  hwDeviceCreateBodySchema,
  hwKitSaveBodySchema,
  hwModelSaveBodySchema,
  hwToolSaveBodySchema,
  type z,
} from '@enterprise/contracts';
import type { CurrentUser } from '../auth/current-user';
import { HardwareService } from './hardware.service';

type DeviceCreateBody = z.infer<typeof hwDeviceCreateBodySchema>;
type KitSaveBody = z.infer<typeof hwKitSaveBodySchema>;
type ModelSaveBody = z.infer<typeof hwModelSaveBodySchema>;
type ToolSaveBody = z.infer<typeof hwToolSaveBodySchema>;

/**
 * 智能硬件契约处理器：Hw_ 用户侧 / AdminHw_ 平台管理端，由 moduleHandlers 按 operationId 映射。
 * 参数顺序＝用户、路径参数、查询、请求体（与 automation-routes 的 moduleHandlers 一致）。
 * 管理端动作统一在这里 requireAdmin，服务层不再判重。
 */
export class HardwareController {
  constructor(
    private readonly hardware: HardwareService,
    private readonly requireAdmin: (user: CurrentUser) => void,
  ) {}

  // ---------- 用户侧：硬件广场 ----------

  models(user: CurrentUser, query: { all?: string }) {
    return this.hardware.plazaModels(user.userId, query);
  }

  model(user: CurrentUser, code: string) {
    return this.hardware.plazaModel(user.userId, code);
  }

  kitDownload(user: CurrentUser, id: string) {
    return this.hardware.kitDownload(user.userId, id);
  }

  // ---------- 用户侧：我的设备 ----------

  devices(user: CurrentUser, query: { modelId?: string }) {
    return this.hardware.devices(user.userId, query);
  }

  deviceCreate(user: CurrentUser, body: DeviceCreateBody) {
    return this.hardware.deviceCreate(user.userId, body);
  }

  deviceUpdate(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.hardware.deviceUpdate(user.userId, id, body);
  }

  deviceRemove(user: CurrentUser, id: string) {
    return this.hardware.deviceRemove(user.userId, id);
  }

  deviceResetToken(user: CurrentUser, id: string) {
    return this.hardware.deviceResetToken(user.userId, id);
  }

  deviceEvents(user: CurrentUser, id: string, query: { kind?: string }) {
    return this.hardware.deviceEvents(user.userId, id, query);
  }

  // ---------- 用户侧：工具（API / MCP） ----------

  tools(user: CurrentUser, code: string, query: { kind?: string }) {
    return this.hardware.tools(user.userId, code, query);
  }

  toolCreate(user: CurrentUser, code: string, body: ToolSaveBody) {
    return this.hardware.toolCreate(user.userId, code, body);
  }

  toolUpdate(user: CurrentUser, id: string, body: Partial<ToolSaveBody>) {
    return this.hardware.toolUpdate(user.userId, id, body);
  }

  toolRemove(user: CurrentUser, id: string) {
    return this.hardware.toolRemove(user.userId, id);
  }

  toolTrial(
    user: CurrentUser,
    id: string,
    body: { deviceId: number; args?: Record<string, unknown> },
  ) {
    return this.hardware.toolTrial(user.userId, id, body);
  }

  toolGrants(user: CurrentUser, query: { modelId?: string }) {
    return this.hardware.toolGrants(user.userId, query);
  }

  toolSaveGrants(user: CurrentUser, body: { toolIds?: number[] }) {
    return this.hardware.toolSaveGrants(user.userId, body);
  }

  // ---------- 平台管理端 ----------

  modelList(user: CurrentUser) {
    this.requireAdmin(user);
    return this.hardware.adminModels();
  }

  modelSave(user: CurrentUser, body: ModelSaveBody) {
    this.requireAdmin(user);
    return this.hardware.adminModelSave(user.userId, body);
  }

  modelUpdate(user: CurrentUser, id: string, body: Partial<ModelSaveBody>) {
    this.requireAdmin(user);
    return this.hardware.adminModelUpdate(id, body);
  }

  modelRemove(user: CurrentUser, id: string) {
    this.requireAdmin(user);
    return this.hardware.adminModelRemove(id);
  }

  kitList(user: CurrentUser, query: { modelId?: string }) {
    this.requireAdmin(user);
    return this.hardware.adminKits(query);
  }

  kitSave(user: CurrentUser, body: KitSaveBody) {
    this.requireAdmin(user);
    return this.hardware.adminKitSave(user.userId, body);
  }

  kitUpdate(user: CurrentUser, id: string, body: Partial<KitSaveBody>) {
    this.requireAdmin(user);
    return this.hardware.adminKitUpdate(id, body);
  }

  kitRemove(user: CurrentUser, id: string) {
    this.requireAdmin(user);
    return this.hardware.adminKitRemove(id);
  }

  toolList(user: CurrentUser, query: { modelId?: string; kind?: string }) {
    this.requireAdmin(user);
    return this.hardware.adminToolList(query);
  }

  toolSave(user: CurrentUser, query: { modelId: string }, body: ToolSaveBody) {
    this.requireAdmin(user);
    return this.hardware.adminToolSave(query, body);
  }

  updateTool(user: CurrentUser, id: string, body: Partial<ToolSaveBody>) {
    this.requireAdmin(user);
    return this.hardware.adminToolUpdate(id, body);
  }

  removeTool(user: CurrentUser, id: string) {
    this.requireAdmin(user);
    return this.hardware.adminToolRemove(id);
  }
}
