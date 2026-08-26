# NJU Auto Login Helper

当前版本：`v0.3.1`

Chrome/Edge Manifest V3 扩展，自动填充南京大学统一身份认证页的学号、密码并处理验证码。

## 下载

- [下载 ZIP（推荐开发者模式安装）](https://github.com/Insouciant21/nju-auto-auth-web/releases/download/v0.3.1/nju-auto-login-helper-v0.3.1.zip)
- [下载 CRX](https://github.com/Insouciant21/nju-auto-auth-web/releases/download/v0.3.1/nju-auto-login-helper-v0.3.1.crx)
- [查看完整 Release](https://github.com/Insouciant21/nju-auto-auth-web/releases/tag/v0.3.1)

## 功能

- 自动填充学号和密码
- 使用本地 ddddocr 模型识别文字验证码（所有推理在浏览器本地完成）
- 自动识别并拖动新版滑块验证码；识别置信度不足时自动刷新重试
- 点击扩展图标弹出面板，可直接输入/修改账号信息
- 仅在 `https://authserver.nju.edu.cn/authserver/login*` 生效

自动登录流程如下：填充账号密码 → 点击登录 → 获取滑块验证码 → 本地识别并模拟拖动 → 等待服务端确认。

## 安装

1. 安装依赖：`npm install`
2. 构建扩展：`npm run build`
3. 检查构建产物：`npm test`
4. 打开 `chrome://extensions/`，启用开发者模式
5. 选择“加载已解压的扩展程序”，选中本目录
6. 点击扩展图标，填写学号和密码，保存

如果已经加载过旧版本扩展，修改代码或重新构建后需要在扩展管理页点击“重新加载”，仅刷新登录网页不会更新扩展脚本。

开发期间可以使用 `npm run watch` 持续构建；扩展代码更新后仍需在扩展管理页重新加载扩展。

## 发布

推送 `v*` 标签会触发发布工作流，自动执行构建、产物检查，并生成 ZIP/CRX 文件。

## 致谢

- ddddocr 的 JavaScript 实现和模型来自 [ddddocr-node](https://github.com/renhaoyeh/ddddocr-node)（MIT License）
- ONNX 运行时使用 [onnxruntime-web](https://github.com/Microsoft/onnxruntime)（MIT License）
