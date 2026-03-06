import type { PickerOption, TargetPickerState } from "./types";

interface TargetPickerProps {
  state: TargetPickerState;
  loading: boolean;
  options: PickerOption[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onChoose: (option: PickerOption) => void;
  onMoveNext: () => void;
  onMovePrev: () => void;
}

export function TargetPicker({
  state,
  loading,
  options,
  inputRef,
  onQueryChange,
  onClose,
  onChoose,
  onMoveNext,
  onMovePrev,
}: TargetPickerProps) {
  if (!state.open) {
    return null;
  }

  return (
    <div
      className="note-slash-menu min-w-[340px] max-w-[520px]"
      style={{ top: state.position.top, left: state.position.left }}
    >
      <div className="px-2 pb-2 text-xs text-[#8ba2c7]">插入结构化引用</div>
      <input
        ref={inputRef}
        value={state.query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            onMoveNext();
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            onMovePrev();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const selected = options[state.activeIndex];
            if (selected) {
              onChoose(selected);
            }
          }
        }}
        placeholder="输入关键词搜索"
        className="mb-2 w-full rounded-lg border border-[#1f2a3d] bg-[#0d1728] px-3 py-2 text-sm text-[#dbe6ff] outline-none transition-colors focus:border-[#4f7dff]"
      />
      <div className="max-h-[280px] overflow-y-auto">
        {loading ? (
          <p className="px-2 py-1 text-xs text-[#8ba2c7]">加载中...</p>
        ) : null}
        {!loading && options.length === 0 ? (
          <p className="px-2 py-1 text-xs text-[#8ba2c7]">无匹配结果</p>
        ) : null}
        {options.map((option, index) => (
          <button
            key={`${option.refType}:${option.refId}`}
            type="button"
            className={index === state.activeIndex ? "active" : ""}
            onMouseDown={(event) => {
              event.preventDefault();
              onChoose(option);
            }}
          >
            {option.label}
            <span>{option.meta ?? option.description ?? option.refId}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
