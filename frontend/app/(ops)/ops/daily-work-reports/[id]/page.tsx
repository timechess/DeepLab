import { notFound } from 'next/navigation';

import { StatusBadge } from '@/components/ui/status-badge';
import { getDailyWorkReport } from '@/lib/api/client';
import { MarkdownRenderer } from '@/lib/markdown/renderer';
import { decodeQueryParam } from '@/lib/query';
import { formatDateTime } from '@/lib/time';

function compactNames(values: string[], maxItems = 6): string {
  const unique = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  if (unique.length === 0) {
    return '无';
  }
  if (unique.length <= maxItems) {
    return unique.join('；');
  }
  return `${unique.slice(0, maxItems).join('；')}；等 ${unique.length} 项`;
}

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

  const reportMarkdown = report.reportMarkdown?.trim() || '';
  const behaviorSummary = report.behaviorSummary;
  const behaviorCounts = behaviorSummary?.counts ?? report.behaviorCounts;
  const commentedPaperNames = (behaviorSummary?.commentedPapers ?? []).map((item) => item.paperTitle || item.paperId);
  const createdTaskNames = (behaviorSummary?.createdTasks ?? []).map((item) => item.title);
  const completedTaskNames = (behaviorSummary?.completedTasks ?? []).map((item) => item.title);
  const changedNoteNames = (behaviorSummary?.changedNotes ?? []).map(
    (item) => `${item.title}（${item.changeType}）`,
  );

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
        <p className="panel-kicker">行为摘要</p>
        <h3 className="panel-title">昨日行为总结</h3>
        <p className="page-subtitle" style={{ marginTop: 10 }}>
          共 {behaviorCounts?.yesterdayActivityCount ?? 0} 条行为
        </p>
        <div className="meta-kv-grid" style={{ marginTop: 12 }}>
          <article className="meta-kv">
            <span>评论论文（{behaviorCounts?.reportComments ?? commentedPaperNames.length}）</span>
            <strong>{compactNames(commentedPaperNames)}</strong>
          </article>
          <article className="meta-kv">
            <span>新建任务（{behaviorCounts?.createdTasks ?? createdTaskNames.length}）</span>
            <strong>{compactNames(createdTaskNames)}</strong>
          </article>
          <article className="meta-kv">
            <span>完成任务（{behaviorCounts?.completedTasks ?? completedTaskNames.length}）</span>
            <strong>{compactNames(completedTaskNames)}</strong>
          </article>
          <article className="meta-kv">
            <span>改动笔记（{behaviorCounts?.changedNotes ?? changedNoteNames.length}）</span>
            <strong>{compactNames(changedNoteNames)}</strong>
          </article>
        </div>
      </section>

      <section className="panel">
        <p className="panel-kicker">日报输出</p>
        <h3 className="panel-title">生成日报</h3>
        <div className="report-content-scrollbox" style={{ marginTop: 12 }}>
          {reportMarkdown ? <MarkdownRenderer content={reportMarkdown} /> : <p className="page-subtitle">暂无日报正文内容。</p>}
        </div>
      </section>
    </section>
  );
}
