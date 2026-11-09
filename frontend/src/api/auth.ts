import { apiEnvelope, z } from "@enterprise/contracts";
import { http } from "./http";

/**
 * 开源版本地账户体系（/api/auth/local/*）：登录页全部走这里，
 * /api/auth/login|register 仅作为既有调用方的兼容入口保留在后端。
 */
export const registerModeSchema = z.enum(["USERNAME", "EMAIL", "PHONE"]);
export const loginMethodSchema = z.enum([
  "PASSWORD",
  "EMAIL_CODE",
  "SMS_CODE",
  "WECHAT",
]);
export const codeChannelSchema = z.enum(["EMAIL", "SMS"]);

export type RegisterMode = z.infer<typeof registerModeSchema>;
export type LoginMethod = z.infer<typeof loginMethodSchema>;
export type CodeChannel = z.infer<typeof codeChannelSchema>;

export interface AccountConfig {
  registerModes: RegisterMode[];
  availability: Record<RegisterMode, boolean>;
  loginMethods: LoginMethod[];
  loginAvailability: Record<LoginMethod, boolean>;
  wechat: { enabled: boolean };
  captchaRequired: boolean;
}

export interface LoginInput {
  account: string;
  password: string;
  remember?: boolean;
}

export interface RegisterInput {
  mode: RegisterMode;
  username?: string;
  password: string;
  email?: string;
  phone?: string;
  code?: string;
  inviteCode?: string;
}

export interface WechatBindInput {
  ticket: string;
  remember?: boolean;
  account?: string;
  password?: string;
  channel?: CodeChannel;
  target?: string;
  code?: string;
}

const empty = apiEnvelope(z.null());
const result = apiEnvelope(z.unknown());
const accounts = apiEnvelope(
  z.array(
    z.object({
      username: z.string(),
      userId: z.string(),
      displayName: z.string(),
      role: z.string(),
    }),
  ),
);
const accountConfig = apiEnvelope(
  z.object({
    registerModes: z.array(registerModeSchema),
    availability: z.object({
      USERNAME: z.boolean(),
      EMAIL: z.boolean(),
      PHONE: z.boolean(),
    }),
    loginMethods: z.array(loginMethodSchema),
    loginAvailability: z.object({
      PASSWORD: z.boolean(),
      EMAIL_CODE: z.boolean(),
      SMS_CODE: z.boolean(),
      WECHAT: z.boolean(),
    }),
    wechat: z.object({ enabled: z.boolean() }),
    captchaRequired: z.boolean(),
  }),
);
const wechatAuthorize = apiEnvelope(
  z.object({ authorizeUrl: z.string(), redirectUri: z.string() }),
);

export const authApi = {
  /** 登录页配置：开启的注册方式 / 登录方式 + 各渠道可用性（微信只回开没开）。 */
  async accountConfig() {
    const value = (await http("/api/auth/account-config", accountConfig)).data.data;
    if (!value) throw new Error("登录配置未返回");
    return value;
  },
  async login(input: LoginInput) {
    await http("/api/auth/local/login", result, {
      method: "POST",
      body: {
        account: input.account.trim(),
        password: input.password,
        remember: input.remember === true,
      },
    });
  },
  async register(input: RegisterInput) {
    await http("/api/auth/local/register", result, {
      method: "POST",
      body: input,
    });
  },
  async sendRegisterCode(channel: CodeChannel, target: string) {
    await http("/api/auth/local/register-code", result, {
      method: "POST",
      body: { channel, target: target.trim() },
    });
  },
  async sendLoginCode(channel: CodeChannel, target: string) {
    await http("/api/auth/local/login-code", result, {
      method: "POST",
      body: { channel, target: target.trim() },
    });
  },
  async loginByCode(input: {
    channel: CodeChannel;
    target: string;
    code: string;
    remember?: boolean;
  }) {
    await http("/api/auth/local/login-by-code", result, {
      method: "POST",
      body: {
        channel: input.channel,
        target: input.target.trim(),
        code: input.code.trim(),
        remember: input.remember === true,
      },
    });
  },
  /** 微信扫码授权地址（一次性 state）；扫码结果由后端回调后 302 回登录页。 */
  async wechatAuthorize(next: string, remember: boolean) {
    const value = (
      await http("/api/auth/local/wechat/authorize", wechatAuthorize, {
        query: { next, remember: remember ? "1" : "0" },
      })
    ).data.data;
    if (!value) throw new Error("微信授权地址未返回");
    return value;
  },
  async wechatBind(input: WechatBindInput) {
    await http("/api/auth/local/wechat/bind", result, {
      method: "POST",
      body: {
        ticket: input.ticket,
        ...(input.account ? { account: input.account.trim() } : {}),
        ...(input.password ? { password: input.password } : {}),
        ...(input.channel ? { channel: input.channel } : {}),
        ...(input.target ? { target: input.target.trim() } : {}),
        ...(input.code ? { code: input.code.trim() } : {}),
        remember: input.remember === true,
      },
    });
  },
  async verifyPassword(password: string) {
    await http("/api/auth/verify-password", empty, {
      method: "POST",
      body: { password },
    });
  },
  async logout() {
    await http("/api/auth/logout", empty, { method: "POST" });
  },
  async devAccounts() {
    return (await http("/api/dev/accounts", accounts)).data.data;
  },
};
