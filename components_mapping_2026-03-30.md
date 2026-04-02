# 微信页面装修组件映射（自动采集版）

采集来源：`https://smp.iyouke.com/dtmall/pageDesign?newPage=true&platformType=1`
采集方式：Chrome DevTools MCP 自动读取页面组件配置
采集时间：2026-03-30

## 1) 已自动获取到的组件（26个）
- 基础组件：标题文字、图文广告、商品、辅助分割、公告、富文本、自由热区、搜索框、视频、图文导航、电梯导航、链接导航
- 营销组件：优惠券、限时优惠、拼团、积分商品、涨粉、预约事件、办理会员、社区帖子、导购商品、商品混排
- 微信小店：视频号直播、橱窗商品、店铺商品、店铺首页

## 2) 业务模块 -> 组件映射（可直接用于 Agent）

| 业务模块 | 首选组件 | 备选组件 | 兜底策略 |
|---|---|---|---|
| Banner 主视觉 | 图文广告(banner) | 标题文字(title) | 纯文字头图 + 链接导航 |
| 利益点区 | 标题文字(title) + 富文本(richtext) | 图文导航(navigation) | 公告(notice) |
| 优惠券区 | 优惠券(coupon) | 限时优惠(limit) | 标题文字 + 链接导航 |
| 倒计时促销 | 限时优惠(limit) | 拼团(group) | 公告(notice) |
| 商品列表 | 商品(product) | 商品混排(prodMix)、导购商品(fanliProd) | 图文广告(banner) |
| 吸底行动按钮 | 链接导航(linkNav) | 图文导航(navigation) | 图文广告单卡 |
| 会员招募 | 办理会员(handleMember) | 涨粉(increaseFans) | 标题文字 + 链接导航 |
| 活动报名 | 预约事件(bookEvent) | 涨粉(increaseFans) | 富文本 + 链接导航 |
| 内容社区 | 社区帖子(community) | 富文本(richtext) | 图文广告 |
| 视频直播 | 视频号直播(videoChannel) | 视频(video) | 图文广告 |
| 带货橱窗 | 橱窗商品(videoChannelProdV2) | 店铺商品(wechatShopProd) | 商品(product) |
| 店铺导流 | 店铺首页(wechatShop) | 店铺商品(wechatShopProd) | 链接导航 |
| 搜索入口 | 搜索框(search) | 图文导航(navigation) | 链接导航 |
| 公告通知 | 公告(notice) | 标题文字(title) | 富文本 |
| 视觉分层/留白 | 辅助分割(white) | 标题文字空白样式 | 不加该模块 |

## 3) 执行约束（从系统能力直接抽取）
- 视频(video)：最多 10 个
- 电梯导航(elevator)：最多 1 个
- 链接导航(linkNav)：最多 1 个
- 办理会员(handleMember)：最多 1 个
- 社区帖子(community)：最多 1 个
- 商品混排(prodMix)：最多 2 个，最低版本 2.11.25
- 导购商品(fanliProd)：最低版本 2.4.29
- 橱窗商品(videoChannelProdV2)：最多 10 个，最低版本 2.12.0
- 店铺商品(wechatShopProd)：最低版本 2.10.85
- 店铺首页(wechatShop)：最低版本 2.11.25

## 4) 给 Agent 的落地规则（建议直接照抄）
1. 先匹配“首选组件”；命中失败再走“备选组件”；都失败再走“兜底策略”。
2. 每次映射时先检查组件数量上限与版本限制，不满足就自动降级。
3. 页面的最小闭环模块固定为：Banner + 利益点 + 主转化模块（商品/会员/活动）+ 行动入口。
4. 输出结果时必须附上“替代实现说明”（明确哪块是降级方案）。
