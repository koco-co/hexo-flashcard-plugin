# hexo-flashcard-plugin 项目指令

## 项目定位

- 本项目是面向 Hexo 8.x 的可复用闪卡插件，最低 Node.js 版本为 20.19。
- `docs/产品需求/` 是产品行为、入口、FSRS 调度和验收标准的唯一来源。
- 独立的宿主博客仓库只用于集成验收，不是插件源码目录。

## 目录与所有权

- `index.js`：Hexo 插件注册入口。
- `lib/`：卡片解析、校验、页面生成和 Hexo 生命周期接入。
- `assets/`：插件提供的浏览器端 CSS 与 JavaScript。
- `test/`：解析与调度单元测试、真实 Hexo 集成测试。
- `test/fixtures/`：真实 Hexo 集成测试所需的最小站点内容。
- `docs/产品需求/`：已确认需求包，不与实现说明混写。
- 生成物、覆盖率产物和依赖目录不得作为源码手工维护。

## 对外行为边界

- 只有显式 `flashcard` 块和有效 `flashcard_ref` 引用进入学习系统；不得自动转换 `hideToggle`、`folding` 或普通正文。
- 默认全局学习入口是 `/learn-topic/`，含卡文章提供真实数量的“复习本篇”入口。
- 插件不得修改宿主主题源码、主题菜单或主题配置。
- 核心学习功能不得依赖账号、外部 API、CDN 或云同步。
- 卡片 ID、标签输入格式、公开路由、用户文案、FSRS 调度参数或本地进度语义发生变化时，必须先同步并确认正式需求包。

## 实现约定

- 使用 CommonJS，并保持 Node.js 20.19 与 Hexo 8.x 兼容。
- Hexo 注册、纯解析逻辑、复习调度和浏览器交互分层，纯逻辑不得依赖 Hexo 全局状态。
- 构建错误必须包含来源文章、卡片 ID、字段和可执行原因。
- 前端初始化必须幂等，兼容首次加载与 `pjax:complete`，目标 DOM 不存在时安静退出。
- 样式必须适配宿主明暗主题、移动端、键盘焦点和 reduced-motion。
- 不直接依赖 Butterfly；Butterfly 只能作为增强兼容与真实验收宿主。

## 验证命令

- `npm test`：运行全部 Node.js 测试。
- `npm run test:unit`：运行解析与调度单元测试。
- `npm run test:integration`：运行真实 Hexo fixture 集成测试。
- `npm run check`：运行 JavaScript 语法检查和全部测试。

修改解析或校验时至少运行单元测试与集成测试；修改页面生成、资源注入或浏览器交互时运行完整 `npm run check`，并在真实 Hexo 宿主中验证目标路由。

## Git 与发布

- 保留用户和并行任务的已有修改，不覆盖无关差异。
- 未经明确授权，不提交、不推送、不发布 npm 包、不创建 Tag 或 GitHub Release。
- 宿主博客的依赖、配置和演示内容属于独立集成步骤，不从插件仓库反向改写。
