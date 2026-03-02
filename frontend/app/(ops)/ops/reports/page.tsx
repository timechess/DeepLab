import Link from 'next/link';

import { getReadingReports } from '@/lib/api/client';
import { formatDateTime } from '@/lib/time';

function commentStatus(comment: string): 'commented' | 'uncommented' {
  return comment.trim() ? 'commented' : 'uncommented';
}

export default async function OpsReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ paperId?: string; status?: string }>;
}) {
  const query = await searchParams;
  const paperId = query.paperId?.trim() || '';
  const status = query.status === 'commented' || query.status === 'uncommented' ? query.status : 'all';

  const reports = await getReadingReports({
    limit: 200,
    paperId: paperId || undefined,
  });

  const filteredReports =
    status === 'all'
      ? reports
      : reports.filter((report) => commentStatus(report.comment) === status);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 className="page-title">运营后台 · 报告管理</h2>
          <p className="page-subtitle">按论文编号搜索报告，并按评论状态筛选。</p>
        </div>
      </header>

      <section className="panel" style={{ display: 'grid', gap: 10 }}>
        <form className="inline-form" method="get">
          <input defaultValue={paperId} name="paperId" placeholder="按论文编号搜索" />
          <select defaultValue={status} name="status">
            <option value="all">全部</option>
            <option value="uncommented">未评论</option>
            <option value="commented">已评论</option>
          </select>
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
              {filteredReports.map((report) => (
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
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
