# 在一起 · 把美好装订成册

中文自助照片创作与互动相册网站。React / Vinext / Cloudflare Workers + D1 + R2；GitHub Pages 发布界面；邮箱验证码与人工审核账号；Sites 托管服务器及存储。

- 在线使用：[打开「在一起」](https://album.learnforeverything.com)
- 源码仓库：[jackie8410/zaiyiqi](https://github.com/jackie8410/zaiyiqi)

## 已实现

- 邮箱验证注册、验证码登录、网站所有者审核、拒绝与停用。

- 单张照片衣着、背景、自然修饰的AI表单与服务接口；现有合影加人、全新合影、虚拟旅行。
- 私密照片池，上传、筛选、多选、ZIP下载、单张删除与全部清除。
- 相册编排、每页文字、五种主题、精细双面翻页和三种幻灯片动效。
- PDF、内嵌图片的离线HTML、WebCodecs MP4导出。
- 私密/密码链接/公开广场，撤销分享、点赞、评分、评论与评论删除。
- 创作任务额度、三次成功出图、失败返还、失联任务恢复。
- 微信Native和支付宝网页支付下单、验签、查询、回调与幂等到账。

## 当前开通状态

正式网址：[在一起](https://album.learnforeverything.com)。专用OpenAI密钥已配置为线上保密变量，模型为`gpt-image-2`。2026-11-17已在正式网页完成真实六人合影和巴黎换装写真生成，作品成功保存；邮箱注册、所有者审核、普通用户登录、相册编辑翻页、PDF与照片ZIP下载、分享互动和匿名访问均已实际操作验证。

商户凭据尚未提供；`PAYMENT_SALES_ENABLED=false`，不收款。GitHub Pages 发布完整界面，Sites 提供同一主域名下的后台 API、数据库和图片存储。普通用户使用邮箱验证码注册与登录；旧账号关联入口与接口已移除。邮件服务已接通。

Resend Free免费邮件服务及发信子域名`auth.learnforeverything.com`已验证，验证码实际送达Gmail。邮件标题和网页显示发送时间，便于区分新旧邮件；验证码由用户在网页填写。独立域名入口位于[种毛衣首页](https://learnforeverything.com/)，账户入口为[/account](https://album.learnforeverything.com/account/)。新域名HTTPS及正式浏览器访问正常，普通用户无需ChatGPT账号。

详细范围见 `docs/PRODUCT.md`，验收记录见 `docs/VALIDATION.md`。

## 本地启动

需要 Node.js 22.13+，Git，npm。

```powershell
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_mysterious_kid_colt.sql
npm run dev -- --hostname 127.0.0.1
```

已有数据库不要重复执行初始迁移。生产迁移由Sites发布流程应用。本地和生产均使用邮箱会话；托管模拟身份不再授予作品访问权限。新增认证表需应用 drizzle/0001_email_accounts.sql，已有数据库不得重跑初始迁移。

```powershell
npm run build:pages
npm run typecheck
npm run test:business
npm run test:exports
npm run test:auth
```

`test:auth`运行实际认证与相册路由、SQLite迁移及对象存储测试，邮件由测试替身接收。历史`test:acceptance`脚本用于旧版模拟托管身份的本地HTTP环境，不能作为新版邮箱登录或正式浏览器验收的依据。

接口验收要求本地开发服务器运行，严格限制到loopback；只创建/删除自己的临时测试记录。支付测试使用内存数据库及临时密钥，不向支付平台发送请求。

导出测试覆盖照片请求失败、传输中断、文件读取失败/取消，以及失败后重新导出；它不发起外部请求，也不代替浏览器中的实际下载验收。

## 外部配置

变量名称见 `.env.example`。所有真实密钥必须通过安全工具写入忽略的本地文件或Sites运行时秘密，不得提交Git。当前专用OpenAI密钥已按用户授权保存到忽略的`.env.local`和Sites生产保密变量；不要在部署脚本、前端代码、文档或公开构建产物中复制密钥。

生产设置通过Sites原生环境变量工具管理；修改后需重新部署。`ADMIN_EMAIL` 指定网站所有者的已验证邮箱（拥有审核权限），`AUTH_SECRET` 是32字节以上随机密钥；`RESEND_API_KEY` 和 `AUTH_EMAIL_FROM` 用于真实验证码发送。发信地址必须属于已验证域名，不能直接冒用网易等邮箱服务商域名。`AUTH_EMAIL_REPLY_TO` 可使用站长的联系邮箱。`AUTH_MAIL_DAILY_LIMIT` 限制每日发送请求；`API_URL` 用于商户异步通知，`SITE_URL` 用于支付后的前台返回地址。AI使用OpenAI图片编辑接口或已配置的火山引擎接口。商户全部参数与真实联调通过后，再决定启用销售开关。还需填写正式经营/客服/退款信息，首版不提供虚假的商户支付演示。

## 发布

项目标识保存在 `.openai/hosting.json`，不可重建项目覆盖。使用已安装Sites技能的 `site-workflow.mjs` 进行源码同步和打包，再保存版本及发布。不得把发布令牌、API密钥、商户私钥写入命令参数或源码。

GitHub的main分支由Actions检查并自动部署Pages前端，Sites后台需独立发布对应源码；具体说明见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。应用的数据与AI能力依赖后台服务器、D1和R2，GitHub Pages负责界面与分享入口。

## 素材与许可

`public/images/` 两张示例图由图像生成工具创作，均为虚构人物。前端明确标注AI示例。PageFlip采用MIT许可，离线导出包含其完整许可。其他依赖许可见各npm包。

## 尚待真实验收

- 真实人物相似度与本人/家属认可；本次生成测试全部使用AI虚构示例。
- 真实手机硬件流畅度，以及付费离线HTML/MP4的浏览器导出和手机打开；已验证窄屏单页与模拟触摸，免费账号的付费入口保持锁定。
- 微信/支付宝真实商户下单、回调及售后流程；当前不收款。
- 生产环境永久删除未执行，删除逻辑已由路由测试覆盖；验收作品保留。
- 手机号入口仅预留，尚未接入短信服务。
