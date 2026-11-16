# 源码与正式网站

| 用途 | 地址 |
| --- | --- |
| 用户访问网站 | https://zaiyiqi-album.steelylinen1.chatgpt.site |
| GitHub源码 | https://github.com/jackie8410/zaiyiqi |

网站标题为“在一起”，GitHub仓库路径为`zaiyiqi`。

## 当前部署方式

GitHub保存源码；Sites发布Cloudflare Worker，并提供D1数据库、R2照片存储。普通用户通过本站邮箱验证码与审核流程登录；Sites托管身份仅用于关联旧版账号。既有项目的身份保存在`.openai/hosting.json`中。维护这个网站时保留项目身份，复用既有数据库和存储。

GitHub Pages只能托管静态资源，不能直接运行本项目的登录、私密照片、AI生成、数据库和支付服务。本项目没有启用GitHub Pages，也没有配置“推送即部署”的自动工作流。

## 更新流程

1. 从最新源码继续修改。涉及应用行为时，运行对应类型检查、业务测试和接口验收。
2. 使用当前Sites技能的`site-workflow.mjs`打开既有项目。临时源码凭据只能经隐藏标准输入传入。
3. 通过该工作流构建、提交并同步Sites源码库，生成与提交一致的部署包。
4. 将同一源码树同步至此GitHub仓库的`main`分支；已有内容时先核对远端，避免覆盖他人提交。公开仓库通过`codex/email-accounts-public`工作树发布干净提交，Sites维护历史与公开提交编号可不同，但必须核对Git源码树哈希完全一致。本机`.projects`、`.env*`、凭据及构建输出不得进入公开仓库或其提交历史。
5. 用Sites原生工具保存该提交的版本并部署。确认部署状态为`succeeded`，核对生产环境修订与正式URL。
6. 在权限允许时进行真实登录、上传、AI任务、相册展示、导出和分享测试。接口或发布检查不能代替完整浏览器验收。

## 生产配置

`OPENAI_API_KEY`存放于Sites保密运行时变量，`OPENAI_IMAGE_MODEL`为`gpt-image-2`。本地开发配置可放在已忽略的`.env.local`中。配置示例见仓库根目录`.env.example`，不要把真实密钥提交到Git或嵌入前端构建。

`PAYMENT_SALES_ENABLED=false`。微信及支付宝商户参数、经营与售后信息及真实支付联调尚未完成，因此当前不收款。运行时变量更新后，需要重新部署以使正式网站加载新配置。

## 验收记录

当前已完成的检查和未完成项目见[VALIDATION.md](VALIDATION.md)。生产浏览器测试存在应用权限层阻断，解除后继续验收；不应把部署成功或源码推送成功标记为所有功能均已通过。

## 邮箱账户

保持原Sites项目、DB与BUCKET不变。发布时由平台应用0001_email_accounts加法迁移，不运行初始迁移、不更改现有owner或额度。

生产配置 AUTH_SECRET（32字节以上随机值）、RESEND_API_KEY、AUTH_EMAIL_FROM（已验证发信域名）、可选AUTH_EMAIL_REPLY_TO和AUTH_MAIL_DAILY_LIMIT。所有凭据仅使用Sites秘密变量。ADMIN_EMAIL只配置网站所有者邮箱；其邮箱验证通过后可访问/account中的审核后台。

旧版账号应先从/account的“我在旧版已有照片和相册”关联一次，再改用邮箱验证码登录。若该邮箱已经先注册为另一独立账号，系统拒绝自动合并；原数据不动，需管理员核对，避免覆盖或错绑。

手机号入口为明确标注的未开放状态，不发短信。邮箱服务未配置时接口返回503，界面提示尚未开通，不返回假验证码。

已在DNSPod添加并验证`auth.learnforeverything.com`的DKIM、MX、SPF与发信CNAME记录，免费发信服务为Resend Free。正式发件人为`在一起 <no-reply@auth.learnforeverything.com>`，回复地址为所有者提供的网易邮箱。未开通付费邮件套餐或自动充值。
