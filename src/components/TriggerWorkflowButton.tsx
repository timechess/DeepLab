interface TriggerWorkflowButtonProps {
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

export function TriggerWorkflowButton({
  disabled = false,
  loading = false,
  onClick,
}: TriggerWorkflowButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer rounded-full border border-[#4f7dff] bg-[#4f7dff] px-6 py-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#3d66da] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f7dff] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? "正在触发工作流..." : "触发今日论文推荐工作流"}
    </button>
  );
}
