# 常见问题与解答 (FAQ)

### Q1: Cursor 额度无法自动获取？
**A**: 插件会自动探测 `%APPDATA%\Cursor\User\globalStorage\state.vscdb`。如果使用了自定义安装路径或便携版，可在设置面板中手动填入 Cursor 访问凭据。

### Q2: OpenAI / Codex 如何接入第三方聚合服务（如 OneAPI / NewAPI）？
**A**: 在配置中将 Base URL 更改为您的代理地址（如 `https://your-api.com/v1`），填入对应 API Key 即可。

### Q3: 频繁刷新是否会触发上游风控？
**A**: 插件内置了内存级智能防频控缓存，默认对同一 Provider 的频繁请求进行合并与缓冲，保证安全稳定。
