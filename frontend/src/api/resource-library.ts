import { z, ApiError } from "@enterprise/contracts";
import { legalApi } from "./legal";
import { ipApi } from "./ip";
import { thinkTankApi } from "./think-tank";
import { identityApi } from "./identity";
import { parseData } from "./endpoint";
function methods(path: string) {
  if (path === "/enterprise/legal/lawyers")
    return {
      list: legalApi.lawyers,
      create: legalApi.createLawyer,
      update: legalApi.updateLawyer,
      remove: legalApi.removeLawyer,
    };
  if (path === "/enterprise/ip/agencies")
    return {
      list: ipApi.agencies,
      create: ipApi.createAgency,
      update: ipApi.updateAgency,
      remove: ipApi.removeAgency,
    };
  if (path === "/enterprise/think-tank/experts")
    return {
      list: thinkTankApi.experts,
      create: thinkTankApi.createExpert,
      update: thinkTankApi.updateExpert,
      remove: thinkTankApi.removeExpert,
    };
  throw new ApiError("未登记的资源库", "protocol");
}
export const resourceLibraryApi = {
  list: async <Row>(
    path: string,
    query: Record<string, string>,
    schema: z.ZodType<Row>,
    signal: AbortSignal,
  ) =>
    parseData(z.array(schema), await methods(path).list({ query }, { signal })),
  affiliations: async (path: string, signal: AbortSignal) => {
    if (path !== "/enterprise/staff/affiliations/mine")
      throw new ApiError("未登记的挂靠查询", "protocol");
    return (await identityApi.myAffiliations({}, { signal })) ?? [];
  },
  create: async ({
    path,
    body,
  }: {
    path: string;
    body: Record<string, unknown>;
  }) => await methods(path).create({ body }),
  update: async ({
    path,
    id,
    body,
  }: {
    path: string;
    id: number;
    body: Record<string, unknown>;
  }) => await methods(path).update({ params: { id: String(id) }, body }),
  remove: async ({ path, id }: { path: string; id: number }) =>
    await methods(path).remove({ params: { id: String(id) } }),
};
