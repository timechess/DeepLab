import Link from 'next/link';

import { DailyWorkReportTrigger } from '@/components/ops/daily-work-report-trigger';
import { StatusBadge } from '@/components/ui/status-badge';
import { getDailyWorkReports, getDailyWorkReportsCount } from '@/lib/api/client';
import { formatTriggerType } from '@/lib/labels';
import { MarkdownRenderer } from '@/lib/markdown/renderer';
import { formatDateTime } from '@/lib/time';

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

export default async function DailyWorkReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ businessDate?: string; page?: string }>;
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

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 className="page-title">运营后台 · 日报管理</h2>
          <p className="page-subtitle">查看每日 AI 工作日报并按业务日期筛选。</p>
        </div>
      </header>

      <section className="panel" style={{ display: 'grid', gap: 12 }}>
        <DailyWorkReportTrigger />
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
        {reports.length > 0 ? (
          reports.map((report) => (
            <article className="signal-card" key={report.id} style={{ display: 'grid', gap: 10 }}>
              <div className="report-card-head">
                <div>
                  <p className="mono-id">{report.businessDate}</p>
                  <h3 className="panel-title" style={{ marginTop: 4 }}>
                    AI 工作日报
                  </h3>
                </div>
                <StatusBadge status={report.status} />
              </div>
              <p className="page-subtitle">
                行为来源日期：{report.sourceDate} · 生成时间：{formatDateTime(report.updatedAt)}
              </p>
              <p className="page-subtitle">
                工作流：{report.workflowId || '--'} · 触发方式：
                {report.workflowTriggerType ? formatTriggerType(report.workflowTriggerType) : '--'}
              </p>
              {report.errorMessage ? <p className="notice notice-error">{report.errorMessage}</p> : null}
              {report.reportMarkdown.trim() ? (
                <div className="report-content-scrollbox">
                  <MarkdownRenderer content={report.reportMarkdown} />
                </div>
              ) : (
                <p className="page-subtitle">该日报暂无正文内容。</p>
              )}
            </article>
          ))
        ) : (
          <p className="page-subtitle">暂无匹配日报。</p>
        )}
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
