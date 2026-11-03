import { apiEnvelope, z } from "@enterprise/contracts";
import { http, type HttpOptions } from "./http";

/**
 * 社交板块接口（M5）：开源版本地闭环能力，未纳入统一 contracts 生成表，
 * 直接用底层 http() 按 `/api/backend/enterprise/social/*` 路径调用。
 */
const BASE = "/api/backend/enterprise/social";

export interface PersonBrief {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
}
export interface ProfileData {
  person: PersonBrief;
  profile: {
    title: string;
    city: string;
    gender: string;
    bio: string;
    lang: string;
    contacts: Record<string, unknown>;
  };
}
export interface FriendRequestRow {
  id: number;
  from: PersonBrief;
  message: string;
  createdAt: string;
}
export interface PostRow {
  id: number;
  author: PersonBrief;
  body: string;
  visibility: string;
  createdAt: string;
}
export interface MyPostRow {
  id: number;
  body: string;
  visibility: string;
  createdAt: string;
}
export interface GroupRow {
  id: number;
  name: string;
  avatar: string;
  description: string;
  category: string;
  visibility: string;
  joinPolicy: string;
  memberCount: number;
  topicCount: number;
  pendingCount: number;
  joined: boolean;
  applying: boolean;
  myRole: string | null;
}
export interface GroupDetail {
  id: number;
  name: string;
  avatar: string;
  description: string;
  rules: string;
  category: string;
  visibility: string;
  joinPolicy: string;
  memberCount: number;
  topicCount: number;
  joined: boolean;
  applying: boolean;
  myRole: string | null;
  canManage: string | null;
  pendingCount: number;
}
export interface GroupMemberRow {
  id: number;
  userId: string;
  role: string;
  status: string;
  joinedAt: string;
  person: PersonBrief;
}
export interface TopicRow {
  id: number;
  author: PersonBrief;
  title: string;
  body: string;
  tag: string;
  anonymous: boolean;
  pinned: boolean;
  featured: boolean;
  likeCount: number;
  likedByMe: boolean;
  replyCount: number;
  canModerate: boolean;
  canDelete: boolean;
  createdAt: string;
}
export interface ReplyRow {
  id: number;
  floor: number;
  author: PersonBrief;
  body: string;
  anonymous: boolean;
  likeCount: number;
  likedByMe: boolean;
  canDelete: boolean;
  createdAt: string;
}
export interface ThreadRow {
  threadId: number;
  peer: PersonBrief;
  subject: string;
  lastMessageAt: string;
  unread: number;
}
export interface MessageRow {
  id: number;
  from: PersonBrief;
  toUserId: string;
  subject: string;
  body: string;
  linkCards: ResumeLinkCard[];
  createdAt: string;
}
/** 私信携带的卡片（后端 link_cards 列）：现阶段只有简历投递，点开即 HTML 简历页。 */
export interface ResumeLinkCard {
  kind: "RESUME";
  userId: string;
  name: string;
  headline: string;
  updatedAt: string;
}
export interface ResumeItemRow {
  id: number;
  kind: string;
  title: string;
  subtitle: string;
  startYear: number | null;
  endYear: number | null;
  description: string;
  url: string;
  sort: number;
}
export interface ResumeData {
  resume: {
    headline: string;
    location: string;
    summary: string;
    objectiveRole: string;
    objectiveCity: string;
    objectiveType: string;
    additional: string;
    contacts: Record<string, unknown>;
  };
  items: ResumeItemRow[];
}
/** 简历投递后的查看视图（HTML 打印版数据源）：本人或收到过投递的雇主可取。 */
export interface ResumeView extends ResumeData {
  person: PersonBrief;
  canManage: boolean;
  updatedAt: string;
}
// 供求广场（M6）
export interface ListingRow {
  id: number;
  author: PersonBrief;
  type: string;
  title: string;
  description: string;
  tags: string[];
  moneyMode: string | null;
  amountMin: number | null;
  amountMax: number | null;
  currency: string;
  province: string;
  city: string;
  contactNote: string;
  status: string;
  publishedUpstream: boolean;
  aiworkinListingNo: string;
  subcategoryId: string;
  category1: string;
  category2: string;
  createdAt: string;
  updatedAt: string;
}
export interface ListingCategoryOption {
  id: string;
  key: string;
  name: string;
  credentialTypes: string[];
  manualOnly: boolean;
}
export interface ListingCategoryModule {
  domain: string;
  moduleLabel: string;
  parentName: string;
  options: ListingCategoryOption[];
}

/** 信封 data 结构由调用处 TS 类型断言，这里只做宽松校验（开源本地接口无生成契约）。 */
async function call<T>(
  path: string,
  options: HttpOptions = {},
  extra?: HttpOptions,
): Promise<T> {
  const schema = apiEnvelope(z.unknown());
  const result = await http(path, schema, { ...options, ...extra });
  return result.data.data as T;
}

const enc = "application/json";
const withBody = (method: string, body: unknown): HttpOptions => ({
  method,
  headers: { "content-type": enc },
  body,
});

export const socialApi = {
  // 资料
  getProfile: (userId: string, o?: HttpOptions) =>
    call<ProfileData>(`${BASE}/profile/${userId}`, o),
  saveProfile: (body: Partial<ProfileData["profile"]>, o?: HttpOptions) =>
    call<ProfileData>(`${BASE}/profile`, withBody("PUT", body) as HttpOptions, o),
  // 好友 / 拉黑
  requestFriend: (toUserId: string, message: string, o?: HttpOptions) =>
    call<{ accepted: boolean; requestId: number }>(
      `${BASE}/friends/requests`,
      withBody("POST", { toUserId, message }) as HttpOptions,
      o,
    ),
  incomingRequests: (o?: HttpOptions) =>
    call<FriendRequestRow[]>(`${BASE}/friends/requests`, o),
  acceptFriend: (id: number, o?: HttpOptions) =>
    call<{ accepted: boolean; friendId?: string }>(
      `${BASE}/friends/requests/${id}/accept`,
      withBody("POST", {}) as HttpOptions,
      o,
    ),
  rejectFriend: (id: number, o?: HttpOptions) =>
    call<{ rejected: boolean }>(
      `${BASE}/friends/requests/${id}/reject`,
      withBody("POST", {}) as HttpOptions,
      o,
    ),
  listFriends: (o?: HttpOptions) => call<PersonBrief[]>(`${BASE}/friends`, o),
  removeFriend: (friendId: string, o?: HttpOptions) =>
    call<{ removed: boolean }>(
      `${BASE}/friends/${friendId}`,
      { method: "DELETE" } as HttpOptions,
      o,
    ),
  block: (userId: string, o?: HttpOptions) =>
    call<{ blocked: boolean }>(
      `${BASE}/blocks`,
      withBody("POST", { userId }) as HttpOptions,
      o,
    ),
  unblock: (userId: string, o?: HttpOptions) =>
    call<{ unblocked: boolean }>(
      `${BASE}/blocks/${userId}`,
      { method: "DELETE" } as HttpOptions,
      o,
    ),
  // 动态 / 信息流
  createPost: (body: string, visibility: "PUBLIC" | "FRIENDS", o?: HttpOptions) =>
    call<MyPostRow>(
      `${BASE}/posts`,
      withBody("POST", { body, visibility }) as HttpOptions,
      o,
    ),
  deletePost: (id: number, o?: HttpOptions) =>
    call<{ deleted: boolean }>(
      `${BASE}/posts/${id}`,
      { method: "DELETE" } as HttpOptions,
      o,
    ),
  feed: (o?: HttpOptions) => call<PostRow[]>(`${BASE}/feed`, o),
  myPosts: (o?: HttpOptions) => call<MyPostRow[]>(`${BASE}/posts/mine`, o),
  // 小组
  createGroup: (
    body: {
      name: string;
      description?: string;
      avatar?: string;
      rules?: string;
      category?: string;
      visibility?: string;
      joinPolicy?: string;
    },
    o?: HttpOptions,
  ) =>
    call<{ id: number; name: string; visibility: string; joinPolicy: string }>(
      `${BASE}/groups`,
      withBody("POST", body) as HttpOptions,
      o,
    ),
  listGroups: (
    params?: { scope?: "discover" | "mine"; keyword?: string; category?: string },
    o?: HttpOptions,
  ) => {
    const q = new URLSearchParams();
    if (params?.scope) q.set("scope", params.scope);
    if (params?.keyword) q.set("keyword", params.keyword);
    if (params?.category) q.set("category", params.category);
    const s = q.toString();
    return call<GroupRow[]>(`${BASE}/groups${s ? `?${s}` : ""}`, o);
  },
  getGroup: (id: number, o?: HttpOptions) => call<GroupDetail>(`${BASE}/groups/${id}`, o),
  updateGroup: (
    id: number,
    body: Partial<{
      name: string;
      avatar: string;
      description: string;
      rules: string;
      category: string;
      visibility: string;
      joinPolicy: string;
    }>,
    o?: HttpOptions,
  ) =>
    call<GroupDetail>(`${BASE}/groups/${id}`, withBody("PUT", body) as HttpOptions, o),
  joinGroup: (id: number, o?: HttpOptions) =>
    call<{ joined: boolean; status: string }>(
      `${BASE}/groups/${id}/join`,
      withBody("POST", {}) as HttpOptions,
      o,
    ),
  leaveGroup: (id: number, o?: HttpOptions) =>
    call<{ left: boolean }>(
      `${BASE}/groups/${id}/leave`,
      withBody("POST", {}) as HttpOptions,
      o,
    ),
  listMembers: (id: number, status = "ACTIVE", o?: HttpOptions) =>
    call<GroupMemberRow[]>(`${BASE}/groups/${id}/members?status=${status}`, o),
  reviewJoin: (id: number, memberId: number, approve: boolean, o?: HttpOptions) =>
    call<{ approved?: boolean; rejected?: boolean }>(
      `${BASE}/groups/${id}/requests/${memberId}/review`,
      withBody("POST", { approve }) as HttpOptions,
      o,
    ),
  setMemberRole: (id: number, userId: string, role: "ADMIN" | "MEMBER", o?: HttpOptions) =>
    call<{ role: string }>(
      `${BASE}/groups/${id}/members/${userId}/role`,
      withBody("PUT", { role }) as HttpOptions,
      o,
    ),
  removeMember: (id: number, userId: string, o?: HttpOptions) =>
    call<{ removed: boolean }>(
      `${BASE}/groups/${id}/members/${userId}`,
      { method: "DELETE" } as HttpOptions,
      o,
    ),
  createTopic: (
    groupId: number,
    body: { title: string; body: string; anonymous?: boolean; tag?: string },
    o?: HttpOptions,
  ) =>
    call<{ id: number; title: string }>(
      `${BASE}/groups/${groupId}/topics`,
      withBody("POST", body) as HttpOptions,
      o,
    ),
  listTopics: (
    groupId: number,
    params?: { featured?: boolean; tag?: string },
    o?: HttpOptions,
  ) => {
    const q = new URLSearchParams();
    if (params?.featured) q.set("featured", "1");
    if (params?.tag) q.set("tag", params.tag);
    const s = q.toString();
    return call<TopicRow[]>(`${BASE}/groups/${groupId}/topics${s ? `?${s}` : ""}`, o);
  },
  getTopic: (id: number, o?: HttpOptions) =>
    call<TopicRow & { groupId: number; groupName: string }>(`${BASE}/topics/${id}`, o),
  deleteTopic: (id: number, o?: HttpOptions) =>
    call<{ deleted: boolean }>(`${BASE}/topics/${id}`, { method: "DELETE" } as HttpOptions, o),
  setTopicFlags: (id: number, body: { pinned?: boolean; featured?: boolean }, o?: HttpOptions) =>
    call<{ id: number }>(`${BASE}/topics/${id}/flags`, withBody("POST", body) as HttpOptions, o),
  likeTopic: (id: number, o?: HttpOptions) =>
    call<{ liked: boolean; likeCount: number }>(
      `${BASE}/topics/${id}/like`,
      withBody("POST", {}) as HttpOptions,
      o,
    ),
  replyTopic: (
    topicId: number,
    body: { body: string; anonymous?: boolean },
    o?: HttpOptions,
  ) =>
    call<ReplyRow>(
      `${BASE}/topics/${topicId}/replies`,
      withBody("POST", body) as HttpOptions,
      o,
    ),
  listReplies: (topicId: number, o?: HttpOptions) =>
    call<ReplyRow[]>(`${BASE}/topics/${topicId}/replies`, o),
  deleteReply: (id: number, o?: HttpOptions) =>
    call<{ deleted: boolean }>(`${BASE}/replies/${id}`, { method: "DELETE" } as HttpOptions, o),
  likeReply: (id: number, o?: HttpOptions) =>
    call<{ liked: boolean; likeCount: number }>(
      `${BASE}/replies/${id}/like`,
      withBody("POST", {}) as HttpOptions,
      o,
    ),
  // 私信
  listThreads: (o?: HttpOptions) => call<ThreadRow[]>(`${BASE}/mail/threads`, o),
  threadMessages: (threadId: number, o?: HttpOptions) =>
    call<MessageRow[]>(`${BASE}/mail/threads/${threadId}/messages`, o),
  sendMail: (body: { toUserId: string; subject?: string; body: string }, o?: HttpOptions) =>
    call<{ id: number; threadId: number }>(
      `${BASE}/mail`,
      withBody("POST", body) as HttpOptions,
      o,
    ),
  /** 投递我的简历：往对方会话里发一条带简历卡片的私信。 */
  sendResume: (body: { toUserId: string; note?: string }, o?: HttpOptions) =>
    call<{ id: number; threadId: number; linkCards: ResumeLinkCard[] }>(
      `${BASE}/mail/resume`,
      withBody("POST", body) as HttpOptions,
      o,
    ),
  // 简历
  getResume: (o?: HttpOptions) => call<ResumeData>(`${BASE}/resume`, o),
  viewResume: (userId: string, o?: HttpOptions) =>
    call<ResumeView>(`${BASE}/resume/${encodeURIComponent(userId)}/view`, o),
  saveResume: (body: Partial<ResumeData["resume"]>, o?: HttpOptions) =>
    call<ResumeData>(`${BASE}/resume`, withBody("PUT", body) as HttpOptions, o),
  addResumeItem: (
    body: {
      kind: string;
      title: string;
      subtitle?: string;
      startYear?: number;
      endYear?: number;
      description?: string;
      url?: string;
      sort?: number;
    },
    o?: HttpOptions,
  ) =>
    call<{ id: number }>(
      `${BASE}/resume/items`,
      withBody("POST", body) as HttpOptions,
      o,
    ),
  deleteResumeItem: (id: number, o?: HttpOptions) =>
    call<{ deleted: boolean }>(
      `${BASE}/resume/items/${id}`,
      { method: "DELETE" } as HttpOptions,
      o,
    ),
  // 供求广场（M6）
  listingCategories: (o?: HttpOptions) =>
    call<ListingCategoryModule[]>(`${BASE}/listings/categories`, o),
  createListing: (
    body: {
      type: "DEMAND" | "SERVICE";
      title: string;
      description: string;
      tags?: string[];
      moneyMode?: string;
      amountMin?: number;
      amountMax?: number;
      province?: string;
      city?: string;
      contactNote?: string;
      subcategoryId?: string;
    },
    o?: HttpOptions,
  ) => call<ListingRow>(`${BASE}/listings`, withBody("POST", body) as HttpOptions, o),
  listListings: (
    params?: { type?: string; keyword?: string; take?: number },
    o?: HttpOptions,
  ) => {
    const q = new URLSearchParams();
    if (params?.type) q.set("type", params.type);
    if (params?.keyword) q.set("keyword", params.keyword);
    if (params?.take) q.set("take", String(params.take));
    const s = q.toString();
    return call<ListingRow[]>(`${BASE}/listings${s ? `?${s}` : ""}`, o);
  },
  myListings: (o?: HttpOptions) => call<ListingRow[]>(`${BASE}/listings/mine`, o),
  getListing: (id: number, o?: HttpOptions) => call<ListingRow>(`${BASE}/listings/${id}`, o),
  deleteListing: (id: number, o?: HttpOptions) =>
    call<{ deleted: boolean }>(
      `${BASE}/listings/${id}`,
      { method: "DELETE" } as HttpOptions,
      o,
    ),
  publishListingUpstream: (
    id: number,
    body: {
      deadline?: string;
      contactName?: string;
      contactPhone?: string;
      contactWechat?: string;
      contactEmail?: string;
      priceDescription?: string;
      serviceAreaMode?: string;
    },
    o?: HttpOptions,
  ) =>
    call<ListingRow>(
      `${BASE}/listings/${id}/publish-upstream`,
      withBody("POST", body) as HttpOptions,
      o,
    ),
  refreshListingStatus: (id: number, o?: HttpOptions) =>
    call<ListingRow>(
      `${BASE}/listings/${id}/refresh-status`,
      withBody("POST", {}) as HttpOptions,
      o,
    ),
};
