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
