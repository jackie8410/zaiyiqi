# 源码与正式网站

| 用途 | 地址 |
| --- | --- |
| 用户访问网站 | https://zaiyiqi-album.steelylinen1.chatgpt.site |
| GitHub源码 | https://github.com/jackie8410/zaiyiqi |

网站标题为“在一起”，GitHub仓库路径为`zaiyiqi`。

## 当前部署方式

GitHub保存源码；Sites发布Cloudflare Worker，并提供D1数据库、R2照片存储和ChatGPT登录。既有项目的身份保存在`.openai/hosting.json`中。维护这个网站时保留项目身份，复用既有数据库和存储。

GitHub Pages只能托管静态资源，不能直接运行本项目的登录、私密照片、AI生成、数据库和支付服务。本项目没有启用GitHub Pages，也没有配置“推送即部署”的自动工作流。

## 更新流程

1. 从最新源码继续修改。涉及应用行为时，运行对应类型检查、业务测试和接口验收。
2. 使用当前Sites技能的`site-workflow.mjs`打开既有项目。临时源码凭据只能经隐藏标准输入传入。
3. 通过该工作流构建、提交并同步Sites源码库，生成与提交一致的部署包。
4. 将同一提交推送至此GitHub仓库的`main`分支；已有内容时先核对远端，避免覆盖他人提交。
5. 用Sites原生工具保存该提交的版本并部署。确认部署状态为`succeeded`，核对生产环境修订与正式URL。
6. 在权限允许时进行真实登录、上传、AI任务、相册展示、导出和分享测试。接口或发布检查不能代替完整浏览器验收。

## 生产配置

`OPENAI_API_KEY`存放于Sites保密运行时变量，`OPENAI_IMAGE_MODEL`为`gpt-image-2`。本地开发配置可放在已忽略的`.env.local`中。配置示例见仓库根目录`.env.example`，不要把真实密钥提交到Git或嵌入前端构建。

`PAYMENT_SALES_ENABLED=false`。微信及支付宝商户参数、经营与售后信息及真实支付联调尚未完成，因此当前不收款。运行时变量更新后，需要重新部署以使正式网站加载新配置。

## 验收记录

当前已完成的检查和未完成项目见[VALIDATION.md](VALIDATION.md)。生产浏览器测试存在应用权限层阻断，解除后继续验收；不应把部署成功或源码推送成功标记为所有功能均已通过。
