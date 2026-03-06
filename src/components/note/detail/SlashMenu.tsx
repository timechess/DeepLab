import type { SlashCommandItem, SlashMenuState } from "./types";

interface SlashMenuProps {
  state: SlashMenuState;
  items: SlashCommandItem[];
  onPick: (command: SlashCommandItem) => void;
}

export function SlashMenu({ state, items, onPick }: SlashMenuProps) {
  if (!state.open) {
    return null;
  }

  return (
    <div
      className="note-slash-menu"
      style={{ top: state.position.top, left: state.position.left }}
    >
      {items.length > 0 ? (
        items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={index === state.activeIndex ? "active" : ""}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(item);
            }}
          >
            {item.label}
            <span>{item.hint}</span>
          </button>
        ))
      ) : (
        <p className="px-2 py-1 text-xs text-[#8ba2c7]">无匹配命令</p>
      )}
    </div>
  );
}
