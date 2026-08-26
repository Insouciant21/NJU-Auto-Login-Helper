# NJU Auto Login Helper

Chrome/Edge Manifest V3 扩展，自动填充南大统一身份认证页的学号、密码和验证码。

## 功能

- 自动填充学号和密码
- 使用本地 ddddocr 模型识别文字验证码（所有推理在浏览器本地完成）
- 自动识别并拖动新版滑块验证码；识别置信度不足时自动刷新重试
- 点击扩展图标弹出面板，可直接输入/修改账号信息
- 仅在 `https://authserver.nju.edu.cn/authserver/login*` 生效

## 安装

1. 安装依赖：`npm install`
2. 构建扩展：`npm run build`
3. 检查构建产物：`npm test`
4. 打开 `chrome://extensions/`，启用开发者模式
5. 选择"加载已解压的扩展程序"，选中本目录
6. 点击扩展图标，填写学号和密码，保存

如果已经加载过旧版本扩展，修改代码或重新构建后需要在扩展管理页点击“重新加载”，仅刷新登录网页不会更新扩展脚本。

## 致谢

- 验证码识别模型来自 [Do1e/NJUlogin](https://github.com/Do1e/NJUlogin)（MIT License）
- ONNX 运行时使用 [onnxruntime-web](https://github.com/Microsoft/onnxruntime)（MIT License）
