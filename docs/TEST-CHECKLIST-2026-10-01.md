# 测试清单 — Alex 问卷改动验证

> 生成时间：2026-10-01
> 对应改动：migration 012 + system prompt v2
> 前提：Vercel 部署已完成（见"部署前置"一节）

---

## 一、部署前置（先确认，否则后面都测不了）

| # | 动作 | 预期 |
|---|---|---|
| 0.1 | 浏览器打开 `https://demo-navy-chi-47.vercel.app/api/cron/keepalive` | 返回 `{"ok":true,"stage":"keepalive",...}` |
| 0.2 | Vercel 控制台 → 项目 → Cron Jobs | 能看到 `/api/cron/keepalive`，每天一次 |
| 0.3 | 执行 `npx vercel login` && `./scripts/push-cron-env.sh` | 两个环境变量进 Vercel |

**0.1 如果 404** → 部署还没完成，先等 Vercel 构建。

---

## 二、必须测（错了就是客户听错话）

打电话到 **+1 724-362-0422**，下面每条直接照念。

### 2.1 开头语 —— 最高优先级

| 念这句 | 预期回答 |
|---|---|
| *（接起来第一句）* | **"Handy Works service desk. What's the issue."** |
| | ❌ 不能出现 "this is Alex" |

### 2.2 上门费 —— 之前每通电话都在报错

| 念这句 | 预期回答 |
|---|---|
| "I need a faucet replaced, I'm in 77401" | **不含 $89**。应说 "no trip fee" 或直接报工费区间 |
| "I'm in 77583, can you come?" | 仍无上门费（25 英里内） |
| "I'm in 77301, that's like 40 miles out" | **应提到有小额上门费**，且说明不抵扣 |

**判负**：任何一通出现 "eighty-nine dollars" 就是没生效。

### 2.3 营业时间

| 念这句 | 预期回答 |
|---|---|
| "Are you open Sunday?" | **"closed Sunday"** |
| "What time do you close on weekdays?" | **"six"**（不是 five） |
| "Are you open Saturday?" | "nine to three" |

### 2.4 付款方式

| 念这句 | 预期回答 |
|---|---|
| "What payment do you take?" | cash / check / **Zelle** / card |
| | ❌ **不能提 Venmo** |
| "Is there a fee for card?" | **"three percent"** |

### 2.5 执照

| 念这句 | 预期回答 |
|---|---|
| "Are you licensed?" | "insured Texas LLC, Texas doesn't require a trade license" |
| | ❌ **不能报任何执照编号**（尤其不能说 32094253104） |

### 2.6 成立年份

| 念这句 | 预期回答 |
|---|---|
| "How long have you been in business?" | **"since twenty twenty four"** |
| | ❌ 不能说 2021 |

---

## 三、范围边界（测它该不该接）

| 念这句 | 预期行为 |
|---|---|
| "Can you install a smart lock?" | ✅ 接，**from $80** |
| "I need my water heater replaced" | ⚠️ 应**转介**水管工（minor plumbing 之外） |
| "My AC isn't cooling, it's blowing warm air" | ✅ 接，AC repair $150–600 |
| "I want a whole new central AC unit installed" | ⚠️ 应**转介** HVAC 专家 |
| "My roof needs new shingles" | ✅ 接，$400–$2,500 |
| "I need a whole new roof" | ⚠️ 应**转介** |
| "Can you fix my washing machine?" | ❌ 明确拒 + 建议找 appliance tech |
| "I run a restaurant, need someone for my kitchen" | ✅ 承认接商业项目，**但不报价格**，说 Alex 会回电 |
| "Can you gut and redo my kitchen?" | ⚠️ 当前**拒接**（等 Alex 澄清，见 B3） |
| "Do you do termites?" | ❌ 拒 + 建议找 pest control |
| "I smell gas" | ⚠️ 见下一节，**最高危** |

---

## 四、紧急场景（务必单独测）

| 念这句 | 预期行为 |
|---|---|
| **"I smell gas in my kitchen"** | 1) 让他开窗 2) 让他离开 3) 让他打 **911** 4) 说会马上打给 Alex |
| | ❌ **绝对不能说"我帮你找水管工"** |
| "There's water spraying everywhere, my ceiling is soaking" | flag_urgent + 立即联系 Alex |
| "The power just went out in the whole house" | flag_urgent |
| "My shop AC died and I have inventory" | flag_urgent |
| "I have no hot water but I have small kids" | flag_urgent |

**测完检查**：每次 flag_urgent 后，Alex 手机（713-742-2387）应该收到电话；dashboard 上出现 `status=urgent` 的工单置顶。

---

## 五、报价格式（TTS 数字朗读）

| 念这句 | 预期 |
|---|---|
| "How much for furniture assembly, I'm in 77401" | "furniture assembly starts at **seventy-five**" |
| "How much to mount a TV?" | "starts at **ninety**" |
| "How much for blinds?" | "starts at **seventy-five**" |
| （任意报价后） | 必须有 "**final price confirmed once we see the job**" |
| | ❌ 不能读出数字字符 "$" "89" "–" |

---

## 六、收尾话术（回归测试）

| 场景 | 预期 |
|---|---|
| 正常结束 | 必须问 "**Anything else** I can help with?" |
| 客户说 "no that's all" | "Have a good day." |
| | ❌ 不能说 "Bye" / "See ya" |
| 客户要求转人工 | "I will certainly call you back shortly" |
| | ❌ 不能说 "Alex will call" |

---

## 七、后台数据核对

每通测完的电话，跑一次：

```bash
node scripts/import-vapi-calls.js --write
node scripts/analyze-calls.js
```

检查项：
- [ ] `trip_fee` 字段 = **0**（不是 89）
- [ ] `price_list` 命中值：furniture=75 / tv=90 / smart_home=80 / window_covering=75
- [ ] 紧急通话 `ai_decision=urgent` 且 `status=urgent`
- [ ] Alex 自己的号码（+17137422387）**不应**出现在工单里（白名单生效）

---

## 八、已知不在本次范围

- **5→10 分钟递进回拨 + 三次未接发短信**：数据库字段已加，代码还没消费。语音提示"请留语音留言"已生效，短信兜底未实现
- **Abel 白名单**：按你指示暂不加
- **第 5/6/7/10 节答案错位**：需 Alex 重新确认，不影响现有 prompt（已取安全默认值）

---

## 九、测试记录表

| # | 场景 | 日期 | 结果 | 备注 |
|---|---|---|---|---|
| 1 | 开头语 | | | |
| 2 | 上门费（区内） | | | |
| 3 | 上门费（区外） | | | |
| 4 | 周日 | | | |
| 5 | 付款方式 | | | |
| 6 | 执照 | | | |
| 7 | 燃气味 | | | |
| 8 | 紧急漏水 | | | |
| 9 | 智能门锁报价 | | | |
| 10 | 热水器（应转介） | | | |
| 11 | 商用厨房 | | | |
| 12 | 洗衣机（应拒） | | | |
