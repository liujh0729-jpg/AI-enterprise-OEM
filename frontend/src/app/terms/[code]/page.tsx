"use client";

import { CheckCircleOutlined } from "@ant-design/icons";
import { Button, Card, Result, Space, Spin, Tag, Typography } from "antd";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { gapsApi, gapsPublicApi, type PublicTerms } from "@/api/gaps";
import { PRODUCT_NAME } from "@/lib/brand";
import { useSession } from "@/lib/session";

/** 公开条款页（免登录可读）：登录后可对当前版本留痕接受。 */
export default function PublicTermsPage() {
  const params = useParams<{ code: string }>();
  const code = params?.code || "";
  const { me } = useSession();
  const [doc, setDoc] = useState<PublicTerms | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    setLoading(true);
    void gapsPublicApi
      .terms(code)
      .then((data) => {
        if (alive) setDoc(data);
      })
      .catch((caught: unknown) => {
        if (alive) setError((caught as Error)?.message || "条款加载失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [code]);

  const accept = async () => {
    if (!doc) return;
    setAccepting(true);
    try {
      await gapsApi.acceptTerms({ body: { code: doc.code, version: doc.version } });
      setAccepted(true);
    } catch (caught) {
      setError((caught as Error)?.message || "接受失败，请稍后重试");
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f5", padding: "48px 16px" }}>
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 20, fontSize: 13, color: "#8c8c8c" }}>
          {PRODUCT_NAME}
        </div>

        {loading ? (
          <Card>
            <div style={{ textAlign: "center", padding: "60px 0" }}>
              <Spin description="正在加载条款…">
                <div />
              </Spin>
            </div>
          </Card>
        ) : error && !doc ? (
          <Card>
            <Result status="warning" title="无法打开条款" subTitle={error} />
          </Card>
        ) : doc ? (
          <Card>
            {accepted ? (
              <Result
                status="success"
                icon={<CheckCircleOutlined />}
                title="已记录你的接受"
                subTitle={`${doc.title} ${doc.version} 的接受记录已留痕。`}
              />
            ) : null}
            <Space size={[8, 8]} wrap style={{ marginBottom: 12 }}>
              <Tag color="blue">{doc.categoryLabel}</Tag>
              <Tag>{doc.version}</Tag>
              {doc.effectiveAt ? <Tag>生效于 {doc.effectiveAt.slice(0, 10)}</Tag> : null}
            </Space>
            <Typography.Title level={3} style={{ marginTop: 0 }}>
              {doc.title}
            </Typography.Title>
            <div
              style={{
                whiteSpace: "pre-wrap",
                lineHeight: 1.9,
                fontSize: 14,
                color: "#333",
                marginBottom: 24,
              }}
            >
              {doc.content}
            </div>

            {!accepted ? (
              me ? (
                <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                  {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}
                  <Button type="primary" loading={accepting} onClick={() => void accept()}>
                    我已阅读并接受本版本
                  </Button>
                </Space>
              ) : (
                <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                  <Typography.Text type="secondary">
                    接受条款需要登录；登录后会回到当前页面。
                  </Typography.Text>
                  <Button
                    type="primary"
                    onClick={() =>
                      window.location.assign(
                        `/login?next=${encodeURIComponent(
                          `${window.location.pathname}${window.location.search}`,
                        )}`,
                      )
                    }
                  >
                    登录后接受
                  </Button>
                </Space>
              )
            ) : null}
          </Card>
        ) : null}

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: "#bfbfbf" }}>
          由 {PRODUCT_NAME} 提供
        </div>
      </div>
    </div>
  );
}
