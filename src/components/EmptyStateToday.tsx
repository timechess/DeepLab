import { TriggerWorkflowButton } from "@/components/TriggerWorkflowButton";

interface EmptyStateTodayProps {
  loading?: boolean;
  onTrigger: () => void;
}

export function EmptyStateToday({
  loading = false,
  onTrigger,
}: EmptyStateTodayProps) {
  return (
    <section className="rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-8 shadow-[0_20px_45px_rgba(0,0,0,0.35)]">
      <h2 className="font-serif text-3xl font-semibold text-[#e5ecff]">
        今天还没有推荐结果
      </h2>
      <p className="mt-3 max-w-2xl text-base text-[#9fb0d0]">
        点击按钮将立即启动后台工作流，并跳转到工作流页面查看进度。页面渲染不会被阻塞。
      </p>
      <div className="mt-6">
        <TriggerWorkflowButton loading={loading} onClick={onTrigger} />
      </div>
    </section>
  );
}
