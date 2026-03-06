import type { Editor } from "@tiptap/core";
import type { SlashCommandItem } from "./types";

export function createSlashCommands(): SlashCommandItem[] {
  return [
    {
      id: "h2",
      label: "二级标题",
      hint: "切换为 H2",
      keywords: ["heading", "h2", "title"],
      run: (editor: Editor) =>
        editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      id: "bullet",
      label: "无序列表",
      hint: "切换为项目符号列表",
      keywords: ["list", "bullet", "ul"],
      run: (editor: Editor) => editor.chain().focus().toggleBulletList().run(),
    },
    {
      id: "ordered",
      label: "有序列表",
      hint: "切换为编号列表",
      keywords: ["list", "ordered", "ol"],
      run: (editor: Editor) => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      id: "quote",
      label: "引用块",
      hint: "切换为 blockquote",
      keywords: ["quote", "blockquote"],
      run: (editor: Editor) => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      id: "code",
      label: "代码块",
      hint: "插入/切换代码块",
      keywords: ["code", "snippet"],
      run: (editor: Editor) => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      id: "inline-math",
      label: "行内公式",
      hint: "插入公式",
      keywords: ["math", "latex", "inline"],
      run: (editor: Editor) =>
        editor.chain().focus().insertContent("$x^2 + y^2 = z^2$ ").run(),
    },
    {
      id: "block-math",
      label: "块公式",
      hint: "插入块级公式",
      keywords: ["math", "latex", "block"],
      run: (editor: Editor) =>
        editor
          .chain()
          .focus()
          .insertContent([
            {
              type: "paragraph",
              content: [{ type: "text", text: "$$E = mc^2$$" }],
            },
            { type: "paragraph" },
          ])
          .run(),
    },
    {
      id: "paper",
      label: "链接文献",
      hint: "搜索并插入文献链接",
      keywords: ["paper", "arxiv", "citation", "文献"],
      targetType: "paper",
    },
    {
      id: "task",
      label: "链接任务",
      hint: "搜索并插入任务链接",
      keywords: ["task", "todo", "任务"],
      targetType: "task",
    },
    {
      id: "note",
      label: "链接笔记",
      hint: "搜索并插入笔记链接",
      keywords: ["note", "笔记"],
      targetType: "note",
    },
    {
      id: "work-report",
      label: "链接工作日报",
      hint: "按日期搜索并插入工作日报链接",
      keywords: ["work_report", "work", "report", "日报"],
      targetType: "work_report",
    },
  ];
}
