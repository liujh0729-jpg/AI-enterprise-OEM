"use client";

import Link from "next/link";
import { Spin } from "antd";
import { useEffect, useState } from "react";
import { gapsPublicApi, type PublicTerms } from "@/api/gaps";
import { PRODUCT_NAME } from "@/lib/brand";

type Props = {
  code: string;
  /** 未注册时展示的页标题（与后台发布的标题一致时会被覆盖）。 */
  fallbackTitle: string;
};

/** 正文按「标题行 + 缩进条目」组织：首行不加缩进，其余行当段落。 */
function toBlocks(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const heading = /^[一二三四五六七八九十]+、/.test(line);
      return { line, heading };
    });
}

/**
 * 注册协议 / 隐私政策的全文页（免登录可读）。
 * 正文来自后台发布的 ACTIVE 版本；后台尚未发布时展示平台内置默认文本。
 */
export function AgreementDocument({ code, fallbackTitle }: Props) {
  const [doc, setDoc] = useState<PublicTerms | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    void gapsPublicApi
      .terms(code)
      .then((data) => {
        if (alive) setDoc(data);
      })
      .catch((caught: unknown) => {
        if (alive)
          setError(caught instanceof Error ? caught.message : "协议加载失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [code]);

  const title = doc?.title || fallbackTitle;

  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "48px 24px 96px",
        lineHeight: 1.8,
        color: "rgba(0,0,0,0.85)",
      }}
    >
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>{title}</h1>
      <p style={{ color: "rgba(0,0,0,0.45)", marginBottom: 32 }}>
        版本：{doc?.version || "—"} · 生效日期：{doc?.effectiveAt || "—"} · 适用产品：
        {PRODUCT_NAME}
      </p>
      {loading ? (
        <div style={{ padding: "48px 0", textAlign: "center" }}>
          <Spin />
        </div>
      ) : error ? (
        <p style={{ color: "#cf1322" }}>{error}</p>
      ) : doc ? (
        toBlocks(doc.content).map((block, index) =>
          block.heading ? (
            <h2 key={index} style={{ fontSize: 18, margin: "28px 0 8px" }}>
              {block.line}
            </h2>
          ) : (
            <p key={index} style={{ margin: "6px 0", textAlign: "justify" }}>
              {block.line}
            </p>
          ),
        )
      ) : null}
      <p style={{ marginTop: 32 }}>
        <Link href="/login" style={{ color: "#1677ff" }}>
          ← 返回登录 / 注册
        </Link>
      </p>
    </main>
  );
}
