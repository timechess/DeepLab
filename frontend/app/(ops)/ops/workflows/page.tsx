import Link from 'next/link';

import { DailyWorkReportTrigger } from '@/components/ops/daily-work-report-trigger';
import { DailyWorkflowTrigger } from '@/components/ops/daily-workflow-trigger';
import { StatusBadge } from '@/components/ui/status-badge';
import { getWorkflowRuns, getWorkflowRunsCount } from '@/lib/api/client';
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
const PAGE_SIZE = 10;

function parsePage(raw: string | undefined): number {
  const value = Number.parseInt(raw || '', 10);
  if (Number.isNaN(value) || value < 1) {
    return 1;
  }
  return value;
}

function buildWorkflowsHref({
  page,
  status,
}: {
  page: number;
  status: string;
}): string {
  const params = new URLSearchParams();
  if (status) {
    params.set('status', status);
  }
  if (page > 1) {
    params.set('page', String(page));
  }
  const query = params.toString();
  return query ? `/ops/workflows?${query}` : '/ops/workflows';
}

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
  searchParams: Promise<{ status?: string; notice?: string; error?: string; page?: string }>;
}) {
  const query = await searchParams;
  const selectedStatus: '' | (typeof FILTER_STATUSES)[number] = FILTER_STATUSES.includes(
    query.status as (typeof FILTER_STATUSES)[number],
  )
    ? (query.status as (typeof FILTER_STATUSES)[number])
    : '';
  const requestedPage = parsePage(query.page);
  const total = await getWorkflowRunsCount({ status: selectedStatus || undefined });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * PAGE_SIZE;

  const runs = await getWorkflowRuns({
    limit: PAGE_SIZE,
    offset,
    status: selectedStatus || undefined,
  });
  const hasPrevPage = page > 1;
  const hasNextPage = page < totalPages;
  const visibleRuns = runs;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 className="page-title">工作流</h2>
        </div>
      </header>

      {query.notice ? <p className="notice">{decodeQueryParam(query.notice)}</p> : null}
      {query.error ? <p className="notice notice-error">{decodeQueryParam(query.error)}</p> : null}

      <section className="panel" style={{ display: 'grid', gap: 12 }}>
        <div className="toolbar" style={{ display: 'grid', gap: 12 }}>
          <DailyWorkflowTrigger />
          <DailyWorkReportTrigger />
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
          <input name="page" type="hidden" value="1" />
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
              {visibleRuns.length > 0 ? (
                visibleRuns.map((run) => {
                  const modelLabel = formatWorkflowModel(run.context);
                  const workflowLabel = formatWorkflowName(run.workflowName);
                  const triggerLabel = formatTriggerType(run.triggerType);
                  const startedLabel = formatDateTime(run.startedAt);
                  const finishedLabel = formatDateTime(run.finishedAt);
                  return (
                    <tr key={run.id}>
                      <td>
                        <Link
                          className="code-link cell-nowrap-ellipsis workflow-run-id"
                          href={`/ops/workflows/${run.id}`}
                          title={run.id}
                        >
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
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7}>暂无匹配结果。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div
          className="toolbar"
          style={{ marginTop: 12, justifyContent: 'space-between', gap: 12 }}
        >
          <p className="page-subtitle">
            第 {page} / 共 {totalPages} 页
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {hasPrevPage ? (
              <Link
                className="button button-secondary"
                href={buildWorkflowsHref({ page: page - 1, status: selectedStatus })}
              >
                上一页
              </Link>
            ) : (
              <button className="button button-secondary" disabled type="button">
                上一页
              </button>
            )}
            {hasNextPage ? (
              <Link
                className="button button-secondary"
                href={buildWorkflowsHref({ page: page + 1, status: selectedStatus })}
              >
                下一页
              </Link>
            ) : (
              <button className="button button-secondary" disabled type="button">
                下一页
              </button>
            )}
          </div>
        </div>
      </section>
    </section>
  );
}
