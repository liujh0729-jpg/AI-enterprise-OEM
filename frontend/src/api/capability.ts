import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const capabilityApi = {
  mine: endpoint(endpoints.Capability_mine),
  served: endpoint(endpoints.Capability_served),
  request: endpoint(endpoints.Capability_request),
  cancel: endpoint(endpoints.Capability_cancel),
};
