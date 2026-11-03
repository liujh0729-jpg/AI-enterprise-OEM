import { catalogEndpoint } from "./endpoint";
import type { EndpointId } from "@enterprise/contracts";
const operations = {
  flexOnboarding: "Flex_updateOnboardingContacts",
  flexPayroll: "Flex_updatePayrollContacts",
  taxDeclaration: "Tax_declarationContacts",
  taxMaterial: "Tax_materialPackContacts",
  invoice: "Invoice_updateContacts",
  overseas: "Overseas_updateContacts",
  contracts: "Contracts_updateContacts",
} as const satisfies Record<string, EndpointId>;
export type ContactResource = keyof typeof operations;
export const contactApi = {
  update: ({
    resource,
    id,
    body,
  }: {
    resource: ContactResource;
    id: number;
    body: Record<string, string>;
  }) =>
    catalogEndpoint(operations[resource], { params: { id: String(id) }, body }),
};
