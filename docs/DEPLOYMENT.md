# 源码与正式网站

| 用途 | 地址 |
| --- | --- |
| GitHub Pages 用户主页 | https://album.learnforeverything.com/ |
| 邮箱注册、登录、审核 | https://album.learnforeverything.com/account/ |
| 同站后台 API | https://album-api.learnforeverything.com |
| GitHub 源码 | https://github.com/jackie8410/zaiyiqi |
| 种毛衣网站入口 | https://learnforeverything.com/ |

## 部署结构

GitHub Pages 发布完整 React 界面，包括照片池、AI 创作表单、相册、翻页、下载、分享和账户审核。Pages 构建使用 vite.pages.config.ts，输出为 dist-pages；与后台 dist/server 分开。/account/ 和 /privacy/ 各有真实 HTML 文件，分享使用 /?album=令牌，直接访问和刷新不依赖服务器路由回退。

Pages 不运行数据库、邮箱发信或图像 API。既有 Sites 项目运行 Cloudflare Worker，继续使用原 D1 数据库与 R2 存储；.openai/hosting.json 中的项目身份和绑定保持不变。后台自定义域名为 album-api.learnforeverything.com。前端与 API 同属 learnforeverything.com，邮箱会话使用后台域名的 HttpOnly、Secure、SameSite=Lax cookie；请求带 credentials，后台仅允许 FRONTEND_URL 的精确来源和自身来源，不使用通配 CORS。

## DNS 与 Pages 设置

GitHub 仓库 Settings → Pages 的 Source 为 GitHub Actions，Custom domain 为 album.learnforeverything.com；HTTPS 证书可用后启用 Enforce HTTPS。

DNSPod 中 album CNAME 指向 jackie8410.github.io.。album-api CNAME 指向 Sites 返回的 custom-domains.chatgpt.site.；所有权与证书验证 TXT 以 Sites 原生接口实际返回值为准。不得修改根域名、www 或邮件记录来迁移相册。

## 更新流程

1. 使用 Sites 的 site-workflow.mjs 打开现有项目，保留项目身份、数据和已有环境变量。源码凭据仅经隐藏标准输入传入。
2. 修改后运行 npm run typecheck、对应测试和 npm run build:pages。Pages 只编译固定的公开 API 地址，禁止注入服务端密钥。
3. 通过 Sites 工作流构建后台、提交并推送其源码库，生成与提交一致的部署包。用原生工具保存版本并部署，确认 succeeded。
4. 将同一源码树同步到 GitHub main。公开仓库使用 codex/email-accounts-public 工作树维护干净历史；Sites 与 GitHub 提交编号可不同，但源码树哈希必须完全一致。先获取并检查远端，不强制覆盖更新。
5. GitHub Actions 的 pages.yml 在 main 更新后自动进行类型、认证、导出检查，再构建并发布 dist-pages。确认工作流成功后再切换外部入口。
6. 对公开域名进行浏览器验证。发布成功、邮件送达或本地测试均不能代替实际注册、登录和作品操作验收。

.projects、.env*、凭据、outputs 和构建产物不得进入公开提交历史。不要将 Sites 私有维护分支的完整历史直接推送到 GitHub。

## 运行时配置

FRONTEND_URL 与 SITE_URL 为 https://album.learnforeverything.com；API_URL 为 https://album-api.learnforeverything.com。支付返回页面使用 SITE_URL，支付回调使用 API_URL。修改运行时变量后必须重新部署。

OPENAI_API_KEY、AUTH_SECRET、RESEND_API_KEY 等仅存放在 Sites 保密运行时变量。图像模型为 gpt-image-2。PAYMENT_SALES_ENABLED=false，商户参数与真实支付联调完成前不收款。

邮箱身份为唯一公开账户方式。所有者使用配置的 ADMIN_EMAIL 验证注册后进入审核后台；其他邮箱注册后等待所有者批准。已移除 ChatGPT 旧账号关联入口、接口及自动身份回退，不自动合并或删除数据库中的既有记录。手机号入口仍明确标注为未开放。

发信域名 auth.learnforeverything.com 已通过 Resend 验证，发件人为“在一起 <no-reply@auth.learnforeverything.com>”。使用免费邮件服务，不启用付费套餐或自动充值；邮箱发送失败不会返回可用的假验证码。

当前验收情况见 [VALIDATION.md](VALIDATION.md)。
