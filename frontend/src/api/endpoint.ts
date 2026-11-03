import { z, ApiError } from "@enterprise/contracts";
import { http, type HttpOptions } from "./http";

type Definition<P, Q, B, R extends { data: unknown }> = {
  method: string;
  path: string;
  params: z.ZodType<P>;
  query: z.ZodType<Q>;
  body: z.ZodType<B>;
  response: z.ZodType<R>;
};
export function endpoint<P, Q, B, R extends { data: unknown }>(
  definition: Definition<P, Q, B, R>,
  defaults: HttpOptions = {},
) {
  return async (
    input: { params?: P; query?: Q; body?: B } = {},
    options: HttpOptions = {},
  ): Promise<R["data"]> => {
    const params = definition.params.parse(input.params ?? {});
    const query = definition.query.parse(input.query ?? {});
    const body = definition.body.parse(input.body);
    const path = definition.path.replace(
      /:([A-Za-z0-9_]+)/g,
      (_, name: string) => {
        const value =
          params && typeof params === "object"
            ? Reflect.get(params, name)
            : undefined;
        if (
          value === undefined ||
          value === null ||
          ["undefined", "null", "NaN"].includes(String(value))
        )
          throw new Error("请求缺少有效编号");
        return encodeURIComponent(String(value));
      },
    );
    const result = await http(`/api/backend${path}`, definition.response, {
      timeoutMs: /attachments|external|qxy|upload/.test(definition.path)
        ? 90000
        : 30000,
      ...defaults,
      ...options,
      method: definition.method.toUpperCase(),
      body,
      query:
        query && typeof query === "object"
          ? Object.fromEntries(Object.entries(query))
          : undefined,
    });
    return result.data.data;
  };
}

/** 多态业务组件按已登记的操作选择契约，输入和输出均经过 Schema 校验。 */
export async function catalogEndpoint(
  id: import("@enterprise/contracts").EndpointId,
  input: { params?: unknown; query?: unknown; body?: unknown } = {},
  options: HttpOptions = {},
) {
  const { endpoints } = await import("@enterprise/contracts");
  const definition: Definition<unknown, unknown, unknown, { data: unknown }> =
    endpoints[id];
  return endpoint(definition)(input, options);
}
export function parseData<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError("接口响应与约定不一致", "protocol");
  return parsed.data;
}
