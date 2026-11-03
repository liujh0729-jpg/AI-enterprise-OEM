import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const healthApi = {
  health: endpoint(endpoints.Health_health),
  version: endpoint(endpoints.Health_version),
  ready: endpoint(endpoints.Health_ready),
};
