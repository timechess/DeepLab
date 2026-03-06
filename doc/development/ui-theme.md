# UI Theme Notes

## 主题方向

- 近夜间蓝黑色系
- 高对比文字
- 强调色蓝色按钮与高亮

## 主题变量

定义于 `src/styles/globals.css`：

- `--color-bg: #060b14`
- `--color-text: #e5ecff`
- `--color-muted: #8ba2c7`
- `--color-cta: #4f7dff`
- `--color-surface: #0f1724`
- `--color-border: #1f2a3d`

## 中文字体兼容

- 正文回退: Noto Sans CJK SC / PingFang SC / Microsoft YaHei / Source Han Sans SC
- 标题回退: Noto Serif CJK SC / Songti SC / STSong / Source Han Serif SC

## 组件规范

- 所有可点击元素必须 `cursor-pointer`
- hover 不应触发布局偏移
- focus 可见（键盘可访问）
- 表单控件深色底，避免浏览器默认浅色破坏主题

## Paper Report Markdown 主题化

- 仅在 `.paper-report-markdown` 作用域覆盖 `streamdown` 样式，避免全局污染
- 标题、正文、链接、表格、引用块、代码块、Mermaid 容器映射到现有蓝黑变量体系
- 已接入 `streamdown@2.3+` 插件体系（CJK/Code/Math/Mermaid）
- 全局引入 `streamdown` 与 `KaTeX` 样式，并提供 `.katex-mathml` 兜底隐藏规则，避免公式重复显示原始字符串
