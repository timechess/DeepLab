import Link from 'next/link';

import { DailyWorkflowTrigger } from '@/components/ops/daily-workflow-trigger';
import { StatusBadge } from '@/components/ui/status-badge';
import { getWorkflowRuns } from '@/lib/api/client';
import { formatTriggerType, formatWorkflowName } from '@/lib/labels';
import { decodeQueryParam } from '@/lib/query';
import { formatDateTime } from '@/lib/time';

const FILTER_STATUSES = ['running', 'succeeded', 'failed', 'partial_succeeded'] as const;
const STATUS_LABEL: Record<(typeof FILTER_STATUSES)[number], string> = {
  running: '进行中',
  succeeded: '成功',
  failed: '失败',
  partial_succeeded: '部分成功',
};

function formatWorkflowModel(context: Record<string, unknown>): string {
  const llmUsageRaw = context.llmUsage;
  if (!llmUsageRaw || typeof llmUsageRaw !== 'object' || Array.isArray(llmUsageRaw)) {
    return '--';
  }

  const labels = Object.values(llmUsageRaw).flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }
    const model = String((value as { model?: unknown }).model ?? '').trim();
    if (!model) {
      return [];
    }
    return [model];
  });

  return labels.length > 0 ? Array.from(new Set(labels)).join(' | ') : '--';
}

export default async function OpsWorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; notice?: string; error?: string }>;
}) {
  const query = await searchParams;
  const selectedStatus = FILTER_STATUSES.includes(query.status as (typeof FILTER_STATUSES)[number])
    ? query.status
    : '';

  const runs = await getWorkflowRuns(100);
  const filteredRuns = selectedStatus
    ? runs.filter((run) => run.status === selectedStatus)
    : runs;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 className="page-title">运营后台 · 工作流</h2>
          <p className="page-subtitle">查看工作流记录、筛选状态并手动触发任务。</p>
        </div>
      </header>

      {query.notice ? <p className="notice">{decodeQueryParam(query.notice)}</p> : null}
      {query.error ? <p className="notice notice-error">{decodeQueryParam(query.error)}</p> : null}

      <section className="panel" style={{ display: 'grid', gap: 12 }}>
        <div className="toolbar">
          <DailyWorkflowTrigger />
        </div>

        <form className="inline-form" method="get">
          <label htmlFor="status-filter">状态筛选</label>
          <select defaultValue={selectedStatus} id="status-filter" name="status">
            <option value="">全部状态</option>
            {FILTER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
          <button className="button button-secondary" type="submit">
            应用
          </button>
          <Link className="button button-secondary" href="/ops/workflows">
            重置
          </Link>
        </form>
      </section>

      <section className="panel">
        <div className="table-wrap">
          <table className="data-table workflows-table">
            <thead>
              <tr>
                <th>运行编号</th>
                <th className="workflow-name-col">工作流</th>
                <th className="workflow-trigger-col">触发方式</th>
                <th className="workflow-model-col">模型</th>
                <th>状态</th>
                <th className="workflow-time-col">开始时间</th>
                <th className="workflow-time-col">结束时间</th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((run) => {
                const modelLabel = formatWorkflowModel(run.context);
                const workflowLabel = formatWorkflowName(run.workflowName);
                const triggerLabel = formatTriggerType(run.triggerType);
                const startedLabel = formatDateTime(run.startedAt);
                const finishedLabel = formatDateTime(run.finishedAt);
                return (
                <tr key={run.id}>
                  <td>
                    <Link className="code-link cell-nowrap-ellipsis workflow-run-id" href={`/ops/workflows/${run.id}`} title={run.id}>
                      {run.id}
                    </Link>
                  </td>
                  <td className="workflow-name-col">
                    <span className="cell-nowrap-ellipsis" title={workflowLabel}>
                      {workflowLabel}
                    </span>
                  </td>
                  <td className="workflow-trigger-col">
                    <span className="cell-nowrap-ellipsis" title={triggerLabel}>
                      {triggerLabel}
                    </span>
                  </td>
                  <td className="workflow-model-col">
                    <span className="cell-nowrap-ellipsis" title={modelLabel}>
                      {modelLabel}
                    </span>
                  </td>
                  <td>
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="workflow-time-col">
                    <span className="cell-nowrap-ellipsis" title={startedLabel}>
                      {startedLabel}
                    </span>
                  </td>
                  <td className="workflow-time-col">
                    <span className="cell-nowrap-ellipsis" title={finishedLabel}>
                      {finishedLabel}
                    </span>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
