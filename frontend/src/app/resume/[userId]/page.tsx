"use client";

import { ArrowLeftOutlined, PrinterOutlined } from "@ant-design/icons";
import { Alert, Button, Spin } from "antd";
import Link from "next/link";
import { useEffect } from "react";
import { useParams } from "next/navigation";
import { EmptyState } from "@/components/ui/panel";
import { socialApi, type ResumeItemRow, type ResumeView } from "@/api/social";
import { useBusinessQuery } from "@/query/business";
import {
  PersonAvatar,
  RESUME_KIND_LABELS,
  RESUME_KIND_ORDER,
  fmtYears,
} from "@/app/social/_components/social-ui";

/** 联系方式键名 → 中文标签；未收录的键原样显示，避免后台加的字段被吞掉。 */
const CONTACT_LABELS: Record<string, string> = {
  phone: "电话",
  mobile: "手机",
  wechat: "微信",
  email: "邮箱",
  qq: "QQ",
  address: "地址",
};
/** 求职意向类型：库里存的是英文枚举，字典没命中就原样打印。 */
const OBJECTIVE_TYPE_LABELS: Record<string, string> = {
  FULL_TIME: "全职",
  PART_TIME: "兼职",
  INTERNSHIP: "实习",
  CONTRACT: "合同 / 外包",
  PROJECT: "项目合作",
};

const contactEntries = (contacts: Record<string, unknown>) =>
  Object.entries(contacts || {})
    .map(([key, value]) => [key, String(value ?? "").trim()] as const)
    .filter(([, value]) => Boolean(value));

/** 分组顺序：按字典顺序排，字典外的类型（历史数据）追加在后面。 */
function groupItems(items: ResumeItemRow[]) {
  const known = RESUME_KIND_ORDER.filter((kind) => items.some((item) => item.kind === kind));
  const extra = [...new Set(items.map((item) => item.kind))].filter((kind) => !known.includes(kind));
  return [...known, ...extra].map((kind) => ({
    kind,
    label: RESUME_KIND_LABELS[kind] || kind,
    rows: items.filter((item) => item.kind === kind),
  }));
}

/**
 * 简历 HTML 页（投递后雇主在私信里点开的那份）：A4 版式、可直接打印成 PDF。
 * 数据来自 `/resume/{userId}/view`，后端只放行本人与收到过该投递的人；页面独立于工作台外壳渲染。
 */
export default function ResumePage() {
  const params = useParams<{ userId: string }>();
  const userId = String(params?.userId || "");
  const view = useBusinessQuery(
    "social",
    "resume-view",
    { userId },
    (signal) => socialApi.viewResume(userId, { signal }),
    "all",
    Boolean(userId),
  );
  const data: ResumeView | undefined = view.data;
  const name = data?.person.displayName || data?.person.username || "简历";

  // 标题换成「姓名 - 简历」：浏览器打印的默认 PDF 文件名就跟着它走
  useEffect(() => {
    if (!data) return;
    document.title = `${name} - 简历`;
  }, [data, name]);

  if (view.isLoading) {
    return (
      <div className="resume-shell">
        <Spin fullscreen description="正在打开简历…" />
      </div>
    );
  }
  if (view.isError || !data) {
    return (
      <div className="resume-shell">
        <Alert
          type="error"
          showIcon
          message="无法打开这份简历"
          description={view.error instanceof Error ? view.error.message : "对方还没有向你投递简历，或简历已被撤回。"}
          action={
            <Link href="/social">
              <Button size="small" icon={<ArrowLeftOutlined />}>
                返回社交
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  const { resume } = data;
  const contacts = contactEntries(resume.contacts);
  const objective = [
    resume.objectiveRole,
    resume.objectiveCity,
    OBJECTIVE_TYPE_LABELS[resume.objectiveType] || resume.objectiveType,
  ]
    .filter(Boolean)
    .join(" · ");
  const groups = groupItems(data.items);
  const isEmpty = !resume.headline && !resume.summary && groups.length === 0 && contacts.length === 0;

  return (
    <div className="resume-shell">
      <div className="resume-toolbar">
        <Link href="/social">
          <Button icon={<ArrowLeftOutlined />}>返回</Button>
        </Link>
        <span className="resume-muted">
          {data.updatedAt ? `更新于 ${new Date(data.updatedAt).toLocaleDateString("zh-CN")}` : "尚未填写简历内容"}
        </span>
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
          导出 PDF / 打印
        </Button>
      </div>

      {isEmpty ? (
        <EmptyState text="这份简历还没有内容。" />
      ) : (
        <article className="resume-doc">
          <header className="resume-head">
            <PersonAvatar person={data.person} size={64} shape="square" />
            <div className="resume-head-main">
              <h1 className="resume-name">{name}</h1>
              {resume.headline ? <p className="resume-headline">{resume.headline}</p> : null}
              <p className="resume-meta">{[resume.location, objective].filter(Boolean).join(" · ")}</p>
            </div>
          </header>

          {contacts.length ? (
            <section className="resume-section">
              <h2 className="resume-section-title">联系方式</h2>
              <ul className="resume-contacts">
                {contacts.map(([key, value]) => (
                  <li key={key}>
                    <span>{CONTACT_LABELS[key] || key}</span>
                    <b>{value}</b>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {resume.summary ? (
            <section className="resume-section">
              <h2 className="resume-section-title">个人总结</h2>
              <p className="resume-paragraph">{resume.summary}</p>
            </section>
          ) : null}

          {groups.map((group) => (
            <section key={group.kind} className="resume-section">
              <h2 className="resume-section-title">{group.label}</h2>
              {group.rows.map((item) => (
                <div key={item.id} className="resume-entry">
                  <div className="resume-entry-head">
                    <b>{item.title}</b>
                    {item.subtitle ? <span>{item.subtitle}</span> : null}
                    {item.startYear ? <i>{fmtYears(item.startYear, item.endYear)}</i> : null}
                  </div>
                  {item.description ? <p className="resume-entry-desc">{item.description}</p> : null}
                  {item.url ? (
                    <a className="resume-entry-url" href={item.url} target="_blank" rel="noreferrer">
                      {item.url}
                    </a>
                  ) : null}
                </div>
              ))}
            </section>
          ))}

          {resume.additional ? (
            <section className="resume-section">
              <h2 className="resume-section-title">补充说明</h2>
              <p className="resume-paragraph">{resume.additional}</p>
            </section>
          ) : null}

          <footer className="resume-foot">
            由 {name} 通过站内私信投递 · 本页面可直接打印或另存为 PDF
          </footer>
        </article>
      )}
    </div>
  );
}
