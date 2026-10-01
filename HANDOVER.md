# HandyLine AI Receptionist — 完整工程交接包

> 给接手开发团队的快读指南。请先通读 README.md + SETUP.md + docs/MVP-PLAN.md，
> 再按本文件的"上手顺序"操作。

**交接日期**：2026-09-24
**打包者**：Mimatt（产品 + 运营） / 工程会话 Mavis
**版本**：截至 `2a8253e` 提交

---

## 1. 这个项目是什么

HandyLine AI 是面向北美 / 东南亚家庭服务承包商的 **AI 电话接待员**：

- **核心场景**：客户拨打承包商电话 → Vapi（语音）→ GPT-4o-mini 接待 → AI 决定接收 / 拒绝 / 转人工 / 紧急升级
- **数据**：订单 / 工单写入 Supabase，Dashboard 可视化
- **多区域**：1 个 Vapi assistant = 1 个 Boss（承包商） = 1 个 Supabase boss row
- **生产客户**：US Alex / Handy Works（已上线），MY H-Master Security（placeholder assistant）

---

## 2. 接手后第一周该做什么（按优先级）

### 第 1 天：让本地能跑起来

```bash
# 1) 解压到任意目录，进入项目根
cd handyline-ai-receptionist

# 2) 安装依赖
npm install    # node_modules 已排除在 zip 外

# 3) .env.local 已经在 zip 里，直接用。如果想换 secrets，复制 .env.example 改

# 4) 拉数据库 migrations 到 Supabase 项目（用 supabase CLI）
supabase link --project-ref <your-project-ref>     # cggqxaxunqxsgurgmiqh
supabase db push                                  # 应用所有 migrations/

# 5) 启动
npm run dev
# 访问 http://localhost:3000
```

### 第 2 天：理解架构

必读（按顺序）：
1. **README.md** — 项目概览
2. **SETUP.md** — Vercel + Supabase + Vapi + Twilio 全栈配置
3. **docs/MVP-PLAN.md** — 整体产品规划
4. **docs/MULTI-REGION-ARCHITECTURE.md** — 多区域数据模型（核心）
5. **src/lib/types.ts** — Boss / WorkOrder 等数据模型
6. **src/lib/order.ts** — `getBossByVapiAssistantId()` / `getBossByCountry()` 是 routing 核心
7. **src/app/api/vapi/tools/route.ts** — AI 工具调用的实际后端
8. **src/app/api/vapi/webhook/route.ts** — Vapi 通话结束 webhook

### 第 3 天：跑测试脚本验证环境

```bash
# 配置静态校验 — 不需要外部网络，34 项检查
node scripts/test-static-config.js

# Vapi 配置实时校验（会读 .env.local 和调 Vapi API）
node scripts/test-static-config.js --live

# 拉历史通话到 work_orders（默认 dry-run，先看输出再 --write）
node scripts/import-vapi-calls.js                  # 只多区域
node scripts/import-vapi-calls.js --regions us --write
node scripts/import-vapi-calls.js --regions my --write
```

---

## 3. 关键技术决策（不要随便动）

| # | 决策 | 为什么 | 在哪里 |
|---|------|--------|--------|
| 1 | 1 Boss = 1 Vapi Assistant = 1 Phone Number | 简化多租户；避免 assistant 串号 | `src/lib/order.ts` `getBossByVapiAssistantId()` |
| 2 | 路由按 Vapi assistantId（不是 phone number） | Country code 可能重复；assistantId 唯一 | `src/app/api/vapi/tools/route.ts` |
| 3 | gpt-4o-mini + eleven_turbo_v2_5 | 成本 vs 质量平衡 | `vapi/assistant.json` |
| 4 | TTS 数字必须拼读（"seven one three ..."） | ElevenLabs 朗读数字不稳 | `vapi/system-prompt.md` |
| 5 | 关闭电话前必须问"Anything else?" | 用户体验 | system prompt |
| 6 | 录音 + 转写 + 价格预览必须先存 Supabase Storage | Vapi presigned URL 30min 过期 | `scripts/import-vapi-calls.js` |
| 7 | SEA 范围：先只做 MY | 资源聚焦 | `docs/SEA-MARKET-TECH-STACK.md` |

---

## 4. 包内目录速查

```
handyline-ai-receptionist/
├── .env.local                    ⚠ 含所有 secrets，直接用
├── .env.example                  占位 schema
├── README.md / SETUP.md          上手 + 部署
├── HANDOVER.md                   ← 你正在读
├── package.json / package-lock.json
├── next.config.js / tailwind.config.ts / tsconfig.json
├── src/                          ← Next.js App Router
│   ├── app/                      路由 + page.tsx + api/
│   │   ├── api/
│   │   │   ├── vapi/             Vapi webhook + tools（核心）
│   │   │   ├── twilio/           Twilio 紧急路由
│   │   │   ├── cron/             定时任务（emergency retry）
│   │   │   ├── boss/             Boss callback
│   │   │   ├── dev/              开发种子 / 模拟通话（生产可关）
│   │   │   ├── admin/            管理 API（reclassify / llm-stats）
│   │   │   ├── v1/               v1 API（assistants / singlish-eval）
│   │   │   └── human-handoff-demo/  AI→人工桥接 demo
│   │   ├── orders/[id]/          工单详情
│   │   ├── preview/              客户预览链接
│   │   ├── human-handoff-demo/   AI→人工 demo UI
│   │   ├── landing/              营销 landing
│   │   └── config/               Boss 配置面板
│   ├── components/ui/            shadcn/ui 基础组件
│   └── lib/                      ← 业务核心
│       ├── order.ts              Boss routing + 订单处理
│       ├── validation.ts         服务范围验证（按 country）
│       ├── call-summary.ts       转写摘要（regex 回退）
│       ├── openai-summarize.ts   LLM 摘要（首选）
│       ├── vapi-event-handler.ts Vapi 事件分发
│       ├── emergency-call.ts     紧急通话重试
│       ├── types.ts              数据库类型
│       └── ...
├── scripts/                      ← 运维脚本（生产可直接 cron 跑）
│   ├── import-vapi-calls.js      真实电话同步 → work_orders（多域 + dry-run）
│   ├── import-vapi-webcalls.js   含 webCall dashboard 测试
│   ├── create-vapi-assistant*.js  新建 Vapi assistant
│   ├── update-vapi-assistant*.js 更新 Vapi assistant + system prompt
│   ├── test-static-config.js     34 项静态校验（必跑）
│   ├── test-conversations.js     24 个对话场景 LLM 行为测试
│   ├── analyze-calls.js          历史通话只读分析
│   ├── seed-demo-data.js / seed-my-demo-data.js
│   ├── clear-test-data.js        清空开发种子
│   ├── vercel-env-push.sh        一键 push env 到 Vercel
│   └── lib/call-summary.js       JS 端口 call-summary
├── supabase/
│   ├── schema.sql                全 schema（参考）
│   ├── migrations/               11 个有序迁移（按编号顺序执行）
│   └── config.toml               supabase CLI 配置
├── vapi/
│   ├── assistant.json            US Alex 当前配置
│   ├── assistant-my.json         MY H-Master placeholder
│   ├── assistant-sg.json         SG（空）
│   ├── system-prompt.md          US Alex system prompt（5767 字符）
│   ├── system-prompt-my.md       MY prompt
│   └── system-prompt-sg.md       SG prompt
├── docs/                         ← 11 个设计文档（按文件名读）
└── public/                       静态资源
```

---

## 5. .env.local 包含的 secrets（26 项）

打包时按用户要求**全部带入**，请接手团队：

- Vercel 收到包后**第一时间**改成自己管理的 secrets
- 不要上传到 GitHub / Notion / Slack 公开频道
- 处理完交接后**销毁本地 zip + 改所有 key**

```
VAPI_API_KEY                          # Vapi 主账号
VAPI_ASSISTANT_ID                     # US Alex
VAPI_EMERGENCY_ASSISTANT_ID           # US 紧急升级
VAPI_MY_ASSISTANT_ID                  # MY H-Master
VAPI_SG_ASSISTANT_ID                  # SG（空，待启用）
VAPI_ID_ASSISTANT_ID                  # ID（空，待启用）
VAPI_PHONE_NUMBER_ID                  # Vapi 电话号码记录

NEXT_PUBLIC_VAPI_PUBLIC_KEY           # 客户端公开 key
ELEVENLABS_CREDENTIAL_ID              # TTS 凭据
ELEVENLABS_VOICE_ID                   # TTS 声音 ID

SUPABASE_ACCESS_TOKEN                 # supabase CLI 用
SUPABASE_DB_PASSWORD                  # 直连 DB 密码
SUPABASE_SERVICE_ROLE_KEY             # server 端全权
NEXT_PUBLIC_SUPABASE_URL              # 公开 URL
NEXT_PUBLIC_SUPABASE_ANON_KEY         # 公开 anon key

TWILIO_ACCOUNT_SID                    # Twilio 账号
TWILIO_AUTH_TOKEN                     # Twilio auth
TWILIO_PHONE_NUMBER                   # Twilio 号码
TWILIO_BOSS_PHONE                     # Alex 真实手机（紧急转接目标）

OPENAI_API_KEY                        # GPT-4o-mini 摘要

GOOGLE_MAPS_API_KEY                   # 距离 / service area 验证

VERCEL_OIDC_TOKEN                      # Vercel 部署
WEBHOOK_SECRET                        # Vapi webhook 签名校验

EMERGENCY_MAX_ATTEMPTS                # 紧急重试上限
EMERGENCY_RETRY_INTERVAL_MINUTES      # 重试间隔
NEXT_PUBLIC_APP_URL                   # 公开 URL（demo-navy-chi-47.vercel.app）
```

---

## 6. 已知坑 / TODO

1. **Vercel project rename 没做** — dashboard 还叫 `demo`（prj_uVTUUJuMqenAxleB1K7aw1tS2PK2），仓库已改名 `handyline-ai-receptionist`。后续可改。
2. **Vapi 14 天 retention** — 8 月老 calls 已过期，再拉不到。如需历史数据，升级 Vapi plan。
3. **MY H-Master 是 placeholder** — assistant 存在但 system prompt 是 placeholder，等真实数据替换。
4. **OpenAI API 从国内直连超时** — Vercel 部署环境不受影响。
6. **本打包排除 `node_modules` / `.next` / `.git`** — 重新 `npm install` + `next build` 即可生成。

---

## 7. 如果团队需要回滚

```bash
# 找历史 commit
git log --oneline | head -20

# 回滚到指定版本
git checkout 2a8253e -- .
```

当前主分支最新 commit：`2a8253e feat: standalone Human Handoff + Recording demo`

---

## 8. 紧急联系方式

- **原项目 owner**：Mimatt（产品和运营）
- **沟通渠道**：见原始文档 README.md 顶部

祝接手顺利。