"use client";

import {
  ArrowRightOutlined,
  CheckOutlined,
  CopyOutlined,
  EnvironmentOutlined,
  HeartFilled,
  HeartOutlined,
  LeftOutlined,
  MailOutlined,
  PhoneOutlined,
  RightOutlined,
  SearchOutlined,
  ShopOutlined,
  StarOutlined,
  TeamOutlined,
  UserSwitchOutlined,
  WechatOutlined,
} from "@ant-design/icons";
import { App, Button, Input, Modal, Select, Spin } from "antd";
import { useMemo, useRef, useState } from "react";
import { ColumnSwitch, Notice, Panel } from "@/components/ui/panel";
import { useConnectionContact, useConnectionDictionaries, useConnectionFavorite, useConnectionResources } from "@/query/connections";
import { useLocationDictionary } from "@/query/locations";
import { useSession } from "@/lib/session";

/**
 * 达人建联：界面与筛选口径 1:1 对齐 AIworkin「建联资源」页
 * （四分类页签 / 搜索 + 更多筛选 + 已选条件 chips / 列表·卡片切换 / 分页 / 详情联系方式）。
 * 数据走后端 `enterprise/connections/*` 代理；失败明确显示原因并提供重试。
 */

type Category = "marketing" | "community" | "individual" | "company";
type ViewMode = "list" | "card";
type MarketingSort = "latest" | "followers" | "score";
type CommunitySort = "latest" | "members";

type ConnectionResource = {
  id: string;
  sourceType: "talent" | "association" | "profile";
  category: Category;
  name: string;
  headline?: string;
  description?: string;
  province?: string;
  city?: string;
  tags: string[];
  channel?: string;
  followers?: number;
  memberCount?: number;
  avgScore?: number;
  favorited?: boolean;
};

/** 文案：与 AIworkin connections 页逐字一致。 */
const t = {
  tabs: {
    marketing: "营销达人",
    community: "社群",
    individual: "个人",
    company: "企业",
  },
  searchPlaceholder: "搜索名称、简介、省份或城市",
  search: "搜索",
  total: "共计{count}",
  allProvinces: "不限省份",
  allCities: "不限城市",
  moreFilters: "更多筛选",
  hideFilters: "收起筛选",
  clearFilters: "清空筛选",
  selectedFilters: "已选筛选条件",
  platform: "运营平台",
  talentCategory: "达人类目",
  talentType: "达人类型",
  serviceScenario: "合作场景",
  identityType: "身份层级",
  associationType: "社群类型",
  businessCategory: "业务类目",
  minFollowers: "最少粉丝数",
  maxFollowers: "最多粉丝数",
  minMembers: "最少成员数",
  maxMembers: "最多成员数",
  minScore: "最低评分",
  anyScore: "不限评分",
  sort: "排序方式",
  latest: "最新发布",
  followersFirst: "粉丝最多",
  scoreFirst: "评分最高",
  membersFirst: "成员最多",
  details: "查看详情",
  viewLabel: "显示方式",
  listView: "列表",
  cardView: "卡片",
  detailsHint: "完整资料",
  detailsValue: "在详情中查看",
  followers: "粉丝",
  members: "成员",
  rating: "平均评分",
  noDescription: "暂未填写简介",
  empty: "没有找到符合条件的建联对象",
  loading: "正在加载建联资源…",
  loadFailed: "资源加载失败，请稍后重试。",
  retry: "重试",
  previous: "上一页",
  next: "下一页",
  perPage: "每页",
  detailTitle: "资源详情",
  detailDescription: "查看完整资料与可用联系方式。",
  contactSection: "联系方式",
  contactLoading: "正在获取联系方式…",
  noContact: "该资源暂未提供联系方式。",
  wechat: "微信",
  phone: "手机",
  email: "邮箱",
  copy: "复制",
  copied: "已复制",
  close: "关闭",
  needLogin: "请先登录后再查看联系方式。",
  favoriteFailed: "收藏操作失败",
} as const;

const CATEGORY_ORDER: Category[] = [
  "marketing",
  "community",
  "individual",
  "company",
];

const PAGE_SIZE_OPTIONS = [9, 18, 36];
const DEFAULT_PAGE_SIZE = 9;

/** 字典 code（与 AIworkin `dictionaries/:code/items` 一致）。 */
const DICTIONARY_CODES = {
  channels: "operation_platforms",
  talentCategories: "talent_categories",
  talentTypes: "talent_types",
  serviceScenarios: "talent_service_scenarios",
  identityTypes: "talent_identity_types",
  associationTypes: "association_types",
  marketCategories: "market_categories",
} as const;

const DICTIONARY_LABELS: Record<keyof typeof DICTIONARY_CODES, string> = {
  channels: t.platform,
  talentCategories: t.talentCategory,
  talentTypes: t.talentType,
  serviceScenarios: t.serviceScenario,
  identityTypes: t.identityType,
  associationTypes: t.associationType,
  marketCategories: t.businessCategory,
};

type MarketingFilters = {
  channels: string[];
  talentCategories: string[];
  talentTypes: string[];
  serviceScenarios: string[];
  identityTypes: string[];
  minFollowers: string;
  maxFollowers: string;
  minScore: string;
  sort: MarketingSort;
};

type CommunityFilters = {
  associationTypes: string[];
  categoryKeys: string[];
  minMembers: string;
  maxMembers: string;
  sort: CommunitySort;
};

const EMPTY_MARKETING: MarketingFilters = {
  channels: [],
  talentCategories: [],
  talentTypes: [],
  serviceScenarios: [],
  identityTypes: [],
  minFollowers: "",
  maxFollowers: "",
  minScore: "",
  sort: "latest",
};

const EMPTY_COMMUNITY: CommunityFilters = {
  associationTypes: [],
  categoryKeys: [],
  minMembers: "",
  maxMembers: "",
  sort: "latest",
};

export function ConnectionsTab() {
  const { message } = App.useApp();
  const { me } = useSession();
  const signedIn = Boolean(me);

  const [category, setCategory] = useState<Category>("marketing");
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [marketing, setMarketing] = useState<MarketingFilters>(EMPTY_MARKETING);
  const [community, setCommunity] = useState<CommunityFilters>(EMPTY_COMMUNITY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [viewMode, setViewMode] = useState<ViewMode>("card");
  const [filtersOpen, setFiltersOpen] = useState(true);

  const locationsQuery = useLocationDictionary();
  const dictionariesQuery = useConnectionDictionaries(DICTIONARY_CODES);
  const regions = locationsQuery.data ?? [];
  const options = dictionariesQuery.data?.options ?? {};
  const dictionaryIssues = dictionariesQuery.data?.issues ?? [];
  const filterError = locationsQuery.error?.message || dictionariesQuery.error?.message || (dictionaryIssues.length ? `筛选选项加载失败（${dictionaryIssues.map(issue => DICTIONARY_LABELS[issue.key as keyof typeof DICTIONARY_CODES]).join('、')}）：${dictionaryIssues[0].message}` : '');
  const favoriteMutation = useConnectionFavorite();
  const [favoritePending, setFavoritePending] = useState<Record<string, boolean>>(
    {},
  );
  const favoriteRequests = useRef(new Set<string>());

  const [detail, setDetail] = useState<ConnectionResource | null>(null);
  const contactQuery = useConnectionContact(detail);
  const contact = contactQuery.data;
  const contactLoading = contactQuery.isPending;
  const contactError = contactQuery.error?.message;
  const [copied, setCopied] = useState("");

  const requestQuery = useMemo(() => {
    const params: Record<string,string|string[]> = {category,page:String(page),pageSize:String(pageSize)};
    const put = (key: string, value: string) => {
      if (value) params[key] = value;
    };
    const putAll = (key: string, values: string[]) => {
      if(values.length) params[key] = values;
    };
    put("keyword", keyword);
    put("province", province);
    put("city", city);
    if (category === "marketing") {
      putAll("channel", marketing.channels);
      putAll("talentCategory", marketing.talentCategories);
      putAll("talentType", marketing.talentTypes);
      putAll("serviceScenario", marketing.serviceScenarios);
      putAll("identityType", marketing.identityTypes);
      put("minFollowers", marketing.minFollowers);
      put("maxFollowers", marketing.maxFollowers);
      put("minScore", marketing.minScore);
      params.sort = marketing.sort;
    }
    if (category === "community") {
      putAll("associationType", community.associationTypes);
      putAll("categoryKey", community.categoryKeys);
      put("minMembers", community.minMembers);
      put("maxMembers", community.maxMembers);
      params.sort = community.sort;
    }
    return params;
  }, [category, city, community, keyword, marketing, page, pageSize, province]);

  const resourcesQuery = useConnectionResources(requestQuery);
  const list = (resourcesQuery.data?.list ?? []).map(normalizeResource);
  const total = resourcesQuery.data?.total ?? 0;
  const loading = resourcesQuery.isPending;
  const loadError = resourcesQuery.error?.message;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const totals:Partial<Record<Category,number>> = resourcesQuery.data ? {[category]:total} : {};

  const toggleFavorite = async (resource: ConnectionResource) => {
    if (!signedIn) {
      message.warning(t.needLogin);
      return;
    }
    const key = `${resource.sourceType}:${resource.id}`;
    if (favoriteRequests.current.has(key)) return;
    favoriteRequests.current.add(key);
    setFavoritePending((current) => ({ ...current, [key]: true }));
    const next = !resource.favorited;
    try {
      await favoriteMutation.mutateAsync({id:resource.id,sourceType:resource.sourceType,favorite:next});
    } catch {
      // 操作错误由统一 Mutation Hook 呈现。
    } finally {
      favoriteRequests.current.delete(key);
      setFavoritePending((current) => {
        const remaining = { ...current };
        delete remaining[key];
        return remaining;
      });
    }
  };

  const openDetails = (resource: ConnectionResource) => {
    if (detailsRequireLogin(resource.category) && !signedIn) {
      message.warning(t.needLogin);
      return;
    }
    setDetail(resource);
    setCopied('');
  };

  const copyContact = async (field: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(field);
      window.setTimeout(() => setCopied(""), 1800);
    } catch {
      setCopied("");
    }
  };

  const updateCommon = (patch: {
    keyword?: string;
    province?: string;
    city?: string;
  }) => {
    if (patch.keyword !== undefined) {
      setKeywordInput(patch.keyword);
      setKeyword(patch.keyword);
    }
    if (patch.province !== undefined) setProvince(patch.province);
    if (patch.city !== undefined) setCity(patch.city);
    setPage(1);
  };

  const updateMarketing = (patch: Partial<MarketingFilters>) => {
    setMarketing((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const updateCommunity = (patch: Partial<CommunityFilters>) => {
    setCommunity((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  const switchCategory = (next: Category) => {
    if (next === category) return;
    setCategory(next);
    setPage(1);
  };

  const clearFilters = () => {
    setKeywordInput("");
    setKeyword("");
    setProvince("");
    setCity("");
    if (category === "marketing") setMarketing(EMPTY_MARKETING);
    if (category === "community") setCommunity(EMPTY_COMMUNITY);
    setPage(1);
  };

  const dictOptions = (key: keyof typeof DICTIONARY_CODES) =>
    (options[key] || []).map((item) => ({
      value: item.key,
      label: item.label,
    }));

  const cities = regions.find((region) => region.value === province)?.children || [];

  const buildChips = () => {
    const items: { key: string; label: string; onRemove: () => void }[] = [];
    if (keyword) {
      items.push({
        key: "keyword",
        label: `关键词：${keyword}`,
        onRemove: () => updateCommon({ keyword: "" }),
      });
    }
    if (province) {
      items.push({
        key: "province",
        label: province,
        onRemove: () => updateCommon({ province: "", city: "" }),
      });
    }
    if (city) {
      items.push({
        key: "city",
        label: city,
        onRemove: () => updateCommon({ city: "" }),
      });
    }
    const labelOf = (key: keyof typeof DICTIONARY_CODES, value: string) =>
      (options[key] || []).find((item) => item.key === value)?.label || value;
    if (category === "marketing") {
      const groups: [string, keyof typeof DICTIONARY_CODES, string[]][] = [
        [t.platform, "channels", marketing.channels],
        [t.talentCategory, "talentCategories", marketing.talentCategories],
        [t.talentType, "talentTypes", marketing.talentTypes],
        [t.serviceScenario, "serviceScenarios", marketing.serviceScenarios],
        [t.identityType, "identityTypes", marketing.identityTypes],
      ];
      for (const [label, key, values] of groups) {
        values.forEach((value) =>
          items.push({
            key: `${key}:${value}`,
            label: `${label}：${labelOf(key, value)}`,
            onRemove: () =>
              updateMarketing({
                [key]: values.filter((item) => item !== value),
              } as Partial<MarketingFilters>),
          }),
        );
      }
      if (marketing.minFollowers) {
        items.push({
          key: "minFollowers",
          label: `${t.minFollowers}：${marketing.minFollowers}`,
          onRemove: () => updateMarketing({ minFollowers: "" }),
        });
      }
      if (marketing.maxFollowers) {
        items.push({
          key: "maxFollowers",
          label: `${t.maxFollowers}：${marketing.maxFollowers}`,
          onRemove: () => updateMarketing({ maxFollowers: "" }),
        });
      }
      if (marketing.minScore) {
        items.push({
          key: "minScore",
          label: `${t.minScore}：${marketing.minScore}.0+`,
          onRemove: () => updateMarketing({ minScore: "" }),
        });
      }
    }
    if (category === "community") {
      community.associationTypes.forEach((value) =>
        items.push({
          key: `associationTypes:${value}`,
          label: `${t.associationType}：${labelOf("associationTypes", value)}`,
          onRemove: () =>
            updateCommunity({
              associationTypes: community.associationTypes.filter(
                (item) => item !== value,
              ),
            }),
        }),
      );
      community.categoryKeys.forEach((value) =>
        items.push({
          key: `categoryKeys:${value}`,
          label: `${t.businessCategory}：${labelOf("marketCategories", value)}`,
          onRemove: () =>
            updateCommunity({
              categoryKeys: community.categoryKeys.filter(
                (item) => item !== value,
              ),
            }),
        }),
      );
      if (community.minMembers) {
        items.push({
          key: "minMembers",
          label: `${t.minMembers}：${community.minMembers}`,
          onRemove: () => updateCommunity({ minMembers: "" }),
        });
      }
      if (community.maxMembers) {
        items.push({
          key: "maxMembers",
          label: `${t.maxMembers}：${community.maxMembers}`,
          onRemove: () => updateCommunity({ maxMembers: "" }),
        });
      }
    }
    return items;
  };
  const chips = buildChips();

  const pageItems = paginationItems(page, totalPages);
  const TabIcon = tabIcons[category];

  return (
    <>
      <Panel title="达人建联（建联资源）">
        <ColumnSwitch
          value={category}
          onChange={(value) => switchCategory(value as Category)}
          options={CATEGORY_ORDER.map((item) => ({
            value: item,
            label:
              totals[item] != null
                ? `${t.tabs[item]}（${totals[item]}）`
                : t.tabs[item],
          }))}
        />

        {filterError ? (
          <div role="alert">
            <Notice variant="warn">
              <p>{filterError}</p>
              <Button onClick={() => { void locationsQuery.refetch(); void dictionariesQuery.refetch(); }}>
                重试筛选选项
              </Button>
            </Notice>
          </div>
        ) : null}

        <form
          className="conn-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            updateCommon({ keyword: keywordInput.trim() });
          }}
        >
          <div className="conn-search-row">
            <Input
              allowClear
              prefix={<SearchOutlined />}
              value={keywordInput}
              placeholder={t.searchPlaceholder}
              onChange={(event) => setKeywordInput(event.target.value)}
              onPressEnter={() => updateCommon({ keyword: keywordInput.trim() })}
            />
            <Button type="primary" htmlType="submit">
              {t.search}
            </Button>
            <Button onClick={() => setFiltersOpen((current) => !current)}>
              {filtersOpen ? t.hideFilters : t.moreFilters}
              {chips.length ? `（${chips.length}）` : ""}
            </Button>
            {chips.length ? (
              <Button type="text" onClick={clearFilters}>
                {t.clearFilters}
              </Button>
            ) : null}
          </div>

          {filtersOpen ? (
            <div className="conn-filters">
              <label className="conn-field">
                <span>{t.allProvinces}</span>
                <Select
                  value={province || undefined}
                  placeholder={t.allProvinces}
                  allowClear
                  options={regions.map((region) => ({
                    value: region.value,
                    label: region.label,
                  }))}
                  onChange={(value) =>
                    updateCommon({ province: value || "", city: "" })
                  }
                />
              </label>
              <label className="conn-field">
                <span>{t.allCities}</span>
                <Select
                  value={city || undefined}
                  placeholder={t.allCities}
                  allowClear
                  disabled={!province}
                  options={cities.map((item) => ({
                    value: item.value,
                    label: item.label,
                  }))}
                  onChange={(value) => updateCommon({ city: value || "" })}
                />
              </label>

              {category === "marketing" ? (
                <>
                  <MultiField
                    label={t.platform}
                    options={dictOptions("channels")}
                    value={marketing.channels}
                    onChange={(channels) => updateMarketing({ channels })}
                  />
                  <MultiField
                    label={t.talentCategory}
                    options={dictOptions("talentCategories")}
                    value={marketing.talentCategories}
                    onChange={(talentCategories) =>
                      updateMarketing({ talentCategories })
                    }
                  />
                  <MultiField
                    label={t.talentType}
                    options={dictOptions("talentTypes")}
                    value={marketing.talentTypes}
                    onChange={(talentTypes) => updateMarketing({ talentTypes })}
                  />
                  <MultiField
                    label={t.serviceScenario}
                    options={dictOptions("serviceScenarios")}
                    value={marketing.serviceScenarios}
                    onChange={(serviceScenarios) =>
                      updateMarketing({ serviceScenarios })
                    }
                  />
                  <MultiField
                    label={t.identityType}
                    options={dictOptions("identityTypes")}
                    value={marketing.identityTypes}
                    onChange={(identityTypes) =>
                      updateMarketing({ identityTypes })
                    }
                  />
                  <NumberRange
                    minLabel={t.minFollowers}
                    maxLabel={t.maxFollowers}
                    minValue={marketing.minFollowers}
                    maxValue={marketing.maxFollowers}
                    onMinChange={(minFollowers) =>
                      updateMarketing({ minFollowers })
                    }
                    onMaxChange={(maxFollowers) =>
                      updateMarketing({ maxFollowers })
                    }
                  />
                  <label className="conn-field">
                    <span>{t.minScore}</span>
                    <Select
                      value={marketing.minScore || undefined}
                      placeholder={t.anyScore}
                      allowClear
                      options={[
                        { value: "3", label: "3.0+" },
                        { value: "4", label: "4.0+" },
                        { value: "4.5", label: "4.5+" },
                      ]}
                      onChange={(value) =>
                        updateMarketing({ minScore: value || "" })
                      }
                    />
                  </label>
                  <label className="conn-field">
                    <span>{t.sort}</span>
                    <Select
                      value={marketing.sort}
                      options={[
                        { value: "latest", label: t.latest },
                        { value: "followers", label: t.followersFirst },
                        { value: "score", label: t.scoreFirst },
                      ]}
                      onChange={(value) =>
                        updateMarketing({ sort: value as MarketingSort })
                      }
                    />
                  </label>
                </>
              ) : null}

              {category === "community" ? (
                <>
                  <MultiField
                    label={t.associationType}
                    options={dictOptions("associationTypes")}
                    value={community.associationTypes}
                    onChange={(associationTypes) =>
                      updateCommunity({ associationTypes })
                    }
                  />
                  <MultiField
                    label={t.businessCategory}
                    options={dictOptions("marketCategories")}
                    value={community.categoryKeys}
                    onChange={(categoryKeys) => updateCommunity({ categoryKeys })}
                  />
                  <NumberRange
                    minLabel={t.minMembers}
                    maxLabel={t.maxMembers}
                    minValue={community.minMembers}
                    maxValue={community.maxMembers}
                    onMinChange={(minMembers) =>
                      updateCommunity({ minMembers })
                    }
                    onMaxChange={(maxMembers) =>
                      updateCommunity({ maxMembers })
                    }
                  />
                  <label className="conn-field">
                    <span>{t.sort}</span>
                    <Select
                      value={community.sort}
                      options={[
                        { value: "latest", label: t.latest },
                        { value: "members", label: t.membersFirst },
                      ]}
                      onChange={(value) =>
                        updateCommunity({ sort: value as CommunitySort })
                      }
                    />
                  </label>
                </>
              ) : null}
            </div>
          ) : null}

          {chips.length ? (
            <div className="conn-chips" aria-label={t.selectedFilters}>
              {chips.map((chip) => (
                <button key={chip.key} type="button" onClick={chip.onRemove}>
                  {chip.label}
                  <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
          ) : null}
        </form>

        {loadError ? (
          <div className="conn-state" role="alert">
            <p>{loadError}</p>
            <Button
              onClick={() => {
                void resourcesQuery.refetch();
              }}
            >
              {t.retry}
            </Button>
          </div>
        ) : loading ? (
          <div className="conn-state" aria-live="polite">
            <Spin />
            <p>{t.loading}</p>
          </div>
        ) : list.length ? (
          <div className={viewMode === "list" ? "conn-list" : "conn-grid"}>
            {list.map((resource) =>
              viewMode === "list" ? (
                <ResourceListItem
                  key={`${resource.sourceType}:${resource.id}`}
                  resource={resource}
                  favoritePending={Boolean(
                    favoritePending[`${resource.sourceType}:${resource.id}`],
                  )}
                  onDetails={() => void openDetails(resource)}
                  onFavorite={() => void toggleFavorite(resource)}
                  signedIn={signedIn}
                />
              ) : (
                <ResourceCard
                  key={`${resource.sourceType}:${resource.id}`}
                  resource={resource}
                  favoritePending={Boolean(
                    favoritePending[`${resource.sourceType}:${resource.id}`],
                  )}
                  onDetails={() => void openDetails(resource)}
                  onFavorite={() => void toggleFavorite(resource)}
                  signedIn={signedIn}
                />
              ),
            )}
          </div>
        ) : (
          <div className="conn-state">
            <TabIcon className="conn-state-icon" />
            <p>{t.empty}</p>
          </div>
        )}

        <div className="conn-footer">
          <div className="conn-footer-left">
            <span className="conn-count">
              {loadError
                ? "资源数量暂不可用"
                : t.total.replace("{count}", String(total))}
            </span>
            <div className="conn-view" role="group" aria-label={t.viewLabel}>
              <button
                type="button"
                aria-pressed={viewMode === "list"}
                className={viewMode === "list" ? "is-active" : undefined}
                onClick={() => setViewMode("list")}
              >
                {t.listView}
              </button>
              <button
                type="button"
                aria-pressed={viewMode === "card"}
                className={viewMode === "card" ? "is-active" : undefined}
                onClick={() => setViewMode("card")}
              >
                {t.cardView}
              </button>
            </div>
          </div>

          {!loadError ? (
            <div className="conn-pager">
              <span className="conn-page-size">
                {t.perPage}
                <Select
                  size="small"
                  value={pageSize}
                  style={{ width: 72 }}
                  disabled={loading}
                  options={PAGE_SIZE_OPTIONS.map((size) => ({
                    value: size,
                    label: String(size),
                  }))}
                  onChange={(value) => {
                    setPageSize(value);
                    setPage(1);
                  }}
                />
              </span>
              <div className="conn-pages">
                <button
                  type="button"
                  disabled={loading || page <= 1}
                  onClick={() => setPage(Math.max(1, page - 1))}
                >
                  <LeftOutlined />
                  {t.previous}
                </button>
                {pageItems.map((item, index) =>
                  item === "ellipsis" ? (
                    <span key={`ellipsis-${index}`} className="conn-ellipsis">
                      …
                    </span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      disabled={loading}
                      className={item === page ? "is-active" : undefined}
                      onClick={() => setPage(item)}
                    >
                      {item}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  disabled={loading || page >= totalPages}
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                >
                  {t.next}
                  <RightOutlined />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </Panel>

      <Modal
        open={Boolean(detail)}
        title={t.detailTitle}
        width={640}
        onCancel={() => setDetail(null)}
        footer={
          <Button onClick={() => setDetail(null)}>{t.close}</Button>
        }
      >
        {detail ? (
          <>
            <p className="text-12 muted" style={{ marginTop: 0 }}>
              {detail.name} · {t.detailDescription}
            </p>
            <DetailSummary resource={detail} />
            <section className="conn-contact">
              <h4>{t.contactSection}</h4>
              {contactLoading ? (
                <div className="conn-state" aria-live="polite">
                  <Spin />
                  <p>{t.contactLoading}</p>
                </div>
              ) : contactError ? (
                <div className="conn-state" role="alert">
                  <p>{contactError}</p>
                </div>
              ) : contact && (contact.wechat || contact.phone || contact.email) ? (
                <>
                  {contact.wechat ? (
                    <ContactRow
                      icon={<WechatOutlined />}
                      label={t.wechat}
                      value={contact.wechat}
                      copied={copied === "wechat"}
                      onCopy={() => void copyContact("wechat", contact.wechat!)}
                    />
                  ) : null}
                  {contact.phone ? (
                    <ContactRow
                      icon={<PhoneOutlined />}
                      label={t.phone}
                      value={contact.phone}
                      copied={copied === "phone"}
                      onCopy={() => void copyContact("phone", contact.phone!)}
                    />
                  ) : null}
                  {contact.email ? (
                    <ContactRow
                      icon={<MailOutlined />}
                      label={t.email}
                      value={contact.email}
                      copied={copied === "email"}
                      onCopy={() => void copyContact("email", contact.email!)}
                    />
                  ) : null}
                </>
              ) : (
                <p className="text-12 muted">{t.noContact}</p>
              )}
            </section>
          </>
        ) : null}
      </Modal>
    </>
  );
}

function MultiField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string[];
  options: { value: string; label: string }[];
  onChange: (value: string[]) => void;
}) {
  return (
    <label className="conn-field">
      <span>{label}</span>
      <Select
        mode="multiple"
        value={value}
        placeholder={label}
        options={options}
        maxTagCount="responsive"
        onChange={(next) => onChange(next as string[])}
      />
    </label>
  );
}

function NumberRange({
  minLabel,
  maxLabel,
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
}: {
  minLabel: string;
  maxLabel: string;
  minValue: string;
  maxValue: string;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
}) {
  return (
    <div className="conn-field">
      <span>
        {minLabel} / {maxLabel}
      </span>
      <div className="conn-range">
        <Input
          inputMode="numeric"
          value={minValue}
          placeholder={minLabel}
          onChange={(event) => onMinChange(digits(event.target.value))}
        />
        <Input
          inputMode="numeric"
          value={maxValue}
          placeholder={maxLabel}
          onChange={(event) => onMaxChange(digits(event.target.value))}
        />
      </div>
    </div>
  );
}

function ContactRow({
  icon,
  label,
  value,
  copied,
  onCopy,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="conn-contact-row">
      <span className="conn-contact-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <Button onClick={onCopy}>
        {copied ? <CheckOutlined /> : <CopyOutlined />}
        {copied ? t.copied : t.copy}
      </Button>
    </div>
  );
}

function DetailSummary({ resource }: { resource: ConnectionResource }) {
  const location = resourceLocation(resource);
  const audience = resourceAudience(resource);
  const identity = [resource.channel, audience].filter(Boolean).join(" · ");
  return (
    <section className="conn-summary">
      <div className="conn-summary-head">
        <span className="conn-avatar" data-accent={accentFor(resource.id)}>
          {initialsFor(resource.name)}
        </span>
        <div>
          <h3>{resource.name}</h3>
          {resource.headline ? <p>{resource.headline}</p> : null}
        </div>
      </div>
      <div className="conn-summary-meta">
        {identity ? <strong>{identity}</strong> : null}
        {location ? (
          <span>
            <EnvironmentOutlined /> {location}
          </span>
        ) : null}
      </div>
      <p className="conn-summary-desc">
        {resource.description || t.noDescription}
      </p>
      {resource.tags.length ? (
        <div className="conn-tags">
          {resource.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ResourceListItem({
  resource,
  favoritePending,
  signedIn,
  onDetails,
  onFavorite,
}: {
  resource: ConnectionResource;
  favoritePending: boolean;
  signedIn: boolean;
  onDetails: () => void;
  onFavorite: () => void;
}) {
  const location = resourceLocation(resource);
  const audience = resourceAudience(resource);
  const rating =
    resource.avgScore && resource.avgScore > 0
      ? `${t.rating} ${resource.avgScore.toFixed(1)}`
      : "";
  const showDetails = !detailsRequireLogin(resource.category) || signedIn;
  const favoriteKind = favoriteKindForResource(resource);

  return (
    <article className="conn-list-item">
      <div className="conn-identity">
        <span className="conn-avatar" data-accent={accentFor(resource.id)}>
          {initialsFor(resource.name)}
        </span>
        <div className="conn-person">
          <h3>{resource.name}</h3>
          <p>{resource.headline || resource.tags.join(" · ")}</p>
        </div>
      </div>
      <span className="conn-category">
        <CategoryIcon category={resource.category} />
        {t.tabs[resource.category]}
      </span>
      <div className="conn-profile">
        <p>{resource.description || t.noDescription}</p>
        {resource.tags.length ? (
          <div className="conn-tags">
            {resource.tags.slice(0, 4).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="conn-meta">
        {location ? (
          <span>
            <EnvironmentOutlined /> {location}
          </span>
        ) : null}
        {audience ? <strong>{audience}</strong> : null}
        {rating ? <small>{rating}</small> : null}
      </div>
      {showDetails || favoriteKind ? (
        <div className="conn-actions">
          {favoriteKind ? (
            <FavoriteButton
              kind={favoriteKind}
              favorited={Boolean(resource.favorited)}
              pending={favoritePending}
              onToggle={onFavorite}
              compact
            />
          ) : null}
          {showDetails ? (
            <Button type="primary" onClick={onDetails}>
              {t.details}
              <ArrowRightOutlined />
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function ResourceCard({
  resource,
  favoritePending,
  signedIn,
  onDetails,
  onFavorite,
}: {
  resource: ConnectionResource;
  favoritePending: boolean;
  signedIn: boolean;
  onDetails: () => void;
  onFavorite: () => void;
}) {
  const location = resourceLocation(resource);
  const audience = resourceAudience(resource);
  const metric =
    resource.avgScore && resource.avgScore > 0
      ? `${t.rating} ${resource.avgScore.toFixed(1)}`
      : audience;
  const loginGated = detailsRequireLogin(resource.category);
  const showDetailsHint = !loginGated;
  const showDetails = !loginGated || signedIn;
  const favoriteKind = favoriteKindForResource(resource);

  return (
    <article className="conn-card">
      <div className="conn-card-top">
        <div className="conn-identity">
          <span className="conn-avatar" data-accent={accentFor(resource.id)}>
            {initialsFor(resource.name)}
          </span>
          <div className="conn-person">
            <h3>{resource.name}</h3>
            <p>{resource.headline || resource.tags.join(" · ")}</p>
          </div>
        </div>
        <span className="conn-category">
          <CategoryIcon category={resource.category} />
          {t.tabs[resource.category]}
        </span>
      </div>

      {audience ? <p className="conn-identity-line">{audience}</p> : null}
      <p className="conn-desc">{resource.description || t.noDescription}</p>
      {resource.tags.length ? (
        <div className="conn-tags">
          {resource.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}
      {location || metric ? (
        <dl className="conn-facts">
          <div>
            <dt>
              <EnvironmentOutlined /> {location || "—"}
            </dt>
            {metric ? <dd>{metric}</dd> : null}
          </div>
        </dl>
      ) : null}

      {showDetailsHint || showDetails || favoriteKind ? (
        <div className="conn-card-footer">
          {showDetailsHint ? (
            <div>
              <span>{t.detailsHint}</span>
              <strong>{t.detailsValue}</strong>
            </div>
          ) : null}
          {showDetails || favoriteKind ? (
            <span className="conn-actions">
              {favoriteKind ? (
                <FavoriteButton
                  kind={favoriteKind}
                  favorited={Boolean(resource.favorited)}
                  pending={favoritePending}
                  onToggle={onFavorite}
                />
              ) : null}
              {showDetails ? (
                <Button type="primary" onClick={onDetails}>
                  {t.details}
                  <ArrowRightOutlined />
                </Button>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function FavoriteButton({
  kind,
  favorited,
  pending,
  compact,
  onToggle,
}: {
  kind: "personal" | "company" | "marketing";
  favorited: boolean;
  pending: boolean;
  compact?: boolean;
  onToggle: () => void;
}) {
  const label = favorited
    ? "已收藏"
    : kind === "personal"
      ? "收藏个人"
      : kind === "marketing"
        ? "收藏达人"
        : "收藏企业";
  return (
    <Button
      aria-pressed={favorited}
      aria-label={label}
      title={label}
      loading={pending}
      disabled={pending}
      aria-busy={pending}
      onClick={onToggle}
    >
      {favorited ? <HeartFilled /> : <HeartOutlined />}
      {compact ? null : label}
    </Button>
  );
}

function CategoryIcon({ category }: { category: Category }) {
  const Icon = tabIcons[category];
  return <Icon />;
}

const tabIcons: Record<Category, typeof UserSwitchOutlined> = {
  marketing: UserSwitchOutlined,
  community: TeamOutlined,
  individual: StarOutlined,
  company: ShopOutlined,
};

function detailsRequireLogin(category: Category) {
  return category === "marketing" || category === "community";
}

function resourceLocation(resource: ConnectionResource) {
  return [resource.province, resource.city]
    .filter((item, index, values) => item && values.indexOf(item) === index)
    .join(" · ");
}

function resourceAudience(resource: ConnectionResource) {
  if (resource.category === "marketing" && resource.followers != null) {
    return `${formatNumber(resource.followers)} ${t.followers}`;
  }
  if (resource.memberCount != null) {
    return `${formatNumber(resource.memberCount)} ${t.members}`;
  }
  return "";
}

function favoriteKindForResource(
  resource: ConnectionResource,
): "personal" | "company" | "marketing" | null {
  if (resource.category === "individual") return "personal";
  if (resource.category === "company") return "company";
  if (resource.category === "marketing") return "marketing";
  return null;
}

function initialsFor(name: string) {
  const compact = name.replace(/\s+/g, "");
  return Array.from(compact).slice(0, 3).join("").toUpperCase();
}

function accentFor(id: string) {
  const accents = ["blue", "violet", "teal", "orange"];
  const total = Array.from(id).reduce(
    (sum, character) => sum + (character.codePointAt(0) || 0),
    0,
  );
  return accents[total % accents.length];
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: value >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function paginationItems(page: number, pageCount: number) {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  const items: (number | "ellipsis")[] = [1];
  const start = Math.max(2, Math.min(page - 1, pageCount - 2));
  const end = Math.min(pageCount - 1, page + 1);
  if (start > 2) items.push("ellipsis");
  for (let item = start; item <= end; item += 1) items.push(item);
  if (end < pageCount - 1) items.push("ellipsis");
  items.push(pageCount);
  return items;
}

function digits(value: string) {
  return value.replace(/[^\d]/g, "");
}

/** 外部接口边界归一：AIworkin 返回的字段可能缺省。 */
function normalizeResource(raw: Record<string, unknown>): ConnectionResource {
  return {
    id: String(raw.id ?? ""),
    sourceType:
      raw.sourceType === "talent" || raw.sourceType === "association" ? raw.sourceType : "profile",
    category: raw.category === "community" || raw.category === "individual" || raw.category === "company" ? raw.category : "marketing",
    name: String(raw.name ?? ""),
    headline: raw.headline ? String(raw.headline) : undefined,
    description: raw.description ? String(raw.description) : undefined,
    province: raw.province ? String(raw.province) : undefined,
    city: raw.city ? String(raw.city) : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.map((tag) => String(tag)) : [],
    channel: raw.channel ? String(raw.channel) : undefined,
    followers: toNumber(raw.followers),
    memberCount: toNumber(raw.memberCount),
    avgScore: toNumber(raw.avgScore),
    favorited: Boolean(raw.favorited),
  };
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
