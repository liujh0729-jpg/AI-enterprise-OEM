import { randomUUID } from 'node:crypto';
import { text as readText } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { httpRequest, TransportError } from '../http/transport';

const ENDPOINT = 'https://openspeech.bytedance.com';
const SUBMIT_PATH = '/api/v3/auc/bigmodel/submit';
const QUERY_PATH = '/api/v3/auc/bigmodel/query';
const POLL_INTERVAL_MS = 3000;
const MAX_WAIT_MS = 20 * 60 * 1000;

/** 豆包语音识别的资源位：模型设置里选哪个 id 就用哪个 resource_id。 */
export const DOUBAO_ASR_VARIANTS: Record<
  string,
  { label: string; resourceId: string }
> = {
  seedasr: { label: 'Doubao ASR 2.0', resourceId: 'volc.seedasr.auc' },
  bigasr: { label: 'Doubao ASR 1.0', resourceId: 'volc.bigasr.auc' },
  flash: { label: 'Doubao ASR Flash', resourceId: 'volc.bigasr.auc_turbo' },
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function statusOf(headers: Headers) {
  return String(headers.get('x-api-status-code') || '').trim();
}

/**
 * 豆包语音识别（火山 openspeech v3）：**独立于方舟 API Key**，用控制台「API Key 管理」
 * 里的那一把，请求头 `X-Api-Key`。标准版 submit + query 轮询（同一 Request-Id）。
 */
export class OpenspeechClient {
  constructor(private readonly apiKey: string) {}

  private headers(resourceId: string, requestId: string, submit: boolean) {
    const base: Record<string, string> = {
      'X-Api-Key': this.apiKey,
      'X-Api-Resource-Id': resourceId,
      'X-Api-Request-Id': requestId,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (submit) base['X-Api-Sequence'] = '-1';
    return base;
  }

  private async post(
    path: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    operation: string,
  ) {
    try {
      const response = await httpRequest<string>(`${ENDPOINT}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        timeoutMs: 120_000,
        readAs: 'text',
        operation,
      });
      return response;
    } catch (error) {
      if (error instanceof TransportError) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          '豆包语音识别不可达或超时',
        );
      }
      throw error;
    }
  }

  async transcribe(input: { audioUrl: string; model?: string }) {
    const variant =
      DOUBAO_ASR_VARIANTS[String(input.model || '').trim()] ||
      DOUBAO_ASR_VARIANTS.seedasr;
    const requestId = `enterprise-asr-${randomUUID()}`;
    const body = {
      user: { uid: 'enterprise' },
      audio: { url: input.audioUrl },
      request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true },
    };
    const submit = await this.post(
      SUBMIT_PATH,
      this.headers(variant.resourceId, requestId, true),
      body,
      'content:openspeechSubmit',
    );
    const submitStatus = statusOf(submit.headers);
    if (submitStatus !== '20000000') {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `豆包语音识别提交失败（X-Api-Status-Code=${submitStatus || `N/A/HTTP ${submit.status}`}）`,
      );
    }
    const deadline = Date.now() + MAX_WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      // query 必须带空 JSON body，否则网关反序列化失败
      const query = await this.post(
        QUERY_PATH,
        this.headers(variant.resourceId, requestId, false),
        {},
        'content:openspeechQuery',
      );
      const status = statusOf(query.headers);
      if (status === '20000001' || status === '20000002') continue;
      if (status !== '20000000') {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          `豆包语音识别失败（X-Api-Status-Code=${status || `N/A/HTTP ${query.status}`}）`,
        );
      }
      try {
        const payload = JSON.parse(query.data) as {
          result?: { text?: unknown };
        };
        return readText(payload.result?.text).trim();
      } catch {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          '豆包语音识别响应不是合法 JSON',
        );
      }
    }
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      '豆包语音识别超时未返回结果',
    );
  }
}
