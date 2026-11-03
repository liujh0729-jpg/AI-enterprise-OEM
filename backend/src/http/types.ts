import type { CurrentUser } from '../auth/current-user';
export type ApiEnv = {
  Variables: { user?: CurrentUser; accessToken?: string; requestId: string };
};
