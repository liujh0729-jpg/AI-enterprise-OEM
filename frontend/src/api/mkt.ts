import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const mktApi = {
  skills: endpoint(endpoints.Mkt_listSkills),
  skill: endpoint(endpoints.Mkt_getSkill),
  saveSkill: endpoint(endpoints.Mkt_saveSkill),
  runSkill: endpoint(endpoints.Mkt_runSkill),

  runs: endpoint(endpoints.Mkt_listRuns),
  artifacts: endpoint(endpoints.Mkt_listArtifacts),
  saveArtifact: endpoint(endpoints.Mkt_saveArtifact),
  reviewArtifact: endpoint(endpoints.Mkt_reviewArtifact),
  publishArtifact: endpoint(endpoints.Mkt_publishArtifact),

  context: endpoint(endpoints.Mkt_readContext),
  saveContext: endpoint(endpoints.Mkt_updateContext),

  capabilities: endpoint(endpoints.Mkt_listCapabilities),
  connectAccount: endpoint(endpoints.Mkt_connectAccount),
  disconnectAccount: endpoint(endpoints.Mkt_disconnectAccount),
  callCapability: endpoint(endpoints.Mkt_callCapability),

  loops: endpoint(endpoints.Mkt_listLoops),
  saveLoop: endpoint(endpoints.Mkt_saveLoop),
  removeLoop: endpoint(endpoints.Mkt_removeLoop),

  runEval: endpoint(endpoints.Mkt_runEval),
};
