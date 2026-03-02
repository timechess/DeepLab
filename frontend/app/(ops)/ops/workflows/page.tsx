import Link from 'next/link';

import {
  triggerDailyWorkflowAction,
  triggerFetchPapersAction,
  triggerFilterPapersAction,
  triggerReadPapersAction,
} from '@/app/actions';
import { StatusBadge } from '@/components/ui/status-badge';
import { getWorkflowRuns } from '@/lib/api/client';
import { formatTriggerType, formatWorkflowName } from '@/lib/labels';
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
    const provider = String((value as { provider?: unknown }).provider ?? '').trim();
    const model = String((value as { model?: unknown }).model ?? '').trim();
    if (!provider || !model) {
      return [];
    }
    return [`${provider} / ${model}`];
  });

  return labels.length > 0 ? Array.from(new Set(labels)).join(' | ') : '--';
}

function decodeParam(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  return decodeURIComponent(value);
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

  const redirectTo = selectedStatus
    ? `/ops/workflows?status=${encodeURIComponent(selectedStatus)}`
    : '/ops/workflows';

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 className="page-title">运营后台 · 工作流</h2>
          <p className="page-subtitle">查看工作流记录、筛选状态并手动触发任务。</p>
        </div>
      </header>

      {query.notice ? <p className="notice">{decodeParam(query.notice)}</p> : null}
      {query.error ? <p className="notice notice-error">{decodeParam(query.error)}</p> : null}

      <section className="panel" style={{ display: 'grid', gap: 12 }}>
        <div className="toolbar">
          <form action={triggerDailyWorkflowAction} className="inline-form">
            <input name="redirectTo" type="hidden" value={redirectTo} />
            <button className="button button-primary" type="submit">
              触发每日工作流
            </button>
          </form>

          <form action={triggerFetchPapersAction} className="inline-form">
            <input name="redirectTo" type="hidden" value={redirectTo} />
            <button className="button button-secondary" type="submit">
              手动收集论文
            </button>
          </form>

          <form action={triggerFilterPapersAction} className="inline-form">
            <input name="redirectTo" type="hidden" value={redirectTo} />
            <button className="button button-secondary" type="submit">
              手动初筛
            </button>
          </form>

          <form action={triggerReadPapersAction} className="inline-form">
            <input name="redirectTo" type="hidden" value={redirectTo} />
            <button className="button button-secondary" type="submit">
              手动精读
            </button>
          </form>
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
          <table className="data-table">
            <thead>
              <tr>
                <th>运行编号</th>
                <th>工作流</th>
                <th>触发方式</th>
                <th>模型</th>
                <th>状态</th>
                <th>开始时间</th>
                <th>结束时间</th>
                <th>错误信息</th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((run) => (
                <tr key={run.id}>
                  <td>
                    <Link className="code-link" href={`/ops/workflows/${run.id}`}>
                      {run.id}
                    </Link>
                  </td>
                  <td>{formatWorkflowName(run.workflowName)}</td>
                  <td>{formatTriggerType(run.triggerType)}</td>
                  <td>{formatWorkflowModel(run.context)}</td>
                  <td>
                    <StatusBadge status={run.status} />
                  </td>
                  <td>{formatDateTime(run.startedAt)}</td>
                  <td>{formatDateTime(run.finishedAt)}</td>
                  <td>{run.errorMessage || '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
