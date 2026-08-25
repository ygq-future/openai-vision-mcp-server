# openai-vision-mcp-server

[English](README.md)

[![npm 版本](https://img.shields.io/npm/v/openai-vision-mcp-server.svg)](https://www.npmjs.com/package/openai-vision-mcp-server)
[![M8ven 评分](https://m8ven.ai/badge/mcp/ygq-future-openai-vision-mcp-server-1hv1os)](https://m8ven.ai/mcp/ygq-future-openai-vision-mcp-server-1hv1os)
[![GitHub 仓库](https://img.shields.io/badge/GitHub-ygq--future%2Fopenai--vision--mcp--server-blue?logo=github)](https://github.com/ygq-future/openai-vision-mcp-server)
[![许可证：MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 版本](https://img.shields.io/badge/node-%3E%3D20.19.0-brightgreen.svg)](https://nodejs.org)

**GitHub 仓库**：[https://github.com/ygq-future/openai-vision-mcp-server](https://github.com/ygq-future/openai-vision-mcp-server)

一个基于模型上下文协议（MCP）stdio 传输的图像分析服务器，使用兼容 OpenAI Chat Completions 格式的视觉 API，提供有边界、高精度的图像分析能力。支持 OpenAI `gpt-4o`、Qwen VL、DeepSeek Vision，以及本地 vLLM/Ollama 等兼容服务。

---

## ✨ 功能特性

- **多来源图像输入**：直接分析 `file://` 本地路径、`http://`/`https://` URL 或 `base64` 原始数据。
- **智能概览与自适应切片**：自动生成概览图，并为高分辨率图像生成有序、相互重叠的细节切片，在保留视觉细节的同时控制 token 使用量。
- **通用 OpenAI 兼容性**：支持遵循标准 OpenAI `/chat/completions` 视觉协议的 API 端点。
- **可配置的安全与资源限制**：
  - 可选的 SSRF 防护，仅允许访问公网（`VISION_ALLOW_PRIVATE_NETWORK=false`）。
  - 可选的本地文件根目录限制（`VISION_ALLOWED_FILE_ROOTS`）。
  - 可配置文件大小、解码像素数、HTTP 超时和最大重定向次数等上限。
- **干净的 stdio 传输**：`stdout` 仅用于标准 MCP JSON-RPC 协议消息；诊断信息写入 `stderr`，不会泄露凭据或图像数据。

> [!IMPORTANT]
> 为方便本地 MCP 使用，本地文件和私有网络访问默认是开放的。如果 MCP 客户端或待分析提示词并不完全可信，请将
> `VISION_ALLOWED_FILE_ROOTS` 设置为明确的允许根目录，并将 `VISION_ALLOW_PRIVATE_NETWORK` 设置为 `false`。

---

## 🚀 快速开始

无需手动安装，可以使用 `npx` 或 `bunx` 运行 `openai-vision-mcp-server`。
当 npm 通过 `.bin` 目录链接启动当前检出版本时，入口也能正确解析，因此不必显式添加 `@latest`。

### MCP 客户端配置示例

将服务器添加到你使用的 MCP 客户端配置文件中，例如 **Claude Desktop**、**Cursor**、**Windsurf** 或 **VS Code / Antigravity**。

#### 标准 `claude_desktop_config.json` / `mcp.json`

```json
{
  "mcpServers": {
    "vision": {
      "command": "npx",
      "args": ["-y", "openai-vision-mcp-server"],
      "env": {
        "VISION_BASE_URL": "https://api.openai.com/v1",
        "VISION_API_KEY": "your-api-key-here",
        "VISION_MODEL": "gpt-4o"
      }
    }
  }
}
```

---

## ⚙️ 环境变量与配置

所有配置都通过 MCP 服务器配置中的环境变量传入：

| 环境变量                       | 类型   | 必填   | 默认值      | 说明                                                                              |
| :----------------------------- | :----- | :----- | :---------- | :-------------------------------------------------------------------------------- |
| `VISION_BASE_URL`              | 字符串 | **是** | —           | OpenAI 兼容 API 的基础 URL，例如 `https://api.openai.com/v1`。                    |
| `VISION_API_KEY`               | 字符串 | **是** | —           | API 身份验证密钥。                                                                |
| `VISION_MODEL`                 | 字符串 | **是** | —           | 配置的 OpenAI 兼容端点提供的视觉模型名称，例如 `gpt-4o` 或 `qwen-vl-max`。        |
| `VISION_DEFAULT_MAX_TILES`     | 整数   | 否     | `24`        | 细节切片的默认硬上限，范围为 1 到 64。                                            |
| `VISION_ALLOWED_FILE_ROOTS`    | 字符串 | 否     | `""`        | 用分隔符分隔的 `file://` URI 路径白名单。未设置时，默认允许访问所有本地普通文件。 |
| `VISION_ALLOW_PRIVATE_NETWORK` | 布尔值 | 否     | `true`      | 设置为 `false` 后，阻止访问指向私有/内部 IP 的 `http(s)://` 地址。                |
| `VISION_MAX_INPUT_BYTES`       | 整数   | 否     | `20971520`  | 原始图像下载大小上限，默认 20 MB。                                                |
| `VISION_MAX_DECODED_PIXELS`    | 整数   | 否     | `100000000` | 图像解码后的总像素数上限，默认 100 MP。                                           |
| `VISION_HTTP_TIMEOUT_MS`       | 整数   | 否     | `30000`     | HTTP 请求超时时间，单位为毫秒，默认 30 秒。                                       |
| `VISION_MAX_REDIRECTS`         | 整数   | 否     | `3`         | 最大 HTTP 重定向次数。                                                            |
| `VISION_MAX_CONCURRENCY`       | 整数   | 否     | `1`         | 细节切片分析的最大并发数，默认 1，以降低触发 429 限流的概率。                     |

---

## 🛠 可用工具

### `analyze_images`

使用已配置的视觉模型分析一张或多张图像，并生成结构化分析报告。
MCP 工具声明将其标记为只读、非破坏性、非幂等和开放世界工具：每次调用都可能消耗上游 API 用量，并且可能获取远程图像、调用外部视觉端点。

#### 输入结构

| 属性       | 类型                             | 说明                                           |
| :--------- | :------------------------------- | :--------------------------------------------- |
| `prompt`   | `string`                         | 视觉分析要执行的查询或指令。                   |
| `images`   | `Array<ImageSource>`             | 要分析的图像对象列表，数量为 1 到 10。         |
| `coverage` | `"auto" \| "overview" \| "full"` | 切片策略，默认为 `auto`。                      |
| `maxTiles` | `integer`（可选）                | 覆盖本次调用的细节切片硬上限，范围为 1 到 64。 |

##### ImageSource 类型

- **文件来源**：`{ "type": "file", "uri": "file:///path/to/image.png", "label": "可选标签" }`
- **URL 来源**：`{ "type": "url", "url": "https://example.com/photo.jpg", "label": "可选标签" }`
- **Base64 来源**：`{ "type": "base64", "data": "<base64_string>", "mediaType": "image/png", "label": "可选标签" }`

#### 结果、警告与错误

成功结果包含 `complete` 字段。当 `complete` 为 `false` 时，结果仍可能包含有用证据，但每个 `warnings[]` 条目都会通过以下机器可读字段解释缺失的覆盖范围：

```json
{
  "code": "TILE_BUDGET_EXCEEDED",
  "message": "Detail coverage requires 16 tiles, but this call allows 10.",
  "retryable": false,
  "userActionRequired": true,
  "nextAction": "Continue with the partial result, disclose the missing coverage, and increase maxTiles only if the user requests complete analysis.",
  "details": { "requiredTiles": 16, "allowedTiles": 10 }
}
```

工具调用失败时返回 `isError: true`，同时返回可读文本和包含 `code`、`message`、`retryable`、`userActionRequired`、`nextAction` 以及可选安全 `details` 的 `structuredContent.error`。调用方 AI 应遵循 `nextAction`：永久性的输入、配置或协议错误会明确要求不要重试；临时性的网络、超时、限流和服务器错误允许调用方进行一次有界重试。如果同一个临时错误再次出现，应停止重试并通知用户。

错误信息不会包含凭据、Authorization 请求头、Base64/图像字节、完整本地路径或 URL、堆栈跟踪或完整提示词。

---

## 💻 本地开发

项目使用 **Bun** 进行依赖安装、测试和编译。

```bash
# 安装依赖
bun install

# 运行单元测试和集成测试
bun test

# 运行完整检查（格式化、lint、类型检查、测试、构建）
bun run check

# 构建输出文件
bun run build
```

---

## 📄 许可证

[MIT License](LICENSE) © 2026 [ygq-future](https://github.com/ygq-future)
