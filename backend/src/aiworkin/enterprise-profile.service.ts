import { AiworkinClient } from './aiworkin.client';
import { ConnectionProfile, ConnectionProfileInput } from './aiworkin.types';
/**
 * 企业档案：主数据在 AIworkin，本系统不存储，查询/新增/修改均为接口调用。
 * 契约见《企业财税出海物流综合服务系统需求文档 2.0》§8。
 */
export class EnterpriseProfileService {
  constructor(private readonly client: AiworkinClient) {}
  /** 查询本人档案；无档案时 AIworkin 返回空模板（profileId: null）。 */
  get(token: string) {
    return this.client.request<ConnectionProfile>('/connections/profile', {
      token,
    });
  }
  preview(token: string) {
    return this.client.request<ConnectionProfile>(
      '/connections/profile/preview',
      { token },
    );
  }
  /** 新增与修改统一走该接口（全量替换语义）。 */
  save(token: string, input: ConnectionProfileInput) {
    return this.client.request<ConnectionProfile>('/connections/profile', {
      method: 'PUT',
      token,
      body: input,
      retry: 0,
    });
  }
  setIdentity(token: string, accountType: 'personal' | 'company') {
    return this.client.request<ConnectionProfile>(
      '/connections/profile/identity',
      { method: 'PUT', token, body: { accountType }, retry: 0 },
    );
  }
  setDisplay(token: string, enabled: boolean) {
    return this.client.request<ConnectionProfile>(
      '/connections/profile/display',
      { method: 'PUT', token, body: { enabled }, retry: 0 },
    );
  }
  setConnectionMarket(token: string, enabled: boolean) {
    return this.client.request<ConnectionProfile>(
      '/connections/profile/connection-market',
      { method: 'PUT', token, body: { enabled }, retry: 0 },
    );
  }
  saveVerification(token: string, draft: Record<string, unknown>) {
    return this.client.request<unknown>('/connections/profile/verification', {
      method: 'PUT',
      token,
      body: draft,
      retry: 0,
    });
  }
  submitVerification(token: string) {
    return this.client.request<unknown>(
      '/connections/profile/verification/submit',
      { method: 'POST', token, body: {}, retry: 0 },
    );
  }
}
