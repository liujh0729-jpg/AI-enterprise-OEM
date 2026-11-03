import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const marketBoardApi = {
  demandDetail: endpoint(endpoints.MarketBoard_demandDetail),
  serviceDetail: endpoint(endpoints.MarketBoard_serviceDetail),
  demands: endpoint(endpoints.MarketBoard_demands),
  createDemand: endpoint(endpoints.MarketBoard_createDemand),
  demandMessages: endpoint(endpoints.MarketBoard_demandMessages),
  updateDemand: endpoint(endpoints.MarketBoard_updateDemand),
  removeDemand: endpoint(endpoints.MarketBoard_removeDemand),
  services: endpoint(endpoints.MarketBoard_services),
  /** 服务市集：AIworkin SUPPLY 公开池（全平台服务商在该板块已发布的服务）。 */
  marketplace: endpoint(endpoints.MarketBoard_marketplace),
  marketplaceDetail: endpoint(endpoints.MarketBoard_marketplaceDetail),
  createService: endpoint(endpoints.MarketBoard_createService),
  updateService: endpoint(endpoints.MarketBoard_updateService),
  removeService: endpoint(endpoints.MarketBoard_removeService),
};
