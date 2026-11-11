# OEM Enterprise · Open-Source Service Workbench + Business Networking

<p align="center">
  <a href="README.md">简体中文</a> · <strong>English</strong> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.ja.md">日本語</a> · <a href="README.ar.md">العربية</a> · <a href="README.fr.md">Français</a> · <a href="README.es.md">Español</a> · <a href="README.ru.md">Русский</a>
</p>

**Online demo: <https://enterprise.aiworkin.com>**

An open-source project that merges and ports two systems into one: the **enterprise service
workbench** (Hono + Prisma + MySQL + Next.js / Ant Design) and the **business networking SNS**
(connections / posts / groups / direct messages / resumes / supply-and-demand plaza / recruiting).

It is not a single-purpose tool but a complete foundation for "internal enterprise management + external customer acquisition + business matching": built on a unified account and identity
system, it first receives visitors on the **official landing page** (`/`, the logged-out landing page whose header only offers Sign in / Sign up), then leads into the executive dashboard,
21 workbench entries (My Tasks, Agent, Workflows, Knowledge Base, Workbuddy Enterprise Cloud, Multi-dimensional Tables, RPA, Content Creation, Marketing Tools,
Digital Assets, AI Mail, CRM, BI, OA, OKR, AI Service Desk, HR Workbench, Project Management, Inventory & Purchasing, App Center, Topic Hall),
11 business service lines (Marketing / Supply & Distribution / Tax & Accounting / Cross-border / Flexible Employment / Logistics / IT / IP / Legal / Think Tank / Asset Trading), business networking and recruiting,
plus a platform admin console organized into 5 groups with 26 sections in total (the platform data overview is merged into the dashboard `/dashboard`). All social and supply-and-demand capabilities are
**fully local and usable without any key**; to publish demands / services to the upstream marketplace (AIworkin), maintain the company profile or apply for qualifications, simply bind one AIPDD API key
— **this system involves no crypto assets, never custody upstream accounts, and rewrites all styles and interactions locally**.

> For the design and migration specification see [`docs/开源版整体设计方案.md`](docs/开源版整体设计方案.md).

| Spec | Count |
|---|---|
| Page routes (Next.js App Router) | 75 |
| HTTP operations (OpenAPI snapshot scope) | 1947 |
| Prisma data models | 528 |
| Backend business modules | 91 |
| UI languages | 8 (incl. full-site RTL for Arabic) |
| Database | MySQL 8 or PostgreSQL (choose one at install) |

> Current version **v1.4.0** ([release notes](https://github.com/liujh0729-jpg/AI-enterprise-OEM/releases/tag/v1.4.0)): upgraded accounts and sign-in (email / SMS verification codes, WeChat QR sign-in, 30-day remember-me), shared assets extended to service-provider staff, and new modules including the knowledge-base workbench, model plaza, SEO workbench, AI lead acquisition, WeCom SCRM and smart hardware.

---

## 📸 UI Preview

> The screenshots below are taken from the demo site <https://enterprise.aiworkin.com> (super-admin view; the left sidebar shows the "Workbench / Business Services" menus).

**Agent workbench**: chat produces images / videos directly; tabs cover conversations, scheduled tasks, assistants, digital avatars, skills, experts and MCP connectors (the "actions allowed to run automatically" authorization gate lives under the MCP connector tab).
<img src="docs/screenshots/agent.png" width="900" alt="Agent workbench">

**Marketing tools**: acquisition, outreach and data tools on one screen, each card with its own description and entry (AI lead acquisition: lead radar → outreach → customer profile → sales playbook → follow-up → QA and dashboard; collection and outreach are executed by the AIPDD Enterprise plugin; WeCom SCRM: native customer sync, mass-send with manual confirmation, SOPs, employee sidebar, sensitive words and AI QA; influencer outreach, AliCloud outbound calls / direct mail, GEO optimization, SEO optimization, live QR-code traffic, Tencent Qidian, prospect mining, global big data, multi-platform content distribution, survey design & research, SalesBuddy).
<img src="docs/screenshots/marketing-tools.png" width="900" alt="Marketing tools">

**Content creation**: text-to-image, image-to-video, video cloning, digital humans, retouching & watermark removal, copy extraction, text-to-speech, music, dubbing, mash-up editing, script and voice-over reverse engineering, plus "product-page optimization" image packs for cross-border and domestic e-commerce; the "video template community" lets you browse samples by usage / newest / most-bookmarked, and clone a template with its prompt and reference images using your own model — cloning is an async task tracked in the in-page "generation tasks" tab (viewing a paid recipe credits the publisher with points; the platform admin can optionally sync AIworkin platform templates); the page ends with a locally deployable video creation tool.
<img src="docs/screenshots/content-creation.png" width="900" alt="Content creation">

**Tax & accounting services**: filing materials, declaration plans, account-set management, automation capabilities and demand information; declaration plans are generated automatically from each contracted enterprise's taxpayer type and filing frequency, with per-tax progress and drill-down into each declaration.
<img src="docs/screenshots/tax-service.png" width="900" alt="Tax & accounting services">

**AI service desk**: conversations, agent teams, reception settings, canned phrases & knowledge, sites & access, channel access and statistics on one screen; reception status is Online / Away / Offline, and only online agents take part in auto-assignment.
<img src="docs/screenshots/ai-service-desk.png" width="900" alt="AI service desk">

---

## 🗺️ Feature Map

| Group | Module | In one sentence | Upstream credentials |
|---|---|---|---|
| Home | Official landing page (`/`) | Static landing page for logged-out visitors: hero, scenario carousel, business sections, open integrations, usage steps and FAQ; the header only offers "Sign in / Sign up"; the footer reads the site name, logo, ICP filing and footer links from site settings; copy and images are maintained in the admin under "System Settings → Homepage Settings" | No |
| Home | Executive dashboard (`/dashboard`) | Identity & qualifications, my to-dos, business ledger; the page header carries quick entries for "Manage API Keys / Top up points", plus a red bind-key entry when no AIPDD key is bound; the platform-admin dashboard also shows the platform data overview, pending reviews and the service-type distribution of providers | No |
| Workbench | Agent | Chat directly produces images / videos; results land in this account's AIPDD digital assets | AIPDD |
| Workbench | Knowledge Base (`/kb`) | Materials enter a knowledge space and are compiled into traceable wiki pages; `[[links]]` grow a knowledge graph; hybrid retrieval and citation-backed Q&A; the memory page holds long-term and operational memory | No |
| Workbench | Workbuddy Enterprise Cloud | Scheduled tasks (AI-clarified task briefs), Agents, enterprise-cloud accounts and AI-callable credential hosting | Tencent Cloud |
| Workbench | Multi-dimensional Tables | Self-built structured tables, 8 column types, create-a-table from one sentence, AI columns / ask-data / views, API-key machine channel, Feishu (Lark) sync | No |
| Workbench | RPA Automation | Cloud RPA tasks / accounts / scripts; the local BitBrowser claims and executes them and reports results back; the local Chrome extension upgrades to a **browser agent** — describe the outcome in the side panel and the Agent works autonomously, multi-step, on sites you are already logged into, and you can create scheduled tasks that auto-run a goal at the set frequency | AIPDD / local extension |
| Workbench | Content Creation | Text-to-image / video, digital humans, dubbing & music, mash-up editing, watermark removal & super-resolution, product-page image packs, video template community, Drama Agent | AIPDD |
| Workbench | Marketing Tools | AI lead acquisition, WeCom SCRM, influencer outreach, AliCloud outbound calls / direct mail, GEO optimization, SEO optimization, live QR traffic, Qidian, prospect mining, global big data, multi-platform content distribution, surveys & research, marketing skill library, SalesBuddy | Self-service per vendor / local plugin |
| Workbench | Digital Asset Management | Bytes stored in this site's OSS: search, tagging, upload and delete; "shared materials" shares assets per account within the same organization (a verified enterprise or a service provider) while files stay owned by the uploader; legacy AIPDD-hosted assets can be migrated in batches from the admin | No |
| Workbench | AI Mail Service | Multi-mailbox POP3 / IMAP reading; bodies and attachments never persisted to the DB; draft replies or auto-replies per scripted playbooks | Mailbox auth codes |
| Workbench | CRM | Leads, customers, opportunities, sales contracts, payments received, orders, approvals and reports | No |
| Workbench | BI Analytics | Built-in curated datasets + external read-only data sources; ask-your-data, charts, dashboards | No |
| Workbench | OA | Leave / expense / payment / procurement / seal-use forms with multi-level approvals; results written back into business records | No |
| Workbench | OKR Planning | Cycles, company-to-individual goal trees, weekly/daily reports, retrospective scoring | No |
| Workbench | HR Workbench | Records, attendance, recruiting, payroll and workforce dashboards (the organization's "staff / agents" are the same people) | No |
| Workbench | Project Management | Projects / members / milestones / iterations, tasks & dependencies, time logs with weekly-timesheet approval, cost rates & ledgers, external cooperation and entity directories, AI WBS and health scores | No |
| Workbench | Inventory & Purchasing | Products and variants, warehouse stock & movements, purchase receiving, receivables/payables and expense claims, tax rates & pricing policies, AI business insights | No |
| Workbench | AI Service Desk | One account hosting multiple website widgets; human reception + three AI response modes | No |
| Workbench | App Center | Built-in apps + app marketplace, four tabs searchable by keyword | No |
| Workbench | Topic Hall | Internal / public topic discussions; the initiator can close the case and let AI summarize it | No |
| Business Services | Marketing / Supply & Distribution / Tax & Accounting / Cross-border / Flexible Employment / Logistics / IT / IP / Legal / Think Tank / Asset Trading | Provider resource directory → details → sign a contract; demand messaging channel and business ledger | Partial |
| Networking | Business Social | Friends / blocklist, posts, Douban-style groups, direct messages, career resumes | No |
| Networking | Recruiting | Recruiting plaza (job posting with DM contact) + AI resume auto-submission (profile, matching, optimization, submission confirmation and funnel) | Local: no / Sync: yes |
| Networking | Supply & Demand Plaza | Generic posting of demands / services, two-stage: keyless locally + optional upstream sync | Local: no / Sync: yes |
| Model Services | Model Plaza (`/model-plaza`) | Platform-listed usable models: billing units match upstream, online trial and usage ledger, served through an OpenAI-compatible gateway with `ek_` keys | No |
| Model Services | API Keys / API-MCP-Skill / Model Settings / AIPDD Compute Platform | `ek_` keys calling `/api/v1`, MCP access, model selection, with an outbound link to the AIPDD compute platform at the end | Partial |
| Admin Settings | Identity & Qualifications / Staff & Agents / Contract Management / My Packages / Points Center / My Invitations / Platform Mechanisms | Verification, teams, contract ledgers, dual-currency points, invitation relations, plus Webhooks, import/export, rules, sharing, OIDC, Feishu (Lark) / WeCom sync, terms-acceptance audit trail, usage telemetry and entity switching | Partial |
| Smart Hardware | Hardware Plaza / Add Hardware / Hardware MCP / Hardware API | Model catalog and dev kits (SDK / firmware download, SHA-256 checksums); enrolled devices with heartbeat-based online status; per-model dedicated MCP tools (Agent control, `hw__<model>__<tool>`) and APIs (`/api/v1/hardware/**`); SDK / examples / simulator in the repo's `hardware-devkit/` | No |
| Platform Admin | 26 sections / 5 groups (see below) | Filing review, providers & category qualifications, contract oversight, tax account pools, GEO / live-QR oversight, points risk control, official service packages, model plaza, publication review, entitlements & quotas, usage telemetry, smart hardware, terms versions, changelog, platform upgrade, system settings | — |
| Help & Docs | Help Center `/help` | Chaptered, versioned knowledge base (quick start / workbench tools / content & marketing / multi-platform distribution / smart hardware / business & admin settings); general help is sectioned by role (enterprise/individual users, providers, provider staff) but visible to all, while platform-admin and AliCloud ops sections are admin-only; the same knowledge is exposed as read-only MCP tools, so you can simply ask the Agent for official usage | No |

---

## 📖 Feature Details

### 1. Accounts, Identity and Sessions

- **Closed-loop local accounts**: registration (username / email / phone channels optional), sign-in, recovery, password change, rebinding, deactivation; login audit and platform-level bans.
- **Sign-in methods and registration verification**: the login page renders, per admin switches, "regular sign-in (account + password) / email verification code / SMS verification code / WeChat QR";
  registration renders "username / email / phone" according to the methods the admin has enabled; email and SMS registration require passing a verification code first (email needs SMTP configured, phone needs AliCloud SMS;
  channels without configured credentials cannot be checked in the admin and are not shown in the UI). Checking "auto-login within 30 days" extends the session to 30 days.
- **WeChat QR sign-in / sign-up**: QR login via a WeChat Open Platform "website application"; if already bound, sign in directly; if unbound and auto-registration is on, create an account and bind it (username `wx_<last 8 chars of openid>`,
  nickname and avatar prefetched), and if auto-registration is off, guide the user to verify identity with account+password or email / SMS code before binding; the QR `state` is single-use and valid for 5 minutes;
  the AppSecret is stored encrypted and the admin only ever returns a masked value.
- **Admin "System Settings → Account & Login"**: centrally maintains registration methods, sign-in methods, SMTP, AliCloud SMS and WeChat parameters; credentials must be fully configured before a channel can be enabled.
- **Lower-case normalization for usernames and emails**: MySQL collation is case-insensitive while PostgreSQL is case-sensitive, so both are stored and de-duplicated lower-cased for identical behavior on either database; for existing databases run the idempotent backfill
  `pnpm --filter aiworkin-enterprise-api db:normalize-usernames`.
- **Self-issued site sessions**: only locally issued SSO sessions are accepted (issuer `enterprise-sso`, key derived from `JWT_SECRET` via HKDF);
  every request re-checks account status and `tokenVersion` — password change, rebinding or a ban invalidates sessions immediately; upstream platform tokens are always rejected.
- **Standing re-check for persisted artifacts**: legacy public shares, export file downloads, Chrome-extension tokens, unattended scheduled tasks, workflow timers / event triggers and low-code organization project membership are all re-checked against current tables for "account status + organizational standing" before use, and take effect immediately after someone leaves the org or changes role (without waiting for async project-member cleanup or caches); externally a uniform "not found / invalid" response is returned and never leaks the reason.
- **Multiple identities and entity types**: four identities — platform admin, enterprise user, service provider, provider staff (agent);
  entities fall into three types: enterprise, individual business (sole proprietorship), and individual. After switching identity the sidebar re-groups per role: platform admins see only the platform admin console
  (five groups: Users & Providers / Business Operations Oversight / Billing & Products / Capability & Security / System & Content; the platform data overview is merged into the executive dashboard `/dashboard`),
  without the personal-account "Admin Settings".
- **Verification and qualifications**: enterprise info takes effect upon submission; provider filings require platform review; staff must bind to or affiliate with a provider.
- **Invitation codes**: every account has its own invitation code; entering it at registration establishes the invitation relation; "My Invitations" shows the code, sign-up link, who invited you, and how many people you have invited; the "Invite to register" item in the header avatar dropdown links directly to this page.

### 2. Executive Dashboard

- Quick entries at the top right of the page header: **Manage API Keys** and **Top up points**, followed by the identity button (admins see "Admin console", other identities see "Identity & Qualifications"); when no AIPDD API key is bound, a red **Bind AIPDD API Key** button appears at the far left, linking straight to the binding section of "API Key Management", and disappears automatically once binding is done.
- Stat cards: **"My Tasks" is always first** (showing the open-task count from the task center, clicking through to `/tasks`) and **"Active contracts" always last**; the other cards with dedicated landing pages are fully clickable; each identity has its own set of cards — enterprise (My Tasks / To-dos / OA approvals pending / New messages / Active contracts), provider (My Tasks / Enterprises served / To-dos / OA approvals pending / Active contracts), staff (My Tasks / Bound organization / Served enterprises / To-dos / OA approvals pending), platform admin (My Tasks / To-dos / New messages).
- The first block under the stat cards is **quick navigation**: the default frequently-used nav is one clickable card; a "Settings" control at the top right lets you add / remove and reorder items, persisted per account; then come the enterprise **growth dashboard** (goal progress, payments collected, projects in delivery, lead conversion, service-desk-to-lead conversions), "My To-dos" (aggregated unfinished counts per module, with service categories you have not activated hidden per identity), **Top-5 My Tasks** (each row jumps to the source module), and the "needs my action" and new-message overviews.
- **"Needs my action" follows exactly one source**: the task center's `bySource` figures (same source as `/tasks`): only items owned by me with a current count (website inquiries, OA, CRM, OKR, projects, workflows, contracts pending confirmation, platform reviews); "binding invitations awaiting my confirmation" belongs to no task source and is appended as a separate row.
- Platform admins: the dashboard is the platform data overview (registrations / enterprises / providers / contracts / per-business document counts and tax amounts), the pending review queue (provider filings) and the providers' service-type distribution; the sidebar links straight into each oversight section.

### 3. Workbench (21 Entries)

| Module | Capability highlights |
|---|---|
| **My Tasks** | Unified task center: aggregates eight kinds of to-dos — OA approvals, OKR tasks, project tasks, CRM to-dos, service conversations, contract confirmations, platform reviews and workflow human nodes — on one screen (account-level, all sources; filter by source / group + search + pagination); each row shows only the task description, the center status and the business status, plus a "go handle it" entry — details are still handled in the source module. Center status (Open → In progress → Done / Cancelled / Expired) and the authoritative business status are displayed separately; the owner can close / reopen (password confirmation required), and a terminal business status in the source module auto-closes the task; the dashboard has a Top-5 panel. |
| **Agent** | Chatting with the model produces images / videos directly; generated results are stored automatically into this account's AIPDD digital assets; long-term memory / knowledge repository / operational memory have been merged into the "Knowledge Base → Memory" tab (the repository and long-term memory now live uniformly in the knowledge base, and the Agent keeps only one retrieval stack site-wide); the "actions allowed to run automatically" authorization gate sits under the MCP connector tab and manages two kinds of grants — contract write actions, and tools of self-created MCP connectors (connector tools default to deny-all, opened by checking a whole connector; unauthorized calls return only a draft, and unattended runs never execute). Skills / plugins pass an AI security review at upload (using the key and model you configured in "Model Settings") before entering the library; those declaring permissions need a pre-enable confirmation; at runtime there are call-count, repeated-call and output fallback guardrails. Models and keys are configured under "Model Services → Model Settings". |
| **Workflows** | Visual multi-step orchestration: drag nodes and connections on a canvas; the node catalog derives from the unified capability registry (contract actions, built-in / business / connector / hardware / skill / plugin tools, plus trigger / conditional branch / parallel & join / AI / human / Webhook built-in nodes), and parameter forms generate automatically from contracts; new workflows can start from 5 built-in recipe templates (lead follow-up / contract renewal / payment chasing / ticket QA / onboarding provisioning), prefilled with name and description and carrying a flow graph; the recipient defaults to the initiator themselves — copy and it runs; you can also click "Build with AI" in the editor's top toolbar, describe the change in one sentence or a few turns, and the text model rewrites the current canvas from the system's existing nodes (it must pass the same DAG validation before being accepted, and any need it cannot map is pointed to the "AI Agent" node instead), then click "Apply to canvas" and save; save a draft → step-through trial in the Playground (input / output / duration / error per step) → publish a frozen version. The runtime performs DAG cycle detection and template variable resolution (`{{input.x}}` / `{{vars.x}}` / `{{nodes.id.x}}` / `{{actor.userId}}`); human nodes suspend and are resumed when the task is closed in "My Tasks"; shared workflows enter the in-site Agent and MCP tool catalog as `wf__<id>`. Before timer / domain-event / task-event triggers fire, the initiator's account and organizational standing are re-checked against current tables — after leaving or being removed from the org, flows no longer start automatically. The list groups by "Mine + one tab per entity" (`Company A · Company shared` / `Provider C · Provider shared`; the entity name comes from your own affiliation, long names truncate and hover shows the full name); each entity's workflow data domain is independent and never mixed into one list, and on creation you can also choose which company / which provider to share to. |
| **Knowledge Base** | Feed meeting minutes, articles and call transcripts into a knowledge space and the system compiles them into traceable wiki pages: `[[links]]` in the body automatically grow a knowledge graph; hybrid retrieval (keywords + vectors) and citation-backed Q&A are usable as you write; when no LLM is connected, the whole chain falls back to deterministic rules; tabs cover spaces, sources, pages, Q&A, graph, consumers and memory. An agent's work trail can be distilled into **operational memory**, and the context injected before answering also flows back from here; long-term memory and the knowledge repository live uniformly in the knowledge base, and the Agent keeps only this one retrieval stack site-wide. |
| **Workbuddy Enterprise Cloud** | Scheduled tasks: plain-language requests clarified by AI into task briefs, split into items and dispatched, with Agent messages in sync; Agents: create / version / session; Workbuddy Enterprise accounts: the user's own SecretId / SecretKey stored encrypted, multiple keys in parallel; AI-callable accounts: third-party platform credentials / API keys / cookies stored encrypted, authorized per enterprise-cloud account and used through the machine channel per binding. |
| **Multi-dimensional Tables** | Self-built structured data tables owned per account: custom columns (eight types), row-by-row data entry, read/write through the API-key machine channel; also provides a sync entry with Feishu (Lark) Base and Feishu event callbacks. |
| **RPA Automation** | RPA tasks (creating a task binds script + account + run parameters), RPA accounts (credentials encrypted at rest), RPA scripts (Automa JSON / JS / Python, generatable from requirements by AIPDD text models); the local BitBrowser claims and executes tasks with an API key and reports results back. **Browser agent (local Chrome)** — the same AIPDD Enterprise extension logs in with your site account and becomes an online device: the cloud LLM can decide step by step while the extension executes in your browser (reporting a page map and screenshots, pausing on sensitive actions for manual confirmation, hard-stoppable at any time, and never receiving target-platform credentials), or press Alt+A to open the extension **side panel**, describe the outcome in one sentence, and the Agent plans and acts autonomously, multi-step, on sites you are already logged into and returns structured results; three modes Act / Crawl / Extract, with models from this system's model plaza and metered in platform credits. You can save **skills** (personal / site knowledge) and **recordings → tools** (replayed down the same local execution path as the Agent, password fields never recorded), and it ships a default **MCP**: while the device is green (online), the platform Agent and external MCP clients can dispatch tasks to it via `/api/v1/mcp` using the `browser_*` tools. You can also bind a deterministic action sequence (chrome_actions) for LLM-free replay, or start and schedule it from Agent / MCP and the "RPA matrix tasks" tab against an online device. The side panel can also create **scheduled tasks** (one-off / recurring frequency) that let this online device auto-run a goal when due; if the device is offline that round is skipped rather than backfilled, and disabling the account auto-pauses it. |
| **Content Creation** | One screen of tool cards: text-to-image, text/image-to-video, video cloning, digital-human video, person/product swap in video, image retouching / watermark removal, text extraction from audio & video, TTS, music creation, video dubbing, mash-up shorts, video-to-script reverse engineering, voice-over scripts / WeChat-Official-Account articles; two product-page optimization cards (**cross-border product page optimization**: English image packs for Amazon / Etsy / independent sites, hero and detail images driven by purchase reasons; **domestic product page optimization**: 750px long detail image packs for Taobao / Tmall / JD / Pinduoduo / Douyin, copy compliant with advertising-law superlative rules); create an image pack → the LLM produces a plan (purchase reasons, style lock, per-image prompts) → images generate one by one; an optional "per-image content note" maps images 1..N of hero / detail order; the page ends with the "video creation tool" (AIPDD Drama Agent, which accepts a pasted AIPDD / AIworkin API key directly). Video super-resolution and watermark removal go through Volcano AI MediaKit, which only appears after adding a MediaKit channel with a key in Model Settings; the "video template community" sorts by usage / newest / most-bookmarked with keyword search, publishers list a sample + reference images + prompt, viewing a recipe can cost points (paid to the publisher), and "use effect" carries the recipe into the generator to re-run with the viewer's own model. Generated results land automatically in digital assets. |
| **Marketing Tools** | Entries grouped by business chain into four groups — acquisition & conversion, content & search growth, data & lead mining, outreach & customer operations — with whole-card click-through. WeCom SCRM (the native SCRM is the single customer-sync source: customer / tag / group mirrors, live QR codes and welcome messages, auto-tagging, mass sends (manual confirmation cannot be turned off), on/off-job inheritance, SOPs and the employee sidebar H5, sensitive-word outbound blocking / inbound alerting only, four-dimension AI QA; once enabled, Qidian customer imports pause automatically to avoid double writes), influencer outreach (filter influencers by category / platform / followers and view contacts), AliCloud intelligent outbound calls (mapping multi-dimensional-table lists to call task groups), AliCloud Direct Mail (syncing contacts to the AliCloud recipient list), GEO-AI engine optimization (brand visibility in AI answers, topic pool, publishing-platform recommendations), SEO optimization (site audit via our own HTTP crawler is free; keyword research & term banks, rank tracking, competitor insight, backlink analysis & building, local SEO grids, programmatic bulk pages, structured data and index submission via IndexNow / Baidu Webmaster (JSON-LD exportable as .json), SEO reports and sanitized sharing (exportable as Markdown / self-contained HTML), term-bank and GSC "striking distance" keywords one-click to rank tracking / to GEO monitoring questions, backlink prospects one-click synced to the AliCloud Direct Mail recipient list (sync only, no sending), programmatic pages one-click saved as content assets; with a user-held, user-paid DataForSEO key unlocking real search volumes / rankings / backlinks — no key, no fabricated data, just guidance to configure; AI commentary runs on system models and bills points; from the distribution ledger, successfully published own-domain links can be submitted for indexing with one click), live QR traffic (fixed entry + multiple child codes distributed randomly / sequentially / by weight, with quotas, visitor stickiness and channel stats; short links use your own domain), Tencent Qidian (customer data / WeCom operations / member outreach; customers can be written into this system's CRM), Google prospect lead mining, five global big-data tools (company data / global trade / global business people / global influencers / global POI), AI sales management SalesBuddy; **multi-platform content distribution** — one piece of content published to 13 channels through the AIPDD Enterprise browser plugin (image-text feeds: Weibo / Xiaohongshu / Douyin / Kuaishou / WeChat Channels / Knowledge Planet; articles: Zhihu / Toutiao / Baijiahao / Bilibili column / Official Account / Jianshu / Douban); the body is written in a rich-text editor, sanitized against a whitelist before storage, then degraded by the plugin per channel capability into styled HTML / Markdown / plain text; draft — pending — delivered — success/failure statuses and per-platform results are all visible in this system's ledger; publishing happens locally in your signed-in browser and platform credentials never leave your machine; **survey design & research** — question-by-question design (single choice / multiple choice / short text / long text / number / date / rating), after publishing generate a login-free fill-in link and QR code, every response auto-written into a dedicated multi-dimensional table per survey (filterable, exportable, Feishu-syncable), the admin aggregates option shares and numeric averages per question, and questions lock once published with responses so historical data stays consistent; **marketing skill library** — seven categories of skills (content / social / email / SEO / ads / research / sales) plus brand context, run by filling parameters; with no model key it produces rule-based output, results settle into content assets, with channel-capability connection / invocation, run evaluation and scheduled tasks supported. |
| **Digital Asset Management** | Fully in sync with AIPDD digital assets: query by file / image / video / audio, tag, upload directly (uploads are registered with the platform; no local copies); asset cards are fixed at 4 per row and do not stretch with count. There is also a "shared materials" tab: share this account's assets with other accounts in **the same organization** — verified enterprises share across enterprise members; providers share across the owner and currently employed staff (both `org_staff` and `provider_staff` affiliation records are honored); sharing only draws from this account's own ledger, target users must be on the organization's roster, multiple or all can be selected and shares may be revoked anytime; sharing registers only the access relation — files remain owned by the uploader. |
| **AI Mail Service** | Add multiple mailboxes (POP3 / IMAP) per signed-in account, read inbox and drafts in real time, **mail bodies and attachments are never stored in the DB**; configure scenario playbooks; the reply mode is "draft only" or "draft and auto-reply"; Agent scheduled tasks use the mail tool to draft replies per playbook; the list shows today's sent / drafted counts and the month-to-date volume processed. There is also an **email templates** tab: template variables, sandbox preview, and sending a test mail to a chosen address. |
| **CRM** | Account-level customer relationship management: leads, customers, opportunities, sales contracts, payments received, orders, approvals and reports, with follow-up records and AI assistance; members and permissions reuse this account's "staff and agents". The **quotation tracker** tab turns sales quotes into templated PDFs (classic / modern / minimal) with public links carrying view and send records. Once an order's approval passes, a project is auto-created idempotently per "same organization + same order", with the budget set to the order amount and the project owner synced, and the order detail shows "auto-created project #id"; lead-to-customer conversion writes back to WeCom SCRM contacts, and AI service-desk conversations convert to CRM leads with one click. The customer 360 view also has a "WeCom" tab: look up WeCom contacts per customer, owning employee, tags and last interaction. |
| **BI Analytics** | Account-level BI: built-in curated CRM datasets + external PostgreSQL / MySQL read-only sources; ask-your-data, charts and dashboards. |
| **OA** | Organization-scoped form requests and multi-level approvals: leave, expense claims, payments, procurement, seal use; members come from "staff and agents", business data such as CRM can be attached, approval results write back, with scheduled reminders and to-dos. New requests support **one-sentence AI drafting**: describe the matter and it matches a template and prefills fields for you to review before submitting. |
| **OKR Planning** | Organization-scoped: annual / quarterly / monthly cycles, goal trees from company to individual, weekly / daily plans, daily & weekly reports and cycle retrospective scoring. The **AI decomposition** tab runs "goal brief → interactive clarification → three candidate plans → simulated validation → human confirmation to commit": the brief captures the overall business goal and the project iron triangle (scope / duration / budget / people / equipment / devices / external services), with pre-checks before decomposition (cycles, members, deliverables, external entities); the AI emits only structured questions and assumptions per round — owners, metric sources, amounts and dates are all validated against the organization whitelist and user input; with no model configured, rule-based plans are used and clearly labelled "rule"; goals, KRs, tasks, task links, personal OKRs and projects are created only after confirmation. Tasks carry acceptance criteria, quality tiers and assessment weights, with a preview of scores computed from KRs / tasks. Each goal opens a "details" drawer: progress, key results, linked tasks (weights / backfilled target values / acceptance items) and progress records (labelled manual / automatic / plan / system, with before/after values). |
| **HR Workbench** | Five base tabs — records, attendance, recruiting, interviews, offers & reviews — plus **appointment management** (busy/free slots, public booking links, appointment ledger), **onboarding** (role-based templates → offer acceptance auto-kickoff → item-by-item check-off) and **voice transcription** (interview / conversation transcription, AI summaries, score write-back); members and permissions reuse the organization's "staff / agents"; the recruiting side shares the same job postings as the networking recruiting plaza. |
| **Project Management** | Project master records, members and milestones, iterations and task dependencies, time logs with weekly-timesheet approval; AI provides WBS decomposition suggestions and project health assessment, and decomposition results are written in one batch only after human confirmation. The **cost** tab computes labor cost automatically as "approved hours × effective rates", registers materials / equipment / external services line by line, and shows budget consumption and hours without configured rates in real time; the **external collaboration** tab centrally maintains the supplier / OPC / individual / partner directory and cooperation orders (draft → fulfillment → pending acceptance → settlement/cancel), and accepted work auto-generates external cost items. Tasks support three takers — internal staff, task contractors and external partners — and can carry acceptance criteria, quality tiers and assessment weights. Tasks can **issue external demands**: publish scope / deliverables / budget / timeline / acceptance terms to external entities, collect quotes and promised durations, adopt one, and the system creates the external cooperation order, reassigns the task and folds the cooperation into acceptance and costing. The **time audit** tab keeps before/after values of every edit with per-person rollups; the **task sync** tab supports two-way sync with Jira / Teambition / TAPD. Projects and tasks both carry a "collaboration" drawer: comments / replies / @mentions of colleagues, tags, resource links and bookmarks; comments are sanitized against a whitelist before writing, and @ mentions are limited to standing members of this organization with in-site notifications. The project detail also has "delivery" and "cost" summary tabs: delivery shows task done / in-progress / overdue counts and acceptance weights; cost shows budget, incurred cost, budget usage, external cooperations and booked hours (maintenance stays in the project page's "cost" tab). |
| **Inventory & Purchasing** | Products / variants / categories / warehouses, stock movements and transfers, requisition approvals, purchase orders and receiving, suppliers, receivables/payables and payments, expense claims, tax rates and pricing policies; AI gives business insights across stock / purchasing / receivables / cash flow, produced rule-based when no model key is configured. |
| **AI Service Desk** | Account-level customer service: one account can attach multiple website widgets; visitors enter through the site's chat widget (same-origin iframe `/embed/service-desk`) and are served by this organization's staff / agents; eight tabs — conversations, **after-sales tickets**, agent teams, reception settings, canned phrases & knowledge, sites & access, channel access and statistics. After-sales tickets move through the state machine pending → review → approved / goods received / shipped → completed with an event timeline. Reception status is Online / Away / Offline and only Online participates in auto-assignment; per settings the AI provides fixed copy, reply suggestions, or full auto-response; auto mode can hand off to humans anytime, while the pure-AI reception mode never hands off. |
| **App Center** | A merged entry for built-in apps and the app marketplace: the home page searches "apps I built / apps this enterprise built / marketplace apps" by keyword, plus four tabs — enterprise-created, created by me, joined by me, and the marketplace. Built-in app entities are backed by multi-dimensional tables with role-based member read/write; the marketplace is a read-only view of an external public catalog — this site stores no apps and neither lists nor reviews on anyone's behalf. |
| **Topic Hall** | Publish internal-enterprise or public topic discussions: internal ones are joined by this organization's and contracted / handling partners' staff; public ones are open to all signed-in accounts; the initiator may close the case (AI summarizes all posts and replies), reopen it, or lock or delete it; speakers may sign as themselves or via their digital avatar. |

### 4. Business Services (11 Service Lines + Supply-and-Demand Market)

Uniform shape: **provider resource directory** (browse the list → details → initiate signing) + **demand feed / service marketplace** + **business ledger**.
Providers must complete filing and pass the matching category qualification before their resources go public; when a section has only one provider, no list is shown and its detail is embedded directly.
The supply-and-demand market is a cross-section public marketplace with no per-section filing gate; both the demand / service lists are **paginated** (no infinite scroll),
filterable by **region (province / city) and second-level category**, with the category columns (first / second level) shown per row; besides the two lists there is a **reviews** tab
(rating distribution, review ledger) — review data also feeds each provider's displayed score.

Each service marketplace and the supply-and-demand market's **demand / service** lists also carry the filter pair "**All (demands / services)** / **My posts**":
"All" reads AIworkin's public pool for that category; "My posts" reads this system's ledger (publishing writes locally first,
then syncs to the platform and records back the platform content ID). Per the user ruling of 2026-11-09, "My posts" **renders only for the service-provider identity**;
for the enterprise identity the filter never appears (only "All"). Records formally published to AIworkin are neither edited nor deleted in this system —
only "view" is kept — the platform REST write APIs (PATCH / DELETE) return 401 for API keys, and MCP exposes no edit/delete tools either.
The menu keys for every **service marketplace** (logistics / marketing / cross-border / flexible employment / IT / IP / legal / think tank / assets / supply & distribution / tax & accounting) are all "×× Service Marketplace",
with the same entry in the body: All services = the platform public pool, My published services = the local ledger; Supply & Distribution Network / Tax & Accounting Services were
renamed from "service publishing" and merged on 2026-11-09 (user: "unify with the other marketplaces — see both the public pool and my own services").
**The Supply & Distribution Network marketplace tab is also shown to enterprises** (2026-11-09): the marketplace is browsable by everyone — enterprises simply cannot publish services:
the "publish a service" entry is not rendered for that identity, the "my published services" filter never appears, and the backend `assertPublishAllowed` gate uses the same rule.

| Section | Contents |
|---|---|
| Marketing services | Influencer store visits / livestream selling · demand messaging channel |
| Supply & Distribution Network | B2B supply-demand collaboration: service stations, product ordering, offline service appointments (quoting done by the provider or its assigned staff) and the supply-and-distribution service marketplace |
| Tax & accounting services | Filing materials, declaration plans, account-set management, automation capabilities, demand information and the tax service marketplace; declaration plans generate automatically from the contracted enterprise's taxpayer type (general / small-scale) and filing frequency (monthly / quarterly / annual); once enterprise capability is enabled, QiXiangYun performs auto-filing, auto-invoicing and issued-invoice queries |
| Cross-border | Cross-border service providers and go-global service tools |
| Flexible employment | Resource directory, employment demands (including worker onboarding) and flexible payroll (platform-level on/off, enabled by default) |
| Logistics services | Domestic ground freight / cross-border forwarding · demand messaging channel |
| IT services | AI implementation / software development / compute / hardware / data · demand messaging channel |
| Intellectual property | Agency / agent resource directory, demand messaging and consultation & enforcement |
| Legal services | Lawyer / law-firm resource directory and demand messaging |
| Think tank services | Institution / expert resource directory and demand messaging |
| Asset trading | Asset leasing & sales and brokerage services · demand messaging channel |
| Supply & demand market | Cross-section public supply-and-demand market: the **demands / services** two tabs each offer the filters "**All (demands / services)** (the AIworkin platform public pool, read via the platform channel, browsable even without a bound key) / **My published services** (this system's ledger, rendered only for the provider identity)"; publishing writes this system's ledger first, then syncs to the platform and records the platform content ID back; records already published to the platform only offer "view" in this system (neither platform REST writes nor MCP support edit/delete); both lists are paginated (no infinite scroll), filterable by region and second-level category; every signed-in account may publish, and published content goes through automatic publication review |

- **Contract signing**: the enterprise initiates → the provider confirms → the contract enters the ledger; platform admins may terminate active contracts under "contract oversight".
- **Official service packages**: every business section's provider column shows the platform's official packages (an RMB reference price + a points price converted via the admin-configured exchange rate); enterprises buy directly with points; after purchase the platform orchestrates signing each line item with multiple vetted providers — the package wording is "this package is delivered by vetted providers integrated by the platform" — and every signing still requires provider confirmation (preset providers trigger auto-initiation only, never auto-confirmation); delivery progress reads live contract status. The admin's "service packages" screen maintains the catalog and the delivery queue (matching, orchestrated initiation, entity substitution, partial/full refunds); purchase limits count per enterprise; packages are excluded from delivery-cycle and expiry management; on the user side "My Packages" shows purchased packages and per-item delivery progress.
- **Capability enablement**: e-filing / e-invoicing are paid capabilities: providers configure them per served enterprise, enterprises submit enablement applications and the platform reviews; enterprise-level enable/disable and QiXiangYun account matching are centralized in the admin's "tax & accounting management".
- **Business boards**: the **demand feeds** of tax & accounting / supply & distribution / cross-border and similar sections all read this system's ledger (`market_listing_records`)
  instead of the platform public pool directly; publishing syncs to the AIworkin platform through the unified MCP channel
  and writes the platform listing number (content ID) back to the local ledger; records formally published to the platform offer only "view" here. The **service columns** of these sections have been unified since
  2026-11-09 as "**×× Service Marketplace**", reading this system's service ledger (`provider_service_listings`) with the
  "all services / my published services" toggle (all = the platform public pool); publishing likewise writes locally first, then syncs to the platform and records the listing number back.
- **Supply & demand market**: the menu entry sits under "Business Services"; the API reuses `/enterprise/market/:domain/...` with
  `domain=HUB` for cross-section: both the demands / services tabs have the "all / my posts" filters — "all" reads only the platform **public pool**
  (so no channel-authentication failure even without a bound key), "my posts" reads only this system's ledger (`scope=mine`, rendered only for the provider identity);
  both support region (province / city) and second-level-category filtering (categories are selectable across business sections, with first-level categories shown per row);
  lists are shown by page, fetching the next cursor segment only on page turn, rather than stacking a long scroll beside the list;
  publishing writes straight to the platform with the AIPDD API key bound to the current account while keeping a local ledger, and published content likewise passes Aliyun content-safety review;
  records already published to the platform cannot be edited or deleted in this system — only "view" remains.

### 5. Business Networking (Social / Recruiting / Supply & Demand)

- **Business social**: connect with peers (friends / blocklist), publish posts (public / friends-only), Douban-style groups (discover / join, categorized threads,
  per-item anonymity, floor replies and recommendations, group owner / admin pinning & featuring and membership approval), in-site direct messages, career resumes (a standalone HTML page forked from the profile,
  presentable inside DMs, instantly viewable by employers and exportable to PDF). When an account is banned, social capabilities are blocked automatically.
- **Recruiting**: post full-time / part-time / internship / temporary / labor-dispatch jobs into the recruiting plaza feed, coordinated through in-site DMs (resumes can be attached);
  this system does not provide an ATS resume database or screening; with an AIPDD key bound, jobs can be synced as AIworkin employment demands (the category is fixed to the "flexible employment" subtree).
- **Supply & Demand Plaza**: publish demands / services generically into the local feed, viewable and contactable via DM.
  **Two-stage publishing** is a core design of this project: by default everything publishes locally without a key; checking "publish also to AIworkin"
  calls upstream `POST /market/listings` through the unified credential resolver with the user-bound key, and mirrors back upstream review / withdrawal statuses.

### 6. Admin Settings

| Module | Contents |
|---|---|
| Identity & Qualifications | User info takes effect on submission; provider filing requires review; staff need binding or affiliation |
| Staff / Agent Management | Team overview, affiliation approvals and current staff; includes the IM connector (Feishu (Lark) / WeCom) directory sync and callbacks |
| Contract Management | Contract overview and all contracts (enterprise initiates, provider confirms) |
| Points Center | Dual-currency display of points and AWcoin, top-up, gifting, transaction ledger and orders; **promo codes** can deduct by order amount or convert into points (platform admins maintain the code pool; users redeem on the spot and it credits instantly) |
| My Packages | Purchased official service packages and per-item delivery progress: packages are delivered by vetted providers integrated by the platform, the platform orchestrates signing enterprises with providers, and progress reads live contract status |
| My Invitations | Personal invitation code, sign-up link, invitation relations and counts |

### 7. Platform Admin Console (`/admin`, 26 Sections)

The sidebar is organized into 5 groups; the platform data overview is merged into the executive dashboard (`/dashboard`) and the sidebar no longer keeps a separate overview section:

| Group | Section | Description |
|---|---|---|
| Users & Providers | Registered users | All accounts: username, nickname, email, account status |
| Users & Providers | Enterprise users | Users who have passed enterprise verification (enterprise / individual business) |
| Users & Providers | Provider filings | Review of filing applications; approval auto-grants the provider role |
| Users & Providers | Provider management | Filed providers and their service-type qualifications, individually suspendable / restorable (suspension takes resources offline and blocks new business of that type) |
| Users & Providers | Provider capability enablement | Review of tax-automation paid enablement applications |
| Business Operations Oversight | Flexible employment | Platform-level on/off for the "flexible payroll" module (enabled by default) |
| Business Operations Oversight | Contract oversight | The full contract ledger; active contracts may be terminated |
| Business Operations Oversight | Supply & distribution oversight | Platform-wide overview of service stations, product orders and service appointments |
| Business Operations Oversight | Live QR oversight | Platform-wide live-code list: owning account, entry domain, cumulative scans; violations can be delisted |
| Business Operations Oversight | Creative community | Community workflow review and featuring; featuring credits the publisher with points (rules configurable) |
| Business Operations Oversight | Video template community | Whether to additionally display AIworkin platform templates (manual / scheduled sync, sync-now and last sync result) |
| Business Operations Oversight | Tax & accounting management | QiXiangYun filing-API key account pool and tax-number matching; review of paid enablement applications |
| Business Operations Oversight | GEO settings | Weekly GEO auto-collection task quota (planned / actual, per-project detail) |
| Billing & Products | Points & top-up | Exchange rate and top-up tiers, registration / invitation rewards, gifting limits and risk control, per-module price sheets and usage (AI insights / HRM / knowledge base / marketing / recruiting / skill-review prices pre-seeded), account adjustments and top-up orders |
| Billing & Products | Service packages | The official service-package catalog (listed per section, RMB price + points price at the configured exchange rate, delivery items with "preset provider / manual assignment" as a choice — presets only auto-initiate and still require provider confirmation; purchase limits per enterprise) plus delivery management: purchase queue, per-item provider matching, platform-orchestrated signing, entity substitution, partial/full refunds |
| Billing & Products | Model plaza | Model catalog and upstream channels: listing pulled from channel baseURLs, pricing (unit / tiered / cached price / discounts), usage ledger and the OpenAI-compatible gateway |
| Billing & Products | Entitlements & quotas | Entitlement catalog and per-package quotas: configure totals / cycles (daily / monthly / yearly) and over-limit policy per feature key, grant per enterprise or provider entity item by item, usage queryable |
| Capability & Security | Feature governance | Feature-directory switches, Agent egress blacklist and sandbox hard limits, skill / plugin review ledger and manual release, AI gates (platform master switch + organization overrides + per-user×organization requests-per-minute limits) |
| Capability & Security | Skill generation | Check this system's MCP business domains and actions; the model then generates, one by one, zip skill packages with a `SKILL.md` at the root; after download they can be published to SkillHub for traffic, and the catalog grows automatically with the MCP interface |
| Capability & Security | Publication review | Configure the Aliyun content-safety AccessKey (encrypted, masked only) and the access region; publishing demands and publishing services are mandatory scenarios; community posts and resume publishing are opt-in. Once enabled, the four publish actions are sent for review before storage, hits on block / review are rejected outright and written to the review ledger; upstream timeouts or failures degrade to pass-through with an ERROR log and never block normal publishing |
| Capability & Security | Usage telemetry | Page and action event ledger: daily aggregated event counts, distinct entities and top events for feature-usage and retention analysis |
| Capability & Security | Smart hardware | Hardware model catalog, dev-kit versions (SDK / firmware uploads and download counts) and per-model default API / MCP tools; user-attached devices and self-built tools live in the user-side "smart hardware" section |
| System & Content | Terms versions | Multi-version management of terms of service / privacy policy: rich-text body, effective time, whether re-acceptance is forced; user acceptances record version, time and IP |
| System & Content | Changelog | Product-level changelog: per-version added / improved / fixed entries, published on the `/help` "changelog" tab |
| System & Content | Platform upgrade | Pull an upgrade package from a GitHub Release or upload one manually into `update/`; the platform Agent compares the current version with the package and gives risk and execution advice; after confirmation it force-backs up the database, by default also backs up code, and auto-rolls back, with a separate executor completing install / build / migrate / restart in maintenance mode; the backup ledger supports one-click restore of "database + code" or "database only" |
| System & Content | System settings | File storage (OSS) and capacity ledger (usage, pricing, batch migration of legacy assets), the AIPDD platform key, platform-level parameters, site settings and homepage settings (tab-switched, save-to-apply; homepage settings maintain the official landing page's copy, images and section visibility) |

### 8. Model Services

- **API Key Management**: two key systems managed separately — this system's `ek_` keys for the open APIs (`/api/v1`) and the model plaza; generate / copy / reset / revoke all happen on this page,
  and each key can have its own "points budget" (a cumulative cap on external-call consumption; calls beyond it are rejected, or set it to unlimited);
  the AIPDD API key (`sk-`) is bound on the same page, enabling upstream synced publishing, provider data sync, connection resources and more. Keys are stored encrypted; only the owner can copy them at any time on this page and they are invisible to others.
- **Model Plaza** (`/model-plaza`): the platform's uniformly listed catalog of usable models — billing units match upstream (chat / embeddings per token, images per piece, video and speech recognition per second, speech synthesis per call),
  with online trials, the usage ledger, and serving through the OpenAI-compatible gateway via `ek_` keys; the catalog, upstream channels and pricing are maintained in the admin under "Billing & Products → model plaza".
  The admin also has a "default models" tab: set the platform default per capability — text / vision / image / video / speech recognition / speech synthesis / embeddings — with per-call, daily and monthly point budgets and a change log;
  users who have completed a real top-up automatically inherit the defaults for any capability they have not configured themselves (only paid top-up orders count; grants and adjustments do not), and calls debit their own points at catalog prices.
- **API-MCP-Skill** (`/developer/api-mcp-skill`): the unified entry for model services; the three tabs are ordered as follows —
  **Skill**: the list of skill packages generated by platform admins per business domain (name, description, domain, actions covered, generating model, updated time); "download" grabs the zip;
  the package contains only call instructions and examples — no real keys; regenerating a same-named skill overwrites the old package; the list and download share one menu switch.
  **MCP Server**: Codex, Claude Desktop, Cursor, custom scripts and Workbuddy all connect with the same API key;
  the server first analyzes this account's agent memory, then executes site actions automatically per authorization. The interface list derives from the contract layer; new modules (ERP inventory & purchasing, SEO workbench, AI lead acquisition, WeCom SCRM, project tasks, HRM, etc.) automatically join `list_operations` as soon as they enter the contracts;
  actions that directly move the books — approval outcomes, money in/out, stock movements (including ERP inventory / purchasing / receiving / expense approvals, settlement of payments and receipts, in/out stock ledgers) — are on a permanent exclusion list and can only be confirmed by the person in the UI.
  **API**: the catalog of interfaces this system actually exposes, derived from the contract layer and same-sourced with the MCP server's `list_operations` and the OpenAPI document.
  The legacy addresses `/developer/docs` and `/developer/mcp` keep redirecting, landing on `?view=api` and `?view=mcp` respectively.
- **Model Settings**: the model configuration shared by the Agent and content creation — the AIPDD built-in channel just uses the sk- key, other OpenAI-compatible gateways and Volcano MediaKit can also be connected, and a default model is chosen per type;
  the top of the page shows the current "platform default models" effect (inherited by top-up-qualified personal users who have not configured) and today's / this month's used budget.
  Platform admins can set each compute channel's support scope under "model plaza → user channels" (all supported by default): closed channels cannot be added / modified or selected by users;
  closing AIPDD only stops its compute (model settings / model plaza) — other features (business services etc.) keep working normally with the same AIPDD API key.
- **Platform Mechanisms**: the unified entry for §5.8 cross-cutting capabilities — event Outbox and Webhook subscriptions (tests, delivery records, failed retries; the event catalog covers task, project, CRM lead / order / payment, external demand, external cooperation and other business nodes), CSV import (field mapping, dry run, reusable mapping schemes) and per-module export (export files no longer get long-lived public links; a login-state endpoint re-checks the current organization and serves them back), report catalog, rules engine (condition matching + invoking Webhooks / notifications / insights / task creation), public shares (password, expiry, disable; every open re-checks the creator's organizational standing — when the initiator leaves / is removed from the org the share is invalid), OIDC identity providers (discovery tests, automatic account provisioning), attachment sharing policy, Feishu (Lark) / WeCom contact, attendance and card-message sync, plus terms-acceptance audit trails (a site-wide banner when a new version is unaccepted), product usage telemetry (page / action events with aggregation dashboards) and the entity switcher (one natural person switching the HRM scope across enterprises / providers), and the page-aware copilot (a site-wide floating entry). All business tabs site-wide are unified into wrapped pills (`PanelTabs` / `TabStrip`), no longer mixing in antd Tabs.
- **Help Center**: the chaptered `/help` knowledge base is versioned with the code (help files live in `backend/src/help`), covering module usage; the same page also hosts the "changelog" tab with the product-level changelog; the knowledge body is exposed through three read-only MCP actions `Help_chapters / Help_topic / Help_search`, so users can ask the Agent directly for official usage.
- **OpenAPI snapshot**: `/api/openapi.json` (1947 operations), verified by CI against the repository snapshot.

### 9. Smart Hardware

A standalone **Smart Hardware** section in the sidebar (a first-level group placed after Admin Settings): users browse hardware and dev kits, attach their devices to the platform, and call the **dedicated** MCP tools (Agent control) and APIs (programmatic control) per hardware type; platform admins maintain the model catalog, dev-kit versions and model default tools.

- **Hardware Plaza** (`/hardware`): the model catalog shown by recommendation / sorting; each model lists specs, dev-kit version (stable / preview channel) and downloads; dev-kit binaries go straight to this site's OSS, downloads are counted, and the page provides the SHA-256 for verification; the model detail shows that model's default API / MCP tool list.
- **Add Hardware** (`/hardware/devices`): pick a model to attach a device; a device token starting with `hw_` is generated (the plaintext shows exactly once at generation; only its SHA-256 is stored); devices come online by heartbeating once the service address and token from the SDK / firmware in the dev kit are filled in; the list groups devices into online / offline / never-reported (no heartbeat for over 180 seconds turns offline), and per-device heartbeat / command / result streams can be inspected for troubleshooting.
- **Hardware MCP** (`/hardware/mcp`): the standalone hardware MCP server `aiworkin-hardware-mcp` (endpoint `/api/v1/hardware/mcp`), fully separate from the platform MCP — tools come only from the hardware tool table, named `hw__<model code>__<tool code>`, authenticated with the `ek_` key from "Developer → API Key". Write tools pass a three-layer authorization gate: unless checked as "auto-executable" on this page, a call from an unattended scheduled task, or one declaring dryRun, returns a draft only and is never actually dispatched; the owner's own "test call" is exempt.
- **Hardware API** (`/hardware/api`): the same batch of tools is reachable through `/api/v1/hardware/**` with the `ek_` key; plain `curl` can list and call them; tool parameters and responses follow the JSON examples shown on the page.
- **Dev Kit**: the repository root's `hardware-devkit/` ships directly compilable SDKs and examples — an ESP-IDF component for ESP32, a pure-stdlib Python package for Jetson / Raspberry Pi, two runnable examples, plus a zero-dependency Node simulated device (completing the full "heartbeat → pull command → report result" loop even without hardware) and field-by-field protocol docs; prebuilt firmware will be added after the first real-device builds.
- **Admin maintenance**: the platform admin's "smart hardware" section has three tabs — "hardware models / dev kits / default tools" — for maintaining the model catalog, uploading dev-kit versions and per-model default API / MCP tools; changes are visible to users instantly. User-created tools are visible and usable only by their creator, never enter model defaults, and are not published to any marketplace in this first version.

The device channel (`/api/public/hardware/heartbeat`, `/commands`, `/result`) accepts only device tokens, requires no login, and is **deliberately exempt from feature switches**: when admins switch off the "smart hardware" section, heartbeats of already-attached devices are not cut off.

### 10. Points and Billing

- **Points**: WeChat top-up, account-to-account gifting, per-module price sheets and usage debits (digital-asset storage, CRM / BI / OA / AI service desk), with the ledger and top-up orders on one screen; price entries are already pre-seeded for AI insights / HRM / knowledge base / marketing / recruiting / skill review, taking effect when the matching modules go live.
- **Storage foundation**: attachments and digital assets upload directly to this site's Aliyun OSS (no more relay through upstream); assets can be deleted item by item, and the admin's "system settings → file storage" shows capacity, pricing and batch migration of legacy assets (interruptible and resumable, retryable on failure).
- **AWcoin**: read-only display of balance and sources — **never exchangeable** with points.
- **Admin configuration**: exchange rate and top-up tiers, registration / invitation rewards, gifting limits and risk control, per-module price sheets, account adjustments and order queries.

### 11. i18n, Site and Notifications

- **8 UI languages**: 简体中文 · English · Tiếng Việt · 日本語 · العربية · Français · Español · Русский;
  admins can set the site default language, visitors switch at any time, and Arabic renders the whole site RTL.
- **Three-tier site domain priority**: admin "site settings → site domain" > `SITE_URL` > the visitor's current origin;
  absolute addresses for the MCP / API endpoints, IM callbacks, service-desk embed script, live-QR entries, invitation links etc. are uniformly built this way (see "Site domain" below).
- **Menu visibility**: every front-facing sidebar menu (the dashboard entry + every group, including the "AIPDD Compute Platform" external link) can be individually hidden via the admin's "site settings → user-side menu visibility"; when all items of a group are hidden the group disappears (this hides menus only — links remain accessible).
- **Tab visibility on section pages**: for the 12 "business services" section pages (marketing / supply & distribution / tax & accounting / cross-border / flexible employment / logistics / IT / IP / legal / think tank / asset trading / supply & demand market), the "demand feed" and "service marketplace" tabs can be individually hidden per section in the admin under "site settings → business-section tabs (check to hide)"; same policy as menu visibility — hidden consistently for every identity (admins included), display-only (direct links and APIs stay open).
- **Top-bar browser plugin entry**: the unified icon in the top bar alongside notifications and the WeChat service account is the platform client's (AIPDD Enterprise) single download & installation entry — shared by marketing distribution, AI lead acquisition, the browser agent (local Chrome) and future product-page / SEO workflows instead of per-feature "install plugin" popups. The drawer has four tabs: download & install (current version, minimum compatible version, supported browsers, installer, steps), usage guide (each business capability's entry and FAQ), release notes, authorized sites (view / revoke sites the plugin trusts). Opening it auto-handshakes (no manual refresh button): if not installed you get step-by-step guidance, an outdated version marks the icon with a dot and guides the update; when browser limits block detection you may confirm "I have installed it" manually, but real handshakes still verify before any business execution. If the platform has published no installer, or the admin turned off "site settings → top browser plugin entry", the entire icon is not rendered; installer URLs are composed from the site-domain setting — no customer domain is ever hard-coded.
- **System messages**: six categories of events are surfaced centrally — service desk, demands & opportunities, identity & contracts, tax & filings, automation & integrations, accounts & platform.

---

## 🧱 Tech Stack and Architecture

- **Backend**: [Hono 4](https://hono.dev) + `@hono/zod-openapi`, Prisma 5.22, MySQL 8 / PostgreSQL, Zod 4, Node.js ≥ 24
- **Frontend**: Next.js 16 (App Router) + React 19 + Ant Design 6 / Pro Components + `@tanstack/react-query` 5
- **Contract layer**: `packages/contracts` is the single source of truth for frontend, backend, MCP and OpenAPI (1947 operations, error codes, MCP catalog)
- **Auth**: this site's self-signed SSO session (HKDF-derived keys + account-version checks) + the open-API `ek_` key + the upstream AIPDD `sk-` key, three channels kept separate
- **Data permissions**: data always hangs off the `(orgType, orgUserId)` organization key; lists / details / exports / attachments / AI / scheduled tasks uniformly re-check "account standing + organization standing" (`HrmScopeService.isStanding`) before use, so a departure or role change takes effect immediately, with no reliance on async cleanup or caches; BI row/column permissions enter the same path for real queries, previews, charts and AI ask-your-data (row filters via `${userId}` / `${deptId}` placeholders, and permission-hidden columns are stripped before both results and model input); organization context only goes through the unified tenant-resolution service (`TenantScopeService.preferred`), so CRM / BI / OA share one "current entity" policy with HRM / OKR — the top entity switcher's selection is preferred while the relation is still valid, and data scope stays consistent across modules after switching

```
Browser ── Next.js (SSR/CSR, /api/backend/* same-origin reverse proxy)
             │
             ├── Hono API (/api/backend business, /api/v1 open API and MCP, /api/public public endpoints)
             │        ├── Accounts / identity / sessions   ├── Workbench (CRM·BI·OA·OKR·RPA·tables…)
             │        ├── Business services, 11 lines       ├── Social / recruiting / supply & demand
             │        ├── Points and OSS storage foundation └── Platform admin
             │        └── Upstream channels (AIPDD / AIworkin, user key or platform key)
             └── Prisma ── MySQL 8 / PostgreSQL (514 models, 52 migrations)
```

## 📁 Directory Structure

```
oem-enterprise/
├── backend/                 # Hono API
│   ├── prisma/              # schema.prisma (514 models) + migrations/ (52) + seed
│   └── src/                 # 91 business modules
│       ├── http/ account/ identity/ auth/    # composition (routes.ts is the composition root; routes split per domain under route-groups/), accounts, identity, sessions
│       ├── aiworkin/ content/ agent-memory/  # upstream channels, Agent, content creation and digital assets
│       ├── ecom-pdp/ domestic-pdp/           # cross-border / domestic e-commerce product-page image packs
│       ├── crm/ bi/ oa/ okr/ data-table/ rpa/ workbuddy/ livecode/ lowcode/
│       ├── social/ sns/ supply/ marketing/ logistics/ tax/ flex/ overseas/
│       ├── legal/ ip/ think-tank/ asset/ smart-service/                       # business service lines
│       ├── points/ oss/ asset/               # points billing and storage
│       ├── mcp/ openapi/                     # open API and MCP server
│       ├── hardware/                         # smart hardware (models / dev kits / devices / tools / standalone hardware MCP)
│       ├── admin/ platform/                  # platform admin and site settings
│       └── common/ shared/                   # dialect adapters, error codes, auth, upstream credentials
├── frontend/                # Next.js app (73 page routes, /social /admin etc.)
├── packages/contracts/      # shared frontend-backend contracts, error codes, MCP catalog
├── hardware-devkit/         # smart-hardware dev-kit sources (ESP-IDF component / Python SDK / examples / simulator / protocol doc)
├── scripts/                 # install, migration, verification and smoke scripts
├── infra/                   # nginx / deployment samples
└── docs/                    # overall design docs, OpenAPI snapshot, route baseline, screenshots and QR assets
```

Backend HTTP composition is two-tier: `http/routes.ts` is only the composition root (calling 27 registration
functions per domain), while the concrete routes live under `http/route-groups/` split per module (crm, okr, project,
erp, hrm, oa, kb, data-table, marketing, scrm, admin…); the three large services — OKR, platform mechanisms and projects —
are likewise split into per-domain files plus a thin facade, so `okr.service.ts` / `mechanism.service.ts` /
`project.service.ts` keep only public-method forwarding and the business implementation lives in the same-dir
`*.base.ts` and per-feature services.

---

## 🚀 Quick Start (local development)

Prerequisites: Node ≥ 24, pnpm ≥ 10, and a reachable **MySQL 8 or PostgreSQL** instance (choose one).

### Option A: one-shot install (recommended, database of your choice)

```bash
pnpm install
pnpm setup            # interactive: choose MySQL / PostgreSQL → enter connection info → write backend/.env → generate client → create tables
# or non-interactive: pnpm setup --db postgres --host 127.0.0.1 --port 5432 --user app --password *** --database enterprise --yes
pnpm dev:api & pnpm dev:web
```

`pnpm setup` will: ① write `DATABASE_URL` and `DB_PROVIDER` into `backend/.env`; ② for MySQL run the migration history via `prisma migrate deploy`, for PostgreSQL derive `schema.postgres.prisma` from `schema.prisma` then `prisma db push`; ③ generate the Prisma Client for the chosen dialect.

> The Prisma client and DDL are generated per dialect: after switching databases, re-run `pnpm setup` (or `pnpm --filter aiworkin-enterprise-api prisma:generate:pg`).

### Option B: manual configuration

```bash
# 1) Install dependencies (triggers prisma generate)
pnpm install

# 2) Configure backend env vars
cp backend/.env.example backend/.env
#   Edit backend/.env: set DATABASE_URL (MySQL or PostgreSQL), DB_PROVIDER, JWT_SECRET, EXTERNAL_CRED_KEY
#   (JWT_SECRET / EXTERNAL_CRED_KEY are local random strings; the backend refuses to start without them)

# 3) Configure frontend env vars
cp frontend/.env.example frontend/.env.local

# 4) Initialize the database (migration / db push + generate client)
#   MySQL:
pnpm --filter aiworkin-enterprise-api prisma:migrate:deploy
pnpm --filter aiworkin-enterprise-api prisma:generate
#   PostgreSQL (switch to the derived schema):
pnpm --filter aiworkin-enterprise-api db:push:pg

# 4b) (optional) Load demo data: enterprise profiles / provider directory / lawyers·IP·flexible employment / supply & distribution·marketing etc.
#      For directory and detail display only; demo identities are not loginable accounts — after signing in, use the local account registered in step 5.
pnpm --filter aiworkin-enterprise-api prisma:seed

# 5) Start backend (default 1690) and frontend (default 15890)
pnpm dev:api
pnpm dev:web
```

Open `http://127.0.0.1:15890` in a browser and register a local account to enter social and the supply-and-demand market.
The frontend proxies `/api/backend/*` to the backend server-side through Next.js, keeping the browser same-origin.

### Create the platform admin (required on first deployment)

The platform admin is **not** created automatically on install / startup; create it explicitly with `backend/scripts/seed-admin.ts` (idempotent, `--reset` resets the password):

```bash
# 1) Set ADMIN_USERNAME / ADMIN_PASSWORD in backend/.env
# 2) Run (creates on first run; skips if an account with the same name exists)
pnpm --filter aiworkin-enterprise-api exec tsx scripts/seed-admin.ts
```

Sign in with that account and the sidebar shows the platform-admin entry; without it you can only register ordinary users and cannot enter the platform admin.

### Key environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Database connection string: MySQL `mysql://user:pass@127.0.0.1:3306/enterprise` or PostgreSQL `postgresql://user:pass@127.0.0.1:5432/enterprise?schema=public` |
| `DB_PROVIDER` | `mysql` / `postgres`: basis for native SQL dialect branches (document-number auto-increment, JSON column access); when absent, inferred from the `DATABASE_URL` protocol |
| `PORT` | Backend listening port, default `1690` |
| `JWT_SECRET` / `JWT_ISSUER` | Local session signing key; must be replaced with a random value in production |
| `EXTERNAL_CRED_KEY` | AES-256-GCM derivation key for AIPDD keys / external-report credentials, configured separately and never falling back to JWT_SECRET |
| `AIPDD_PLATFORM_KEY` | Deployment fallback for the platform-level AIPDD API key (base-data channel); once saved under admin "system config → AIPDD platform key", the encrypted DB value takes precedence |
| `AIWORKIN_BASE_URL` / `AIWORKIN_ENABLED` | Upstream marketplace address and switch (when off, only local closed-loop features work) |
| `CORS_ORIGIN_PATTERNS` | Allowed cross-origin origins (comma-separated) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Account credentials read when running the `seed-admin` script to create the platform admin (not auto-created on startup) |

> All keys live only in the local `.env` (already in `.gitignore`); no API ever echoes the AIPDD key in plaintext.

### Database compatibility (MySQL / PostgreSQL)

Choose one at install time; at runtime `DB_PROVIDER` governs (inferred from the `DATABASE_URL` protocol when absent), and business logic runs equivalently on both. To smooth over dialect differences the following has been done:

- **Single schema source of truth**: `prisma/schema.prisma` (MySQL) is authoritative; when installing PostgreSQL, `scripts/gen-prisma-schema.mjs` deterministically derives `schema.postgres.prisma` (`provider=postgresql`, `@db.TinyInt→@db.SmallInt`, `@db.DateTime→@db.Timestamp`). MySQL builds tables via migration history, PostgreSQL via `prisma db push`.
- **Document-number auto-increment**: `document-number.ts` branches per dialect — MySQL uses `INSERT IGNORE` + `LAST_INSERT_ID`, PostgreSQL uses `ON CONFLICT DO NOTHING` + `UPDATE … RETURNING`.
- **JSON column access**: `jsonText()` in `common/sql-json.ts` builds the `->>` path per dialect (PostgreSQL `col->>'key'` / MySQL `col->>'$.key'`), used by big-data retrieval and lead-mining cross-task dedup queries.
- **BI ask-your-data / charts**: `internalScope()` in `bi/bi.internal.ts` issues placeholders per dialect (PostgreSQL `$1` / `ANY($2::text[])` / MySQL `?`); chart identifier quoting in `bi.query.service.ts` is chosen by target DB (PG double quotes / MySQL backticks for the app DB or an external source).
- **Client generation**: `postinstall` runs `scripts/prisma-generate-auto.mjs`, picking the default or derived schema from `DB_PROVIDER`/`DATABASE_URL`, so the PG client is not overwritten by the MySQL build on dependency reinstall.
- **Username case**: sign-in and uniqueness use **lowercase normalization** uniformly (MySQL's default collation is case-insensitive, PostgreSQL's is sensitive); emails are stored lowercase too, keeping login/dedup behavior consistent across both DBs; pre-existing mixed-case accounts still log in on MySQL (covered by CI), and existing DBs can run `pnpm --filter aiworkin-enterprise-api db:normalize-usernames` once (idempotent, works on both DBs, skips and lists collisions).

> Known difference: free-text search (`contains` keyword) is case-insensitive on MySQL and case-sensitive on PostgreSQL — Prisma's `mode:'insensitive'` is unsupported on the MySQL connector, so not all search statements are force-unified. Main content such as Chinese has no case and is unaffected; to make Latin search consistent too, create the PostgreSQL DB with a case-insensitive ICU collation, or lowercase the relevant fields before querying.

---

## 🐳 Docker Compose (with MySQL)

The root `docker-compose.yml` orchestrates three services — **MySQL + backend + frontend** — for a one-command trial:

```bash
# Every service dependency ships a local demo default (${VAR:-default}), so it just runs:
docker compose up --build
# To customize passwords / domains, create a root .env overriding MYSQL_* / JWT_SECRET / EXTERNAL_CRED_KEY etc.
# Backend http://localhost:1690  Frontend http://localhost:15890
```

On the first startup the backend runs `prisma migrate deploy` automatically to build tables. After the first startup, create the platform admin inside the container (compose already injects
`ADMIN_USERNAME` / `ADMIN_PASSWORD`, default `admin` / `admin-Startup-2026`, override in the root `.env`):

```bash
docker compose exec api pnpm --filter aiworkin-enterprise-api exec tsx scripts/seed-admin.ts
```

For production replace `JWT_SECRET` / `EXTERNAL_CRED_KEY`
with strong random values, and use an independent database and reverse proxy (`infra/nginx/` provides a sample config).

---

## 🌐 Site Domain (external access address)

Nothing is hard-coded to a local address: the MCP / API endpoints, IM callback and card "handle it" links, service-desk embed script,
live-QR entries, invitation links, suggested payment-callback values and other absolute addresses are all built with the following priority:

1. The value entered under "platform admin → site settings → site domain" (only http/https, may carry a port; stored and effective immediately, no restart needed)
2. The backend env var `SITE_URL`
3. The visitor's current origin (`window.location.origin`; single-domain deployments need no config at all)

Local development needs nothing filled in: in dev Next reverse-proxies `/api/*`, in production Nginx takes `/api/*` first,
so endpoints like `https://your-domain/api/v1/mcp` hold in both forms.
After changing the domain in the admin it is automatically folded into the CORS / origin-check allowlist; changing the `SITE_URL` variable itself still needs a restart.

---

## 🔑 AIPDD API Key Binding and Upstream Channels

- Users bind an AIPDD-platform-issued API key (`sk-`) in the "AIPDD API key binding" block on the "model services → API key management" page;
  multiple users may bind the same key (N:1, merged by fingerprint), stored encrypted with AES-256-GCM.
  The former standalone "AIPDD key binding" page (`/developer/aipdd`) has been merged into API key management, with the old URL redirecting to `/developer/keys`.
  These two pages (API key management / model settings) are account-level self-service, and **are not shown in the sidebar under the platform-admin identity** — to configure them switch to the enterprise / individual identity (the platform-level key lives under "system config → AIPDD platform key"); direct links still work.
- The same block carries registration guidance: once the admin enters an AIPDD referral code under "site settings", new users following the guidance register at www.aipdd.work and enter that code
  to receive compute credits (invitation commission goes to the admin); the env vars `AIPDD_REFERRAL_CODE` set the default code and `AIPDD_REGISTER_URL` overrides the registration address (only http/https).
- `backend/src/common/upstream-token.ts` is the **single credential entry point** for reaching upstream: business code no longer treats the local session token as an upstream credential,
  but swaps in the user's bound key; an unbound user triggering an upstream action gets a guiding `403` (local publishing is unaffected).
- **Base data goes through the platform key, not the user key**: reference data such as the province/city dictionary and platform dictionary items is independent of user identity, so the admin configures a single platform key under
  "platform admin → system config → AIPDD platform key" (the same `sk-` format validation and online verification, AES-256-GCM ciphertext stored in `system_settings.aipdd_platform_key`, masked on return, taking precedence over the env `AIPDD_PLATFORM_KEY`,
  and isolated from the generic system-parameter API's reads/writes). Resolution chain: platform key → the user's own bound key → otherwise the region falls back to the built-in local province/city dictionary
  (`backend/src/shared/region-dictionary.ts`, source `GEO_CENTERS`), so an unconfigured platform key does not block forms,
  though platform dictionary items still need a key.
- Publishing demands, syncing upstream, connecting resources and other **user actions still use each user's own bound key**, unaffected by the platform key.
- With `AIPDD_KEY_VERIFY=off` binding skips online verification (convenient for offline demos); online mode calls upstream to verify.

---

## 🧪 Build, Test and CI

Backend unit tests run under `backend/test/jest-unit.json` (ts-jest); frontend component tests use Vitest + Testing Library (jsdom); CI also runs environment templates, the OpenAPI snapshot, upload and migration checks:

```bash
pnpm --filter aiworkin-enterprise-api test          # backend unit tests (102 suites / 862 cases pass, 15 skipped by environment)
pnpm --filter aiworkin-enterprise-web test          # frontend component tests (goal brief / AI decomposition / customer 360 / project 360)
pnpm test:uploads                                   # attachment and invoice-image upload checks
pnpm test:environment                               # deployment template and env-var policy
pnpm api:docs:check                                 # whether the OpenAPI snapshot matches the contract layer
pnpm lint                                           # code style + prettier formatting, a hard CI gate
pnpm build                                          # contracts → backend tsc → frontend next build
```

- **Frontend build heap cap**: `build`, `typecheck` and `lint` all go through `frontend/scripts/with-heap.mjs`, defaulting to
  `--max-old-space-size=10240` (the default ~4GB heap OOMs when cold-compiling 55 pages or running type-aware lint, exit code 134);
  override with `NODE_HEAP_MB`; when explicitly configured it is passed through.
- **CI (GitHub Actions)**: install deps → build contracts → architecture and route baseline (`check-architecture`, including AI-gate direct-call checks) → environment template →
  OpenAPI snapshot → typecheck → **hard code-style gate (`pnpm lint`, incl. prettier formatting)** → backend unit tests → frontend component tests → upload checks →
  **empty MySQL 8 DB running `prisma migrate deploy` (0001→0052)** → frontend and backend builds.
- **Type-escape baseline**: `pnpm audit:escapes` generates `docs/escape-report.md` / `docs/escape-report.json`;
  `pnpm check:escape-budget` enforces against `.escape-budget.json` (totals and per-category counts only decrease) and `.escape-allowlist.json`
  (a registered entry whose line drifts fails), wired into CI (after the gauge self-test, before the other gates).
- **Line-ending policy**: `backend/.prettierrc` sets `endOfLine: "auto"`, validating against each file's existing line endings; Windows checks out
  CRLF with `core.autocrlf=true` while the index and CI are LF, so neither side false-fails. Other formatting items remain prettier defaults.
- **DB-dependent integration scripts**: `pnpm test:regression` / `test:query-plans` / `test:performance` / `test:geo-recovery`
  target a throwaway empty local PostgreSQL DB (`createdb` + `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`) and
  are incompatible with the default MySQL dialect, kept for on-demand local runs.
- **Smoke scripts** (PowerShell, pure ASCII, random usernames for idempotency):

```powershell
pwsh scripts/smoke-m5.ps1   # social closed loop (relations / posts / groups / DMs / resumes / ban inheritance)
pwsh scripts/smoke-m6.ps1   # supply-and-demand market: local key-free publish + unbound-key upstream sync 403
pwsh scripts/smoke-site-url.ps1            # site-domain normalization / CORS / public echo + page 200
pwsh scripts/smoke-aipdd-platform-key.ps1  # platform AIPDD key: ciphertext not leaked + region-dictionary fallback
```

---

## 🧹 Trimming Relative to the Upstream Commercial Edition

This open-source edition is a "merged + sanitized + localized" product and explicitly **excludes**:

- the SNS original NestJS backend and the aiworkin.com blue-and-white visuals (information architecture kept, styles fully rewritten in AntD);
- coin-related business such as awcoin rewards / settlement (the supply-and-demand market only mirrors upstream status and involves no coins; AWcoin in the points center is read-only display);
- platform-proxy `sk-` key lookup / application, `DEV_AUTO_LOGIN` in-place issuance and similar mechanisms (demo data is provided by `prisma:seed`,
  but demo identities cannot log in with one click — a normal local registration is required);
- the upstream Java directory service: the data source is changed to the local `users` table.

---

## 💬 Community

Join the AI enterprise-service-system discussion group by scanning the QR code below. You are welcome to report problems and propose improvements; good suggestions will be implemented and open-sourced.

<div align="center">
<img src="docs/assets/wechat-group-qr.png" width="260" alt="AI Enterprise Service System discussion group · WeChat QR code">
</div>

---

## 📄 License

Released under the [Apache License 2.0](LICENSE).
