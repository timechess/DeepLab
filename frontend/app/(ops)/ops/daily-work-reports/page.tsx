import Link from 'next/link';

import { deleteDailyWorkReportAction } from '@/app/actions';
import { getDailyWorkReports, getDailyWorkReportsCount } from '@/lib/api/client';
import { decodeQueryParam } from '@/lib/query';

const PAGE_SIZE = 10;

function parsePage(raw: string | undefined): number {
  const value = Number.parseInt(raw || '', 10);
  if (Number.isNaN(value) || value < 1) {
    return 1;
  }
  return value;
}

function buildReportsHref({
  page,
  businessDate,
}: {
  page: number;
  businessDate: string;
}): string {
  const params = new URLSearchParams();
  if (businessDate) {
    params.set('businessDate', businessDate);
  }
  if (page > 1) {
    params.set('page', String(page));
  }
  const query = params.toString();
  return query ? `/ops/daily-work-reports?${query}` : '/ops/daily-work-reports';
}

function formatBehaviorCounts(
  counts:
    | {
        reportComments: number;
        createdTasks: number;
        completedTasks: number;
        changedNotes: number;
        yesterdayActivityCount: number;
      }
    | undefined,
): string {
  if (!counts) {
    return '--';
  }
  return `总 ${counts.yesterdayActivityCount} / 评论 ${counts.reportComments} / 新建 ${counts.createdTasks} / 完成 ${counts.completedTasks} / 笔记 ${counts.changedNotes}`;
}

export default async function DailyWorkReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ businessDate?: string; page?: string; notice?: string; error?: string }>;
}) {
  const query = await searchParams;
  const businessDate = query.businessDate?.trim() || '';
  const requestedPage = parsePage(query.page);
  const total = await getDailyWorkReportsCount({ businessDate: businessDate || undefined });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * PAGE_SIZE;

  const reports = await getDailyWorkReports({
    limit: PAGE_SIZE,
    offset,
    businessDate: businessDate || undefined,
  });
  const hasPrevPage = page > 1;
  const hasNextPage = page < totalPages;
  const redirectTo = buildReportsHref({ page, businessDate });

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 className="page-title">运营后台 · 日报管理</h2>
          <p className="page-subtitle">查看日报记录并按业务日期筛选。</p>
        </div>
      </header>

      {query.notice ? <p className="notice">{decodeQueryParam(query.notice)}</p> : null}
      {query.error ? <p className="notice notice-error">{decodeQueryParam(query.error)}</p> : null}

      <section className="panel" style={{ display: 'grid', gap: 12 }}>
        <form className="inline-form" method="get">
          <label htmlFor="business-date-filter">业务日期</label>
          <input defaultValue={businessDate} id="business-date-filter" name="businessDate" placeholder="YYYY-MM-DD" />
          <input name="page" type="hidden" value="1" />
          <button className="button button-secondary" type="submit">
            查询
          </button>
          <Link className="button button-secondary" href="/ops/daily-work-reports">
            重置
          </Link>
        </form>
      </section>

      <section className="panel" style={{ display: 'grid', gap: 16 }}>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>日报编号</th>
                <th>行为统计</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {reports.length > 0 ? (
                reports.map((report) => (
                  <tr key={report.id}>
                    <td>
                      <Link className="code-link" href={`/ops/daily-work-reports/${report.id}`}>
                        {report.businessDate}
                      </Link>
                    </td>
                    <td>
                      <span className="cell-nowrap-ellipsis" title={report.id}>
                        {report.id}
                      </span>
                    </td>
                    <td>
                      <span className="cell-nowrap-ellipsis" title={formatBehaviorCounts(report.behaviorCounts)}>
                        {formatBehaviorCounts(report.behaviorCounts)}
                      </span>
                    </td>
                    <td>
                      <form action={deleteDailyWorkReportAction.bind(null, report.id)}>
                        <input name="redirectTo" type="hidden" value={redirectTo} />
                        <button className="button button-danger" type="submit">
                          删除
                        </button>
                      </form>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>暂无匹配日报。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="toolbar" style={{ marginTop: 4, justifyContent: 'space-between', gap: 12 }}>
          <p className="page-subtitle">
            第 {page} / 共 {totalPages} 页
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {hasPrevPage ? (
              <Link className="button button-secondary" href={buildReportsHref({ page: page - 1, businessDate })}>
                上一页
              </Link>
            ) : (
              <button className="button button-secondary" disabled type="button">
                上一页
              </button>
            )}
            {hasNextPage ? (
              <Link className="button button-secondary" href={buildReportsHref({ page: page + 1, businessDate })}>
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
