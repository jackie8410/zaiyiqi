# 在一起 · 把美好装订成册

中文自助照片创作与互动相册网站。React / Vinext / Cloudflare Workers + D1 + R2；Sites 托管认证。

- 在线使用：[打开「在一起」](https://zaiyiqi-album.steelylinen1.chatgpt.site)
- 源码仓库：[jackie8410/zaiyiqi](https://github.com/jackie8410/zaiyiqi)

## 已实现

- 单张照片衣着、背景、自然修饰的AI表单与服务接口；现有合影加人、全新合影、虚拟旅行。
- 私密照片池，上传、筛选、多选、ZIP下载、单张删除与全部清除。
- 相册编排、每页文字、五种主题、精细双面翻页和三种幻灯片动效。
- PDF、内嵌图片的离线HTML、WebCodecs MP4导出。
- 私密/密码链接/公开广场，撤销分享、点赞、评分、评论与评论删除。
- 创作任务额度、三次成功出图、失败返还、失联任务恢复。
- 微信Native和支付宝网页支付下单、验签、查询、回调与幂等到账。

## 当前开通状态

正式网址：[在一起](https://zaiyiqi-album.steelylinen1.chatgpt.site)。2026-11-10已将专用OpenAI密钥配置为线上保密变量，模型为`gpt-image-2`，重新部署成功。使用实际提供商与提示词代码的旅游换装、合影加人两次真实出图测试均通过；浏览器登录与线上完整操作流程仍待权限问题解决后验收。

商户凭据尚未提供；`PAYMENT_SALES_ENABLED=false`，不收款。GitHub用于保存和维护源码，正式网站由Sites提供服务器、数据库、图片存储与登录服务。

详细范围见 `docs/PRODUCT.md`，验收记录见 `docs/VALIDATION.md`。

## 本地启动

需要 Node.js 22.13+，Git，npm。

```powershell
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_mysterious_kid_colt.sql
npm run dev -- --hostname 127.0.0.1
```

已有数据库不要重复执行初始迁移。生产迁移由Sites发布流程应用。便携本地预览登录使用 `local_seedy` 模拟身份；生产使用真实 ChatGPT 登录，模拟身份不会包含在生产构建中。

```powershell
npm run typecheck
npm run test:business
npm run test:exports
npm run test:acceptance
```

接口验收要求本地开发服务器运行，严格限制到loopback；只创建/删除自己的临时测试记录。支付测试使用内存数据库及临时密钥，不向支付平台发送请求。

导出测试覆盖照片请求失败、传输中断、文件读取失败/取消，以及失败后重新导出；它不发起外部请求，也不代替浏览器中的实际下载验收。

## 外部配置

变量名称见 `.env.example`。所有真实密钥必须通过安全工具写入忽略的本地文件或Sites运行时秘密，不得提交Git。当前专用OpenAI密钥已按用户授权保存到忽略的`.env.local`和Sites生产保密变量；不要在部署脚本、前端代码、文档或公开构建产物中复制密钥。

生产设置通过Sites原生环境变量工具管理；修改后需重新部署。`ADMIN_EMAIL` 仅用于管理员状态页；`SITE_URL` 用于商户回调地址。AI使用OpenAI图片编辑接口或已配置的火山引擎接口。商户全部参数与真实联调通过后，再决定启用销售开关。还需填写正式经营/客服/退款信息，首版不提供虚假的商户支付演示。

## 发布

项目标识保存在 `.openai/hosting.json`，不可重建项目覆盖。使用已安装Sites技能的 `site-workflow.mjs` 进行源码同步和打包，再保存版本及发布。不得把发布令牌、API密钥、商户私钥写入命令参数或源码。

GitHub推送与Sites发布是两个步骤，目前没有配置自动部署。更新时需要推送源码并在Sites发布对应提交；具体说明见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。这个应用依赖服务器、D1和R2，不能直接用GitHub Pages承载全部功能。

## 素材与许可

`public/images/` 两张示例图由图像生成工具创作，均为虚构人物。前端明确标注AI示例。PageFlip采用MIT许可，离线导出包含其完整许可。其他依赖许可见各npm包。

## 尚待真实验收

- 真实用户登录、网页发起AI任务、照片池保存、翻页和导出的完整浏览器流程。
- 人物合成相似度和家属认可度，仍需用获授权的真实人物照片测试；已通过的两组API测试使用虚构人物示例。
- 手机触控流畅度及离线HTML在手机文件管理器中的打开方式。
- 微信/支付宝真实商户下单、回调及售后流程。
- ChatGPT账户之外的手机号/微信登录不在当前托管首版内；面向中国大众市场需要后续迁移或补充身份渠道。
