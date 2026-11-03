import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const ossSettingsApi = {
  view: endpoint(endpoints.OssSettings_view),
  save: endpoint(endpoints.OssSettings_save),
  test: endpoint(endpoints.OssSettings_test),
};