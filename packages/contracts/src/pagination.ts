import { z } from "zod";
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(20),
});
export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    list: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  });
export const cursorPageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    list: z.array(item),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });
