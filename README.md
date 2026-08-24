<div align="center">

# 𝓗𝓮𝔁𝓸 𝓕𝓵𝓪𝓼𝓱𝓬𝓪𝓻𝓭 𝓟𝓵𝓾𝓰𝓲𝓷

<p align="center">为静态博客加入显式闪卡与本地间隔复习 · 𝑭𝒍𝒂𝒔𝒉𝒄𝒂𝒓𝒅𝒔 𝒂𝒏𝒅 𝑺𝒑𝒂𝒄𝒆𝒅 𝑹𝒆𝒑𝒆𝒕𝒊𝒕𝒊𝒐𝒏 𝒇𝒐𝒓 𝑯𝒆𝒙𝒐</p>

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.19-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Hexo](https://img.shields.io/badge/Hexo-8.x-0E83CD?logo=hexo&logoColor=white)](https://hexo.io/)
[![License](https://img.shields.io/badge/License-MIT-22C55E)](./package.json)

</div>

<a id="overview"></a>

<h2 align="center">𝑶𝒗𝒆𝒓𝒗𝒊𝒆𝒘 · 简介</h2>

`hexo-flashcard-plugin` 是面向 <b>Hexo 8.x</b> 的轻量闪卡插件。作者在文章中显式声明问答、填空和选择卡；读者既能在正文中翻卡，也能进入 `/learn-topic/`，使用 <b>FSRS</b> 四档评价完成本地间隔复习。

- 只处理显式 `flashcard` 定义和有效的 `flashcard_ref` 引用，不改写普通正文、`hideToggle` 或 `folding`。
- 为每张卡保留全站稳定身份，支持跨文章引用、文章筛选、卡组筛选和标签筛选。
- 生成文章内翻转卡、真实数量的“复习本篇”入口、独立复习页及浏览器端资源。
- 使用随插件生成的本地 `ts-fsrs` 资源；核心学习不依赖账号、云端接口或运行时 <b>CDN</b>。
- 进度只保存在当前浏览器，插件不会修改宿主主题源码、菜单或主题配置。

<a id="capabilities"></a>

<h2 align="center">𝑪𝒂𝒑𝒂𝒃𝒊𝒍𝒊𝒕𝒊𝒆𝒔 · 主要能力</h2>

| 能力 | 作者输入 | 读者得到的结果 |
| --- | --- | --- |
| 问答卡 | `type=basic` 与三段式内容 | 问题、回答和解析 |
| 填空卡 | `type=cloze` 与 `[[隐藏内容]]` | 正面留空、背面揭晓 |
| 选择卡 | `type=choice`、选项与正确键 | 展示选项并在背面自评 |
| 跨文章引用 | `{% flashcard_ref id="..." %}` | 多篇文章共享一张卡和一份进度 |
| 复习筛选 | `article`、`deck` 或 `tag` 查询参数 | 先限定范围，再建立到期卡或新卡队列 |
| 本地调度 | 忘记、模糊、记得、简单 | 由 `ts-fsrs` 计算下一次到期时间 |

<a id="requirements-installation"></a>

<h2 align="center">𝑰𝒏𝒔𝒕𝒂𝒍𝒍𝒂𝒕𝒊𝒐𝒏 · 要求与安装</h2>

- <b>Node.js</b>：`>=20.19.0`
- <b>Hexo</b>：`>=8 <9`
- 模块格式：<b>CommonJS</b>

当前包尚未发布到 <b>npm Registry</b>。检出本仓库后，在目标 <b>Hexo</b> 站点中从相邻的本地目录安装：

```bash
npm install ../hexo-flashcard-plugin
```

<b>Hexo</b> 会加载站点依赖中以 `hexo-` 开头的插件。插件安装后不需要修改主题源码；站点导航中的“复习”入口仍由宿主集成方显式配置。

<a id="quick-start"></a>

<h2 align="center">𝑸𝒖𝒊𝒄𝒌 𝑺𝒕𝒂𝒓𝒕 · 快速开始</h2>

在文章中加入一张三段式问答卡：

```markdown
{% flashcard basic id:http-404 deck:"HTTP 基础" tags:"状态码,客户端错误" %}
--- question
HTTP 404 表示什么？
--- answer
请求的资源不存在。
--- explanation
服务器没有找到目标资源。
{% endflashcard %}
```

然后使用站点现有的 <b>Hexo</b> 生成命令。构建成功后：

- 原文章会显示可翻面的 `Q01` 卡片和“复习本篇 · 1 张卡片”入口。
- 默认复习页位于 `/learn-topic/`。
- 插件资源默认生成到 `/flashcard-assets/`。

卡片的 `id` 必须全站唯一且长期稳定。卡片内容修改但 `id` 不变时，当前浏览器会继续关联原进度。

<a id="card-syntax"></a>

<h2 align="center">𝑪𝒂𝒓𝒅 𝑺𝒚𝒏𝒕𝒂𝒙 · 卡片语法</h2>

每张卡都必须包含非空的 `question`、`answer` 和 `explanation` 三段。`deck` 可以写在卡片上，也可以通过文章 <b>Front Matter</b> 的 `flashcard_deck` 提供默认值。

<a id="cloze-card"></a>

<h3 align="center">填空卡</h3>

```markdown
{% flashcard cloze id:http-cache deck:"HTTP 基础" tags:"缓存" %}
--- question
强缓存通常由 [[Cache-Control]] 控制。
--- answer
Cache-Control
--- explanation
它声明浏览器和中间缓存的缓存策略。
{% endflashcard %}
```

<a id="choice-card"></a>

<h3 align="center">选择卡</h3>

```markdown
{% flashcard choice id:http-success deck:"HTTP 基础" tags:"状态码" answer:A %}
--- question
哪个状态码通常表示请求成功？
- [A] 200
- [B] 404
- [C] 500
--- answer
200 OK
--- explanation
200 的标准原因短语是 OK。
{% endflashcard %}
```

选择卡至少需要两个 `- [key] label` 选项，并通过 `answer` 或 `correct` 属性声明正确选项键。它不会自动判分；读者查看答案后仍使用四档自评。

<a id="card-reference"></a>

<h3 align="center">跨文章引用</h3>

```markdown
{% flashcard_ref id="http-404" %}
```

引用只接受已存在的卡片 `id`，不能覆盖题目、回答、解析、卡组或标签。同一文章重复引用同一 `id` 时只渲染和计数一次。

<a id="configuration"></a>

<h2 align="center">𝑪𝒐𝒏𝒇𝒊𝒈𝒖𝒓𝒂𝒕𝒊𝒐𝒏 · 配置</h2>

以下配置均为可选项：

```yaml
flashcard:
  path: learn-topic
  asset_path: flashcard-assets
  title: 复习
```

| 配置项 | 默认值 | 作用 |
| --- | --- | --- |
| `flashcard.path` | `learn-topic` | 复习页公开路径 |
| `flashcard.asset_path` | `flashcard-assets` | 样式、脚本和本地调度资源路径 |
| `flashcard.title` | `复习` | 复习页标题 |

插件不负责把复习页加入主题菜单。宿主站点应在桌面导航和移动端菜单中显式提供名称为“复习”的入口，并指向配置后的公开路径。

<a id="study-progress"></a>

<h2 align="center">𝑺𝒕𝒖𝒅𝒚 𝑭𝒍𝒐𝒘 · 复习与进度</h2>

1. 页面先应用 `article`、`deck` 或 `tag` 筛选。
2. 当前范围内 `due <= 当前时间` 的旧卡形成不可回退的会话快照。
3. 读者翻面后选择忘记、模糊、记得或简单。
4. 插件用相同时间点和相同参数提交按钮所预览的 <b>FSRS</b> 结果，然后自动进入下一张。
5. 没有到期旧卡时，可以单独开始从未学习的新卡。

浏览器进度使用稳定卡片 `id` 保存在 `localStorage`。不同浏览器或设备不会自动同步；确认清除后也无法恢复。

<a id="development"></a>

<h2 align="center">𝑫𝒆𝒗𝒆𝒍𝒐𝒑𝒎𝒆𝒏𝒕 · 开发与验证</h2>

```bash
npm test
npm run test:unit
npm run test:integration
npm run check
```

| 命令 | 检查范围 |
| --- | --- |
| `npm test` | 全部 <b>Node.js</b> 测试 |
| `npm run test:unit` | 解析与调度单元测试 |
| `npm run test:integration` | 真实 <b>Hexo</b> fixture 生成测试 |
| `npm run check` | JavaScript 语法检查与全部测试 |

集成测试使用 `test/fixtures/` 中的最小站点，验证文章卡、文章入口、复习页和本地资源生成。真实主题中的桌面导航、移动端菜单、明暗主题与 <b>PJAX</b> 往返仍需在独立宿主站点中验收。

<a id="contracts-limitations"></a>

<h2 align="center">𝑪𝒐𝒏𝒕𝒓𝒂𝒄𝒕𝒔 · 契约、限制与许可证</h2>

- 产品行为、用户文案、公开路径、调度语义和验收标准以 [`docs/产品需求/`](./docs/产品需求/PRD需求文档.md) 为唯一来源。
- 本版不包含账号、云同步、跨设备同步、历史修改、自由浏览、参数训练或高级统计。
- 插件不直接依赖 <b>Butterfly</b>；该主题只作为增强兼容与真实集成验收宿主。
- `package.json` 声明许可证为 <b>MIT</b>，但仓库当前没有独立的 `LICENSE` 文件。
- `hexo-flashcard-plugin` 当前尚未发布到 <b>npm Registry</b>；从本地检出目录安装是现阶段可用路径。
- <b>GitHub</b> 页面渲染和真实 <b>Butterfly</b> 宿主浏览器流程未在本次 <b>README</b> 编写中验证。
