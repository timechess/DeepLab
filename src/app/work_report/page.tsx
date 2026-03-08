"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getWorkReportHistory,
  type WorkReportHistoryResponse,
} from "@/lib/workReport";

export default function WorkReportPage() {
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<WorkReportHistoryResponse | null>(
    null,
  );

  const totalPages = useMemo(() => {
    if (!history || history.pageSize <= 0) {
      return 1;
    }
    return Math.max(1, Math.ceil(history.total / history.pageSize));
  }, [history]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getWorkReportHistory(page);
      setHistory(response);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-10">
      <header className="mb-8">
        <p className="text-sm font-semibold tracking-[0.15em] text-[#8ba2c7]">
          DeepLab / Work Report
        </p>
        <h1 className="mt-3 font-serif text-5xl leading-[0.95] font-semibold text-[#e5ecff]">
          工作日报管理
        </h1>
        <p className="mt-2 text-sm text-[#9fb0d0]">查看历史日报与生成状态。</p>
      </header>

      <section className="rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-5 shadow-[0_14px_40px_rgba(0,0,0,0.35)]">
        {loading ? (
          <p className="text-sm text-[#8ba2c7]">正在加载日报列表...</p>
        ) : null}
        {!loading && error ? (
          <p className="text-sm text-[#ff9fba]">{error}</p>
        ) : null}

        {!loading && !error ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#26344d] text-[#9fb0d0]">
                    <th className="px-3 py-3 font-semibold">ID</th>
                    <th className="px-3 py-3 font-semibold">状态</th>
                    <th className="px-3 py-3 font-semibold">起始日期</th>
                    <th className="px-3 py-3 font-semibold">结束日期</th>
                    <th className="px-3 py-3 font-semibold">更新时间</th>
                    <th className="px-3 py-3 font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {history?.items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b border-[#1f2a3d] text-[#dbe6ff] transition-colors hover:bg-[#101a2c]"
                    >
                      <td className="px-3 py-3">{item.id}</td>
                      <td className="px-3 py-3">{item.status}</td>
                      <td className="px-3 py-3">{item.startDate}</td>
                      <td className="px-3 py-3">{item.endDate}</td>
                      <td className="px-3 py-3">{item.updatedAt}</td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/work_report/detail?reportId=${item.id}`}
                          className="cursor-pointer rounded-full border border-[#2d3a52] px-3 py-1 text-xs font-semibold text-[#c7d5ef] transition-colors duration-200 hover:border-[#4f7dff] hover:bg-[#142033]"
                        >
                          查看详情
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-[#8ba2c7]">
                第 {history?.page ?? page} / {totalPages} 页，共{" "}
                {history?.total ?? 0} 条
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  className="cursor-pointer rounded-full border border-[#1f2a3d] px-4 py-2 text-xs font-semibold text-[#c7d5ef] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() =>
                    setPage((prev) => Math.min(totalPages, prev + 1))
                  }
                  className="cursor-pointer rounded-full border border-[#1f2a3d] px-4 py-2 text-xs font-semibold text-[#c7d5ef] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  下一页
                </button>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
