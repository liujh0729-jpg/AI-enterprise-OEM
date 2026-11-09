import {
  apiEnvelope,
  endpoints,
  hwKitFileSchema,
  type HwKitFile,
} from "@enterprise/contracts";
import { endpoint } from "./endpoint";
import { http } from "./http";

/** 智能硬件·用户侧：硬件广场 / 我的设备 / 按型号出工具与授权。 */
export const hardwareApi = {
  models: endpoint(endpoints.Hw_models),
  model: endpoint(endpoints.Hw_model),
  kitDownload: endpoint(endpoints.Hw_kitDownload),
  devices: endpoint(endpoints.Hw_devices),
  deviceCreate: endpoint(endpoints.Hw_deviceCreate),
  deviceUpdate: endpoint(endpoints.Hw_deviceUpdate),
  deviceRemove: endpoint(endpoints.Hw_deviceRemove),
  deviceResetToken: endpoint(endpoints.Hw_deviceResetToken),
  deviceEvents: endpoint(endpoints.Hw_deviceEvents),
  tools: endpoint(endpoints.Hw_tools),
  toolCreate: endpoint(endpoints.Hw_toolCreate),
  toolUpdate: endpoint(endpoints.Hw_toolUpdate),
  toolRemove: endpoint(endpoints.Hw_toolRemove),
  toolTrial: endpoint(endpoints.Hw_toolTrial),
  toolGrants: endpoint(endpoints.Hw_toolGrants),
  toolSaveGrants: endpoint(endpoints.Hw_toolSaveGrants),
};

/** 智能硬件·平台管理端：型号 / 开发包 / 型号默认工具维护。 */
export const hardwareAdminApi = {
  modelList: endpoint(endpoints.AdminHw_modelList),
  modelSave: endpoint(endpoints.AdminHw_modelSave),
  modelUpdate: endpoint(endpoints.AdminHw_modelUpdate),
  modelRemove: endpoint(endpoints.AdminHw_modelRemove),
  kitList: endpoint(endpoints.AdminHw_kitList),
  kitSave: endpoint(endpoints.AdminHw_kitSave),
  kitUpdate: endpoint(endpoints.AdminHw_kitUpdate),
  kitRemove: endpoint(endpoints.AdminHw_kitRemove),
  toolList: endpoint(endpoints.AdminHw_toolList),
  toolSave: endpoint(endpoints.AdminHw_toolSave),
  updateTool: endpoint(endpoints.AdminHw_updateTool),
  removeTool: endpoint(endpoints.AdminHw_removeTool),
};

/**
 * 开发包二进制直传本站 OSS（multipart，不进 JSON 契约）：
 * 后端算 SHA-256 并返回元数据，再由 kitSave 带版本号落库。
 */
export async function uploadHardwareKit(file: File): Promise<HwKitFile> {
  const form = new FormData();
  form.append("file", file);
  const result = await http(
    "/api/backend/enterprise/hardware/admin/kits/upload",
    apiEnvelope(hwKitFileSchema),
    { method: "POST", body: form, timeoutMs: 300000 },
  );
  if (!result.data.data) throw new Error("开发包上传没有返回结果");
  return result.data.data;
}