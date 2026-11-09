import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const partyApi = {
  list: endpoint(endpoints.Party_list),
  save: endpoint(endpoints.Party_save),
  remove: endpoint(endpoints.Party_remove),
};
