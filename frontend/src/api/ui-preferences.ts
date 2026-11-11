import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

/** 账号级「用户界面偏好」：当前只承载驾驶舱快捷导航（dashboard.shortcuts），跨设备保存。 */
export const uiPreferencesApi = {
  get: endpoint(endpoints.UiPrefs_get),
  save: endpoint(endpoints.UiPrefs_save),
};
