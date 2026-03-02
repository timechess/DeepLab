import { notFound } from 'next/navigation';

import { WorkflowAutoRefresh } from '@/components/ops/workflow-auto-refresh';
import { JsonBlock } from '@/components/ui/json-block';
import { StatusBadge } from '@/components/ui/status-badge';
import { getWorkflowRun } from '@/lib/api/client';
import { formatStageName, formatTriggerType, formatWorkflowName } from '@/lib/labels';
import { formatDateTime } from '@/lib/time';

function formatWorkflowModel(context: Record<string, unknown>): string {
  const llmUsageRaw = context.llmUsage;
  if (!llmUsageRaw || typeof llmUsageRaw !== 'object' || Array.isArray(llmUsageRaw)) {
    return '--';
  }

  const labels = Object.entries(llmUsageRaw).flatMap(([stage, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }
    const provider = String((value as { provider?: unknown }).provider ?? '').trim();
    const model = String((value as { model?: unknown }).model ?? '').trim();
    if (!provider || !model) {
      return [];
    }
    return [`${stage}: ${provider} / ${model}`];
  });

  return labels.length > 0 ? labels.join(' ; ') : '--';
}

export default async function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail;
  try {
    detail = await getWorkflowRun(id);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('404')) {
      notFound();
    }
    throw error;
  }

  const isRunning = detail.workflow.status === 'running';

  return (
    <section className="page">
      <WorkflowAutoRefresh active={isRunning} intervalMs={5000} />

      <header className="page-header">
        <div>
          <h2 className="page-title">工作流详情</h2>
          <p className="page-subtitle">运行编号：{detail.workflow.id}</p>
        </div>
        <StatusBadge status={detail.workflow.status} />
      </header>

      <section className="panel">
        <div className="metrics-grid">
          <article className="metric-card">
            <p className="metric-label">工作流名称</p>
            <p className="metric-value">{formatWorkflowName(detail.workflow.workflowName)}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">触发方式</p>
            <p className="metric-value">{formatTriggerType(detail.workflow.triggerType)}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">开始时间</p>
            <p className="metric-value">{formatDateTime(detail.workflow.startedAt)}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">结束时间</p>
            <p className="metric-value">{formatDateTime(detail.workflow.finishedAt)}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">使用模型</p>
            <p className="metric-value">{formatWorkflowModel(detail.workflow.context)}</p>
          </article>
        </div>
        {detail.workflow.errorMessage ? (
          <p className="notice notice-error" style={{ marginTop: 12 }}>
            {detail.workflow.errorMessage}
          </p>
        ) : null}
      </section>

      <section className="panel">
        <p className="panel-kicker">阶段时间线</p>
        <h3 className="panel-title" style={{ marginBottom: 12 }}>
          阶段执行详情
        </h3>

        <div className="timeline">
          {detail.stages.map((stage) => (
            <article
              className={`timeline-item${stage.status === 'failed' ? ' timeline-item-failed' : ''}`}
              key={stage.id}
            >
              <div className="timeline-head">
                <h4 style={{ margin: 0 }}>{formatStageName(stage.stage)}</h4>
                <StatusBadge status={stage.status} />
              </div>
              <p className="page-subtitle" style={{ marginTop: 8 }}>
                开始: {formatDateTime(stage.startedAt)} · 结束: {formatDateTime(stage.finishedAt)}
              </p>

              {stage.errorMessage ? (
                <p className="notice notice-error" style={{ marginTop: 10 }}>
                  {stage.errorMessage}
                </p>
              ) : null}

              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>输入载荷</summary>
                <JsonBlock data={stage.inputPayload} />
              </details>

              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>输出载荷</summary>
                <JsonBlock data={stage.outputPayload} />
              </details>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
