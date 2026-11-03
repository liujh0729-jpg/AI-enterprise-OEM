import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const externalApi = {
  channels: endpoint(endpoints.External_channels),
  submissions: endpoint(endpoints.External_submissions),
  byRef: endpoint(endpoints.External_byRef),
  detail: endpoint(endpoints.External_detail),
  preview: endpoint(endpoints.External_preview),
  create: endpoint(endpoints.External_create),
  submit: endpoint(endpoints.External_submit),
  receipt: endpoint(endpoints.External_receipt),
  pay: endpoint(endpoints.External_pay),
  reject: endpoint(endpoints.External_reject),
  retry: endpoint(endpoints.External_retry),
  cancel: endpoint(endpoints.External_cancel),
  callbacks: endpoint(endpoints.External_callbacks),
  recordCallback: endpoint(endpoints.External_recordCallback),
  listCredentials: endpoint(endpoints.External_listCredentials),
  saveCredential: endpoint(endpoints.External_saveCredential),
  removeCredential: endpoint(endpoints.External_removeCredential),
};
