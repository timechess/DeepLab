import { notFound } from 'next/navigation';

import { StatusBadge } from '@/components/ui/status-badge';
import { getDailyWorkReport } from '@/lib/api/client';
import { MarkdownRenderer } from '@/lib/markdown/renderer';
import { decodeQueryParam } from '@/lib/query';
import { formatDateTime } from '@/lib/time';

export default async function DailyWorkReportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  let report;
  try {
    report = await getDailyWorkReport(id);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('404')) {
      notFound();
    }
    throw error;
  }

  const sourceMarkdown = report.sourceMarkdown?.trim() || '';
  const reportMarkdown = report.reportMarkdown?.trim() || '';

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 className="page-title">工作日报详情</h2>
          <p className="page-subtitle">
            日期 {report.businessDate} · 编号 {report.id}
          </p>
        </div>
        <StatusBadge status={report.status} />
      </header>

      {query.notice ? <p className="notice">{decodeQueryParam(query.notice)}</p> : null}
      {query.error ? <p className="notice notice-error">{decodeQueryParam(query.error)}</p> : null}

      <section className="panel">
        <div className="meta-kv-grid">
          <article className="meta-kv">
            <span>业务日期</span>
            <strong>{report.businessDate}</strong>
          </article>
          <article className="meta-kv">
            <span>来源日期</span>
            <strong>{report.sourceDate}</strong>
          </article>
          <article className="meta-kv">
            <span>更新时间</span>
            <strong>{formatDateTime(report.updatedAt)}</strong>
          </article>
        </div>
      </section>

      <section className="panel">
        <h3 className="panel-title">行为总结</h3>
        <div className="report-content-scrollbox" style={{ marginTop: 12 }}>
          {sourceMarkdown ? <MarkdownRenderer content={sourceMarkdown} /> : <p className="page-subtitle">暂无行为汇总内容。</p>}
        </div>
      </section>

      <section className="panel">
        <h3 className="panel-title">生成日报</h3>
        <div className="report-content-scrollbox" style={{ marginTop: 12 }}>
          {reportMarkdown ? <MarkdownRenderer content={reportMarkdown} /> : <p className="page-subtitle">暂无日报正文内容。</p>}
        </div>
      </section>
    </section>
  );
}
