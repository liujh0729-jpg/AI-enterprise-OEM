"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DEFAULT_HOMEPAGE, type HomepageSettings } from "@enterprise/contracts";
import { homepageApi } from "@/api/homepage";
import { BrandLogo } from "@/components/brand-logo";
import { PRODUCT_NAME } from "@/lib/brand";
import { useSiteBrand } from "@/lib/site-brand";
import styles from "./home.module.css";

const REGISTER_HREF = "/login?mode=register";
const LOGIN_HREF = "/login";
const ICP_HREF = "https://beian.miit.gov.cn/";
const CURRENT_YEAR = new Date().getFullYear();

const CODE_SAMPLE = [
  '{ "jsonrpc": "2.0", "id": 1,',
  '  "method": "tools/call",',
  '  "params": {',
  '    "name": "tax.declaration.preview",',
  '    "arguments": { "period": "2026-10" }',
  "  } }",
].join("\n");

function HighlightedTitle({ text, highlight }: { text: string; highlight: string }) {
  const index = highlight ? text.indexOf(highlight) : -1;
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <span className={styles.highlight}>{highlight}</span>
      {text.slice(index + highlight.length)}
    </>
  );
}

function isExternal(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export default function HomePage() {
  const brand = useSiteBrand();
  const [config, setConfig] = useState<HomepageSettings>(DEFAULT_HOMEPAGE);
  const [sceneIndex, setSceneIndex] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    homepageApi
      .view({ signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) setConfig(next);
      })
      .catch(() => {
        /* 读取失败保留内置默认内容，首页依旧完整可看 */
      });
    return () => controller.abort();
  }, []);

  const scenes = config.scenes.items;
  const sceneCount = scenes.length;
  const activeIndex = sceneCount > 0 ? sceneIndex % sceneCount : 0;
  const activeScene = scenes[activeIndex];
  const { sections } = config;
  const footerLinks = brand.footerLinks.filter((link) => link.label && link.url);
  const copyright = config.footer.copyright.replaceAll("{year}", String(CURRENT_YEAR));

  useEffect(() => {
    if (sceneCount < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setSceneIndex((current) => (current + 1) % sceneCount);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [sceneCount]);

  const goScene = (step: number) => {
    if (sceneCount === 0) return;
    setSceneIndex((current) => (current + step + sceneCount) % sceneCount);
  };

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/">
          <BrandLogo size={30} priority src={brand.siteLogo || undefined} />
          <span>{brand.siteName || PRODUCT_NAME}</span>
        </Link>
        <nav className={styles.actions} aria-label="账号入口">
          <a className={styles.ghostButton} href={LOGIN_HREF}>
            登录
          </a>
          <a className={styles.primaryButton} href={REGISTER_HREF}>
            免费注册
          </a>
        </nav>
      </header>

      <section
        className={styles.hero}
        style={{ backgroundImage: `url("${config.hero.image || DEFAULT_HOMEPAGE.hero.image}")` }}
      >
        <div className={styles.heroShade} aria-hidden="true" />
        <div className={styles.heroInner}>
          {config.hero.badge && <p className={styles.heroBadge}>{config.hero.badge}</p>}
          <h1 className={styles.heroTitle}>
            <HighlightedTitle text={config.hero.title} highlight={config.hero.highlight} />
          </h1>
          <p className={styles.heroSubtitle}>{config.hero.subtitle}</p>
          <div className={styles.heroActions}>
            <a className={styles.heroPrimary} href={REGISTER_HREF}>
              {config.hero.primaryLabel}
            </a>
            <a className={styles.heroSecondary} href={LOGIN_HREF}>
              {config.hero.secondaryLabel}
            </a>
          </div>
          {config.hero.stats.length > 0 && (
            <dl className={styles.stats}>
              {config.hero.stats.map((stat, index) => (
                <div className={styles.stat} key={`${stat.label}-${index}`}>
                  <dd>{stat.value}</dd>
                  <dt>{stat.label}</dt>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>

      {sections.scenes && activeScene && (
        <section className={styles.section} aria-labelledby="home-scenes-title">
          <header className={styles.sectionHead}>
            <p className={styles.eyebrow}>Service Scenes</p>
            <h2 id="home-scenes-title">{config.scenes.title}</h2>
            {config.scenes.subtitle && <p className={styles.sectionDesc}>{config.scenes.subtitle}</p>}
          </header>
          <article className={styles.sceneCard}>
            <div
              className={styles.sceneImage}
              style={{ backgroundImage: `url("${activeScene.image}")` }}
              role="img"
              aria-label={activeScene.title}
            />
            <div className={styles.sceneShade} aria-hidden="true" />
            <div className={styles.sceneBody}>
              {activeScene.tag && <span className={styles.sceneTag}>{activeScene.tag}</span>}
              <h3>{activeScene.title}</h3>
              <p>{activeScene.desc}</p>
            </div>
            {sceneCount > 1 && (
              <div className={styles.sceneControls}>
                <span className={styles.sceneIndex}>
                  {String(activeIndex + 1).padStart(2, "0")} / {String(sceneCount).padStart(2, "0")}
                </span>
                <div className={styles.sceneBars}>
                  {scenes.map((item, index) => (
                    <button
                      key={`${item.tag}-${index}`}
                      type="button"
                      className={index === activeIndex ? styles.sceneBarActive : styles.sceneBar}
                      aria-label={`查看场景：${item.title}`}
                      aria-current={index === activeIndex}
                      onClick={() => setSceneIndex(index)}
                    />
                  ))}
                </div>
                <div className={styles.sceneArrows}>
                  <button type="button" aria-label="上一个场景" onClick={() => goScene(-1)}>
                    ←
                  </button>
                  <button type="button" aria-label="下一个场景" onClick={() => goScene(1)}>
                    →
                  </button>
                </div>
              </div>
            )}
          </article>
        </section>
      )}

      {sections.services && config.services.items.length > 0 && (
        <section className={styles.section} aria-labelledby="home-services-title">
          <header className={styles.sectionHead}>
            <p className={styles.eyebrow}>Full Stack</p>
            <h2 id="home-services-title">{config.services.title}</h2>
            {config.services.subtitle && <p className={styles.sectionDesc}>{config.services.subtitle}</p>}
          </header>
          <div className={styles.serviceGrid}>
            {config.services.items.map((item, index) => (
              <article className={styles.serviceCard} key={`${item.name}-${index}`}>
                <span className={styles.serviceIndex}>{String(index + 1).padStart(2, "0")}</span>
                <h3>{item.name}</h3>
                <p>{item.desc}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {sections.integration && (
        <section className={`${styles.section} ${styles.split}`} aria-labelledby="home-integration-title">
          <div className={styles.splitCopy}>
            <p className={styles.eyebrow}>Open Integration</p>
            <h2 id="home-integration-title">{config.integration.title}</h2>
            {config.integration.subtitle && (
              <p className={styles.sectionDesc}>{config.integration.subtitle}</p>
            )}
            {config.integration.points.length > 0 && (
              <ul className={styles.points}>
                {config.integration.points.map((point, index) => (
                  <li key={`${point}-${index}`}>{point}</li>
                ))}
              </ul>
            )}
          </div>
          <div className={styles.codeCard} aria-hidden="true">
            <div className={styles.codeBar}>
              <span>MCP · JSON-RPC</span>
              <span>POST /mcp</span>
            </div>
            <pre className={styles.code}>
              <code>{CODE_SAMPLE}</code>
            </pre>
            <p className={styles.codeFoot}>统一 ek_ Key 鉴权与用量计量</p>
          </div>
        </section>
      )}

      {sections.steps && config.steps.items.length > 0 && (
        <section className={styles.section} aria-labelledby="home-steps-title">
          <header className={styles.sectionHead}>
            <p className={styles.eyebrow}>Get Started</p>
            <h2 id="home-steps-title">{config.steps.title}</h2>
            {config.steps.subtitle && <p className={styles.sectionDesc}>{config.steps.subtitle}</p>}
          </header>
          <ol className={styles.steps}>
            {config.steps.items.map((step, index) => (
              <li className={styles.step} key={`${step.title}-${index}`}>
                <span className={styles.stepNo}>{String(index + 1).padStart(2, "0")}</span>
                <h3>{step.title}</h3>
                <p>{step.desc}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {sections.faq && config.faq.items.length > 0 && (
        <section className={styles.section} aria-labelledby="home-faq-title">
          <header className={styles.sectionHead}>
            <p className={styles.eyebrow}>FAQ</p>
            <h2 id="home-faq-title">{config.faq.title}</h2>
          </header>
          <div className={styles.faq}>
            {config.faq.items.map((item, index) => (
              <details className={styles.faqItem} key={`${item.q}-${index}`}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {sections.cta && (
        <section className={styles.cta}>
          <h2>{config.cta.title}</h2>
          {config.cta.subtitle && <p>{config.cta.subtitle}</p>}
          <div className={styles.ctaActions}>
            <a className={styles.heroPrimary} href={REGISTER_HREF}>
              {config.cta.primaryLabel}
            </a>
            <a className={styles.heroSecondary} href={LOGIN_HREF}>
              {config.cta.secondaryLabel}
            </a>
          </div>
        </section>
      )}

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <Link className={styles.brand} href="/">
              <BrandLogo size={26} src={brand.siteLogo || undefined} />
              <span>{brand.siteName || PRODUCT_NAME}</span>
            </Link>
            {brand.siteDesc && <p>{brand.siteDesc}</p>}
            <p className={styles.footerSlogan}>{config.footer.slogan}</p>
          </div>
          <div className={styles.footerMeta}>
            {footerLinks.length > 0 && (
              <nav className={styles.footerLinks} aria-label="页脚链接">
                {footerLinks.map((link) => (
                  <a
                    key={`${link.label}-${link.url}`}
                    href={link.url}
                    target={isExternal(link.url) ? "_blank" : undefined}
                    rel={isExternal(link.url) ? "noreferrer" : undefined}
                  >
                    {link.label}
                  </a>
                ))}
              </nav>
            )}
            {brand.icpRecord && (
              <a href={ICP_HREF} target="_blank" rel="noreferrer">
                {brand.icpRecord}
              </a>
            )}
            <span>{copyright}</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
