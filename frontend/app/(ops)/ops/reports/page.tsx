import Link from 'next/link';

import { ReadByIdForm } from '@/components/ops/read-by-id-form';
import { getReadingReports, getReadingReportsCount } from '@/lib/api/client';
import { formatDateTime } from '@/lib/time';

function commentStatus(comment: string): 'commented' | 'uncommented' {
  return comment.trim() ? 'commented' : 'uncommented';
}
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
  paperTitle,
  status,
}: {
  page: number;
  paperTitle: string;
  status: string;
}): string {
  const params = new URLSearchParams();
  if (paperTitle) {
    params.set('paperTitle', paperTitle);
  }
  if (status && status !== 'all') {
    params.set('status', status);
  }
  if (page > 1) {
    params.set('page', String(page));
  }
  const query = params.toString();
  return query ? `/ops/reports?${query}` : '/ops/reports';
}

export default async function OpsReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ paperTitle?: string; status?: string; page?: string }>;
}) {
  const query = await searchParams;
  const paperTitle = query.paperTitle?.trim() || '';
  const status: 'all' | 'commented' | 'uncommented' =
    query.status === 'commented' || query.status === 'uncommented' ? query.status : 'all';
  const requestedPage = parsePage(query.page);
  const total = await getReadingReportsCount({
    paperTitle: paperTitle || undefined,
    commentStatus: status === 'all' ? undefined : status,
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * PAGE_SIZE;

  const reports = await getReadingReports({
    limit: PAGE_SIZE,
    offset,
    paperTitle: paperTitle || undefined,
    commentStatus: status === 'all' ? undefined : status,
  });
  const hasPrevPage = page > 1;
  const hasNextPage = page < totalPages;
  const visibleReports = reports;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 className="page-title">运营后台 · 报告管理</h2>
          <p className="page-subtitle">按论文标题搜索报告，并按评论状态筛选。</p>
        </div>
      </header>

      <section className="panel" style={{ display: 'grid', gap: 10 }}>
        <h3 className="panel-title" style={{ marginBottom: 0 }}>
          手动生成精读报告
        </h3>
        <p className="page-subtitle" style={{ margin: 0 }}>
          输入 arXiv ID、arXiv PDF URL，或可直接下载的 PDF URL 生成精读报告。
        </p>
        <ReadByIdForm />
      </section>

      <section className="panel" style={{ display: 'grid', gap: 10 }}>
        <form className="inline-form" method="get">
          <input defaultValue={paperTitle} name="paperTitle" placeholder="按论文标题搜索" />
          <select defaultValue={status} name="status">
            <option value="all">全部</option>
            <option value="uncommented">未评论</option>
            <option value="commented">已评论</option>
          </select>
          <input name="page" type="hidden" value="1" />
          <button className="button button-secondary" type="submit">
            查询
          </button>
          <Link className="button button-secondary" href="/ops/reports">
            重置
          </Link>
        </form>
      </section>

      <section className="panel">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>报告编号</th>
                <th>论文编号</th>
                <th>标题</th>
                <th>评论状态</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {visibleReports.length > 0 ? (
                visibleReports.map((report) => (
                  <tr key={report.id}>
                    <td>
                      <Link className="code-link" href={`/reports/${report.id}`}>
                        {report.id}
                      </Link>
                    </td>
                    <td>{report.paperId}</td>
                    <td>{report.paperTitle || '未命名论文'}</td>
                    <td>{commentStatus(report.comment) === 'commented' ? '已评论' : '未评论'}</td>
                    <td>{formatDateTime(report.updatedAt)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>暂无匹配结果。</td>
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
                href={buildReportsHref({ page: page - 1, paperTitle, status })}
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
                href={buildReportsHref({ page: page + 1, paperTitle, status })}
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
