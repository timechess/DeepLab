import type { Editor } from "@tiptap/core";
import { Extension, mergeAttributes, Node } from "@tiptap/core";
import Suggestion, {
  exitSuggestion,
  type SuggestionKeyDownProps,
} from "@tiptap/suggestion";

export type SlashAction =
  | "paper"
  | "task"
  | "note"
  | "work_report"
  | "table"
  | "code"
  | "inline_math"
  | "block_math";

interface SlashItem {
  title: string;
  description: string;
  action: SlashAction;
}

export const NoteReference = Node.create({
  name: "noteReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      refType: { default: "note" },
      refId: { default: "" },
      label: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-note-ref]" }];
  },
  renderHTML({ HTMLAttributes }) {
    const refType =
      typeof HTMLAttributes.refType === "string"
        ? HTMLAttributes.refType
        : "note";
    const label =
      typeof HTMLAttributes.label === "string" && HTMLAttributes.label.trim()
        ? HTMLAttributes.label
        : HTMLAttributes.refId;
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-note-ref": "1",
        "data-ref-type": refType,
        class: `note-ref-chip note-ref-chip--${refType}`,
        title: `${refType}:${HTMLAttributes.refId}`,
      }),
      label,
    ];
  },
  renderText({ node }) {
    const attrs = node.attrs as {
      refType?: string;
      refId?: string;
      label?: string;
    };
    return `[[${attrs.refType ?? "note"}:${attrs.refId ?? ""}|${attrs.label ?? attrs.refId ?? ""}]]`;
  },
});

export const SlashCommand = Extension.create<{
  onCommand: (action: SlashAction, editor: Editor) => void;
}>({
  name: "slashCommand",
  addOptions() {
    return {
      onCommand: () => {},
    };
  },
  addProseMirrorPlugins() {
    const items: SlashItem[] = [
      { title: "paper", description: "插入论文链接", action: "paper" },
      { title: "task", description: "插入任务链接", action: "task" },
      { title: "note", description: "插入笔记链接", action: "note" },
      {
        title: "work_report",
        description: "插入工作日报链接",
        action: "work_report",
      },
      { title: "table", description: "插入表格", action: "table" },
      { title: "code", description: "插入代码块", action: "code" },
      {
        title: "inline_math",
        description: "插入行内公式",
        action: "inline_math",
      },
      {
        title: "block_math",
        description: "插入块级公式",
        action: "block_math",
      },
    ];

    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        allowSpaces: false,
        items: ({ query }) => {
          const normalized = query.toLowerCase();
          return items
            .filter((item) => item.title.includes(normalized))
            .slice(0, 8);
        },
        command: ({ editor, range, props }) => {
          const item = props as SlashItem;
          if (!item) {
            return;
          }
          editor.chain().focus().deleteRange(range).run();
          this.options.onCommand(item.action, editor);
        },
        render: () => {
          let selectedIndex = 0;
          let popup: HTMLDivElement | null = null;
          let currentItems: SlashItem[] = [];
          let command: ((item: SlashItem) => void) | null = null;
          const renderList = () => {
            if (!popup) {
              return;
            }
            popup.innerHTML = currentItems
              .map(
                (item, index) =>
                  `<button type="button" data-index="${index}" class="${index === selectedIndex ? "active" : ""}">${item.title}<span>${item.description}</span></button>`,
              )
              .join("");
          };
          const handlePointerDown = (event: MouseEvent) => {
            event.preventDefault();
            const target = event.target as HTMLElement | null;
            const button = target?.closest(
              "button[data-index]",
            ) as HTMLButtonElement | null;
            if (!button || !command) {
              return;
            }
            const index = Number(button.dataset.index ?? "-1");
            const item = currentItems[index];
            if (!item) {
              return;
            }
            command(item);
          };
          return {
            onStart: (props) => {
              selectedIndex = 0;
              currentItems = props.items as SlashItem[];
              command = props.command as (item: SlashItem) => void;
              popup = document.createElement("div");
              popup.className = "note-slash-menu";
              popup.addEventListener("mousedown", handlePointerDown);
              document.body.appendChild(popup);
              const rect = props.clientRect?.();
              if (rect) {
                popup.style.left = `${rect.left}px`;
                popup.style.top = `${rect.bottom + 8}px`;
              }
              renderList();
            },
            onUpdate: (props) => {
              currentItems = props.items as SlashItem[];
              command = props.command as (item: SlashItem) => void;
              const rect = props.clientRect?.();
              if (popup && rect) {
                popup.style.left = `${rect.left}px`;
                popup.style.top = `${rect.bottom + 8}px`;
              }
              if (selectedIndex >= currentItems.length) {
                selectedIndex = Math.max(0, currentItems.length - 1);
              }
              renderList();
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (currentItems.length === 0) {
                return false;
              }
              if (props.event.key === "ArrowUp") {
                selectedIndex =
                  (selectedIndex + currentItems.length - 1) %
                  currentItems.length;
                renderList();
                return true;
              }
              if (props.event.key === "ArrowDown") {
                selectedIndex = (selectedIndex + 1) % currentItems.length;
                renderList();
                return true;
              }
              if (props.event.key === "Enter" || props.event.key === "Tab") {
                const item = currentItems[selectedIndex];
                if (item && command) {
                  command(item);
                  return true;
                }
              }
              if (props.event.key === "Escape") {
                exitSuggestion(props.view);
                return true;
              }
              return false;
            },
            onExit: () => {
              if (popup) {
                popup.removeEventListener("mousedown", handlePointerDown);
                popup.remove();
              }
              command = null;
            },
          };
        },
      }),
    ];
  },
});
