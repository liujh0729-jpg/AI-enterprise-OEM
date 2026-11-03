import {
  apiEnvelope,
  loginSchema,
  registerSchema,
  safeNextPath,
  z,
} from "@enterprise/contracts";
import { http } from "./http";
const empty = apiEnvelope(z.null());
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
export const authApi = {
  async login(input: z.input<typeof loginSchema>, next = "/") {
    const result = await http("/api/auth/login", empty, {
      method: "POST",
      body: loginSchema.parse(input),
      query: { next },
    });
    return safeNextPath(result.headers.get("x-login-next"), next);
  },
  async register(input: z.input<typeof registerSchema>) {
    await http("/api/auth/register", empty, {
      method: "POST",
      body: registerSchema.parse(input),
    });
  },
  async sendEmailCode(email: string) {
    await http("/api/auth/email-code", empty, {
      method: "POST",
      body: { email, scene: "REGISTER" },
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
