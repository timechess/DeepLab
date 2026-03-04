import Link from 'next/link';

import type { PaperMeta, ReadingReport } from '@/lib/api/schemas';
import { MarkdownRenderer } from '@/lib/markdown/renderer';
import { formatDate, formatDateTime } from '@/lib/time';

function formatAuthors(authors: string[] | undefined): string {
  if (!authors || authors.length === 0) {
    return '作者信息缺失';
  }
  if (authors.length <= 3) {
    return authors.join(' / ');
  }
  return `${authors.slice(0, 3).join(' / ')} +${authors.length - 3}`;
}

function MetaChips({ meta }: { meta: PaperMeta | null | undefined }) {
  if (!meta) {
    return (
      <div className="meta-chip-list">
        <span className="meta-chip">暂无论文元信息</span>
      </div>
    );
  }

  const chips = [
    meta.organization ? `机构 ${meta.organization}` : null,
    `⬆ ${meta.upvotes}`,
    meta.githubStars !== null ? `⭐ ${meta.githubStars}` : '⭐ --',
    `发布 ${formatDate(meta.publishedAt)}`,
  ].filter(Boolean) as string[];

  return (
    <div className="meta-chip-list">
      {chips.map((chip) => (
        <span className="meta-chip" key={chip}>
          {chip}
        </span>
      ))}
    </div>
  );
}

function ReportItem({ report }: { report: ReadingReport }) {
  const meta = report.paperMeta;
  const keywords = meta?.aiKeywords?.slice(0, 4) ?? [];
  const stage2Content = report.stage2Content?.trim();

  return (
    <li className="report-card">
      <div className="report-card-head">
        <p className="mono-id">{report.paperId}</p>
        <p className="page-subtitle">更新于 {formatDateTime(report.updatedAt)}</p>
      </div>

      <h3 className="report-card-title">{report.paperTitle || meta?.title || '未命名论文'}</h3>

      <p className="report-author-line">{formatAuthors(meta?.authors)}</p>

      <MetaChips meta={meta} />

      {keywords.length > 0 ? (
        <div className="meta-chip-list">
          {keywords.map((keyword) => (
            <span className="meta-chip meta-chip-outline" key={keyword}>
              {keyword}
            </span>
          ))}
        </div>
      ) : null}

      <div className="report-preview-block">
        <p className="panel-kicker" style={{ margin: 0 }}>
          精读报告展示
        </p>
        <div className="report-preview-scrollbox">
          {stage2Content ? (
            <MarkdownRenderer content={stage2Content} />
          ) : (
            <p className="page-subtitle">暂无精读报告内容。</p>
          )}
        </div>
      </div>

      <div className="holo-line" />

      <Link className="button button-secondary" href={`/reports/${report.id}`}>
        进入详情
      </Link>
    </li>
  );
}

export function ReportGroups({
  commented,
  uncommented,
}: {
  commented: ReadingReport[];
  uncommented: ReadingReport[];
}) {
  return (
    <div className="split-grid">
      <section className="panel">
        <p className="panel-kicker">待处理</p>
        <h2 className="panel-title">未评论报告（{uncommented.length}）</h2>
        <ul className="panel-list selected-paper-list" style={{ marginTop: 14 }}>
          {uncommented.length > 0 ? (
            uncommented.map((report) => {
              const meta = report.paperMeta;
              const keywords = meta?.aiKeywords?.slice(0, 4) ?? [];
              return (
                <li className="report-card" key={report.id}>
                  <div className="report-card-head">
                    <p className="mono-id">{report.paperId}</p>
                    <p className="page-subtitle">更新于 {formatDateTime(report.updatedAt)}</p>
                  </div>

                  <h3 className="report-card-title">{report.paperTitle || meta?.title || '未命名论文'}</h3>

                  <p className="report-author-line">{formatAuthors(meta?.authors)}</p>

                  <MetaChips meta={meta} />

                  {keywords.length > 0 ? (
                    <div className="meta-chip-list">
                      {keywords.map((keyword) => (
                        <span className="meta-chip meta-chip-outline" key={keyword}>
                          {keyword}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="holo-line" />

                  <Link className="button button-secondary" href={`/reports/${report.id}`}>
                    进入详情
                  </Link>
                </li>
              );
            })
          ) : (
            <li className="report-card">
              <p className="page-subtitle">暂无未评论报告。</p>
            </li>
          )}
        </ul>
      </section>

      <section className="panel">
        <p className="panel-kicker">已归档</p>
        <h2 className="panel-title">已评论报告（{commented.length}）</h2>
        <ul className="panel-list" style={{ marginTop: 14 }}>
          {commented.length > 0 ? (
            commented.map((report) => <ReportItem key={report.id} report={report} />)
          ) : (
            <li className="report-card">
              <p className="page-subtitle">暂无已评论报告。</p>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
