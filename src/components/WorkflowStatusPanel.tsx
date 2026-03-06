import type { WorkflowStatusResponse } from "@/lib/workflow";

interface WorkflowStatusPanelProps {
  loading: boolean;
  status?: WorkflowStatusResponse;
  fallbackError?: string;
}

export function WorkflowStatusPanel({
  loading,
  status,
  fallbackError,
}: WorkflowStatusPanelProps) {
  if (loading) {
    return (
      <section className="rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-8">
        <p className="text-sm text-[#9fb0d0]">正在加载工作流状态...</p>
      </section>
    );
  }

  if (!status) {
    return (
      <section className="rounded-3xl border border-[#6e2a45] bg-[#2a1020] p-8 text-[#ff9fba]">
        {fallbackError ?? "尚未找到工作流状态。"}
      </section>
    );
  }

  const toneClass =
    status.stage === "success"
      ? "border-[#1f5f4a] bg-[#102920] text-[#8ef3cf]"
      : status.stage === "failed"
        ? "border-[#6e2a45] bg-[#2a1020] text-[#ff9fba]"
        : "border-[#2d3a52] bg-[#101a2c] text-[#9fc1ff]";

  return (
    <section className={`rounded-3xl border p-8 ${toneClass}`}>
      <h2 className="font-serif text-3xl font-semibold">
        工作流状态：{status.stage}
      </h2>
      <p className="mt-3 text-sm">ID: {status.id}</p>
      {status.error ? (
        <p className="mt-3 text-sm">错误: {status.error}</p>
      ) : null}
      <pre className="mt-4 overflow-x-auto rounded-xl border border-current/20 bg-[#0a1220] p-4 text-xs leading-5">
        {JSON.stringify(status.payload, null, 2)}
      </pre>
    </section>
  );
}
