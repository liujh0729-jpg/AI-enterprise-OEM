import { z } from "zod";

export const directoryProviderSchema = z
  .object({
    providerUserId: z.string(),
    providerType: z.string(),
    orgName: z.string(),
    uscc: z.string(),
    qualification: z.string(),
    serviceItems: z.string(),
    serviceItemsArr: z.array(z.string()),
    intro: z.string(),
    contactName: z.string(),
    contactPhone: z.string(),
    contactEmail: z.string(),
    province: z.string(),
    city: z.string(),
    subjectType: z.string(),
    auditedAt: z.string().nullable(),
    displayName: z.string(),
    businessStaff: z.array(
      z
        .object({
          name: z.string(),
          title: z.string(),
          phone: z.string(),
          email: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type DirectoryProvider = z.infer<typeof directoryProviderSchema>;

export const overseasProviderSchema = z
  .object({
    id: z.number(),
    userId: z.string(),
    orgName: z.string(),
    uscc: z.string(),
    qualification: z.string(),
    contactName: z.string(),
    contactPhone: z.string(),
    contactEmail: z.string(),
    intro: z.string(),
    province: z.string(),
    city: z.string(),
    status: z.string(),
    serviceItems: z.string(),
    auditedAt: z.string().nullable(),
    display_name: z.string(),
    items: z.array(z.string()),
    business_staff: directoryProviderSchema.shape.businessStaff,
  })
  .passthrough();

export const attachmentSchema = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    size: z.number(),
    url: z.string().optional(),
    uploaded_at: z.string().optional(),
  })
  .passthrough();
export const providerApplicationSchema = z
  .object({
    id: z.number(),
    userId: z.string(),
    providerType: z.string(),
    orgName: z.string(),
    uscc: z.string(),
    idCard: z.string(),
    subjectType: z.string(),
    qualification: z.string(),
    province: z.string(),
    city: z.string(),
    contactName: z.string(),
    contactPhone: z.string(),
    contactEmail: z.string(),
    intro: z.string(),
    status: z.string(),
    auditNote: z.string(),
    serviceItems: z.string(),
    attachments: z.array(attachmentSchema),
    business_staff: directoryProviderSchema.shape.businessStaff,
    createdAt: z.string(),
    auditedAt: z.string().nullable(),
  })
  .passthrough();
