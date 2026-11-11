import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const growthApi = {
  cockpit: endpoint(endpoints.Growth_cockpit),
  fulfillment: endpoint(endpoints.Growth_fulfillment),
  risks: endpoint(endpoints.Growth_risks),
  scanRisks: endpoint(endpoints.Growth_scanRisks),
  fulfillmentAdvice: endpoint(endpoints.Growth_fulfillmentAdvice),
  dispatchFulfillment: endpoint(endpoints.Growth_dispatchFulfillment),
};
