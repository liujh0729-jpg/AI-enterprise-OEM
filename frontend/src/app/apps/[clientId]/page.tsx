"use client";

import { ArrowLeftOutlined, ExportOutlined } from "@ant-design/icons";
import {
  Button,
  Empty,
  Pagination,
  Rate,
  Result,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@enterprise/contracts";
import { appsApi } from "@/api/apps";
import { Notice, PageHero, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";

const REVIEW_PAGE_SIZE = 10;

type AppDetail = {
  clientId: string;
  name: string;
  description: string;
  category: string;
  scopes: string[];
  homepageUrl: string;
  publishedAt: string | null;
};

type AppReview = {
  id: string;
  author: string;
  rating: number;
  content: string;
  createdAt: string | null;
};

type ReviewPage = {
  list: AppReview[];
  total: number;
  page: number;
  pageSize: number;
  avgRating: number;
  reviewCount: number;
};

/** 应用详情：介绍与用户评价都来自外部目录，本站不提供编辑与评价入口。 */
export default function AppDetailPage() {
  const router = useRouter();
  const params = useParams<{ clientId?: string }>();
  const clientId = String(params?.clientId || "");
  const [app, setApp] = useState<AppDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<ReviewPage | null>(null);
  const [reviewsError, setReviewsError] = useState("");
  const [reviewPage, setReviewPage] = useState(1);

  const load = useCallback(() => {
    if (!clientId) {
      setMissing(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    appsApi
      .detail({ params: { clientId } })
      .then((data) => {
        setApp(data);
        setMissing(false);
        setError("");
      })
      .catch((caught: unknown) => {
        setApp(null);
        setMissing(caught instanceof ApiError && caught.status === 404);
        setError(
          caught instanceof ApiError && caught.status === 404
            ? ""
            : caught instanceof Error
              ? caught.message
              : "应用详情读取失败",
        );
      })
      .finally(() => setLoading(false));
  }, [clientId]);

  // 评价是另一路上游数据：拉不到只提示这一块，不该把详情页变成 404。
  const loadReviews = useCallback(() => {
    if (!clientId) return;
    appsApi
      .reviews({
        params: { clientId },
        query: { page: reviewPage, pageSize: REVIEW_PAGE_SIZE },
      })
      .then((data) => {
        setReviews(data);
        setReviewsError("");
      })
      .catch((caught: unknown) => {
        setReviews(null);
        setReviewsError(
          caught instanceof Error ? caught.message : "评价读取失败",
        );
      });
  }, [clientId, reviewPage]);

  useEffect(load, [load]);
  useEffect(loadReviews, [loadReviews]);

  if (loading) {
    return (
      <>
        <PageHero title="应用详情" desc="条目来自外部应用目录，本站只做展示。" />
        <Panel title="应用介绍">
          <Skeleton active paragraph={{ rows: 5 }} />
        </Panel>
      </>
    );
  }

  if (missing || !app) {
    return (
      <>
        <PageHero title="应用详情" desc="条目来自外部应用目录，本站只做展示。" />
        <Panel title="应用介绍">
          <Result
            status={missing ? "404" : "warning"}
            title={missing ? "应用不存在" : "应用详情读取失败"}
            subTitle={
              missing
                ? "这款应用可能已从目录下架，或链接里的应用标识不对。"
                : error || "稍后再试一次。"
            }
            extra={
              <Button onClick={() => router.push("/app-center?tab=market")}>返回应用市场</Button>
            }
          />
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHero
        title={app.name || "未命名应用"}
        desc="应用由外部目录提供，账号、付款与数据都在应用自己的站点完成；本站只展示目录信息。"
        extra={
          <>
            <Button
              icon={<ArrowLeftOutlined aria-hidden />}
              onClick={() => router.push("/app-center?tab=market")}
            >
              返回应用市场
            </Button>
            {app.homepageUrl ? (
              <Button
                type="primary"
                icon={<ExportOutlined aria-hidden />}
                href={app.homepageUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                打开应用
              </Button>
            ) : null}
          </>
        }
      />

      <Panel title="应用介绍">
        <Space size={12} wrap className="muted" style={{ fontSize: 13 }}>
          {app.category ? <Tag style={{ marginInlineEnd: 0 }}>{app.category}</Tag> : null}
          <span>
            应用标识：
            <Typography.Text copyable style={{ fontSize: 13, color: "inherit" }}>
              {app.clientId}
            </Typography.Text>
          </span>
          {app.publishedAt ? <span>上架于 {fmtTime(app.publishedAt)}</span> : null}
          {app.homepageUrl ? (
            <span>
              应用首页：
              <a
                href={app.homepageUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "inherit", textDecoration: "underline" }}
              >
                {app.homepageUrl}
              </a>
            </span>
          ) : null}
        </Space>
        <div
          style={{
            marginTop: 16,
            paddingTop: 14,
            borderTop: "1px solid var(--border, #f0f0f0)",
            whiteSpace: "pre-wrap",
            lineHeight: 1.75,
            fontSize: 14,
          }}
        >
          {app.description || "该应用还没有填写简介"}
        </div>
      </Panel>

      <Panel
        title="用户评价"
        titleExtra={
          reviews && reviews.reviewCount ? (
            <>
              <Rate
                disabled
                allowHalf
                value={reviews.avgRating}
                style={{ fontSize: 14 }}
              />
              <span className="text-12 muted">共 {reviews.reviewCount} 条评价</span>
            </>
          ) : null
        }
      >
        {reviewsError ? (
          <Notice variant="error">{reviewsError}</Notice>
        ) : !reviews || !reviews.list.length ? (
          <Empty description="还没有用户评价。" />
        ) : (
          <>
            <Space orientation="vertical" size={16} style={{ width: "100%" }}>
              {reviews.list.map((review) => (
                <div key={review.id}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <b style={{ fontSize: 14 }}>{review.author || "匿名用户"}</b>
                    {review.rating ? (
                      <Rate
                        disabled
                        allowHalf
                        value={review.rating}
                        style={{ fontSize: 13 }}
                      />
                    ) : null}
                    {review.createdAt ? (
                      <span className="text-12 muted">{fmtTime(review.createdAt)}</span>
                    ) : null}
                  </div>
                  <Typography.Paragraph
                    style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.7 }}
                  >
                    {review.content || "该用户没有填写评价内容"}
                  </Typography.Paragraph>
                </div>
              ))}
            </Space>
            {reviews.total > REVIEW_PAGE_SIZE ? (
              <div
                style={{ display: "flex", justifyContent: "center", marginTop: 18 }}
              >
                <Pagination
                  current={reviews.page}
                  pageSize={REVIEW_PAGE_SIZE}
                  total={reviews.total}
                  showSizeChanger={false}
                  onChange={setReviewPage}
                />
              </div>
            ) : null}
          </>
        )}
      </Panel>
    </>
  );
}
