"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getPaperReportHistory,
  type PaperReportListResponse,
  startPaperReadingWorkflow,
} from "@/lib/paperReport";

function validateArxivInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return "请输入 arXiv id 或 URL";
  }
  const plainId = /^[A-Za-z0-9./-]+$/;
  const absUrl =
    /^https?:\/\/arxiv\.org\/(abs|pdf)\/[A-Za-z0-9./-]+(\.pdf)?([?#].*)?$/;
  if (!plainId.test(trimmed) && !absUrl.test(trimmed)) {
    return "格式不正确，示例：2501.12345 或 https://arxiv.org/abs/2501.12345";
  }
  return null;
}

export default function PaperReportPage() {
  const [paperInput, setPaperInput] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<PaperReportListResponse | null>(null);
  const [latestPaperId, setLatestPaperId] = useState<string | null>(null);

  const inputError = useMemo(
    () => validateArxivInput(paperInput),
    [paperInput],
  );

  const totalPages = useMemo(() => {
    if (!history || history.pageSize <= 0) {
      return 1;
    }
    return Math.max(1, Math.ceil(history.total / history.pageSize));
  }, [history]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getPaperReportHistory(page);
      setHistory(response);
      setError(null);
    } catch (historyError) {
      setError(
        historyError instanceof Error
          ? historyError.message
          : String(historyError),
      );
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const validationError = validateArxivInput(paperInput);
      if (validationError) {
        setError(validationError);
        return;
      }

      setSubmitting(true);
      setError(null);
      try {
        const response = await startPaperReadingWorkflow({
          paperIdOrUrl: paperInput.trim(),
        });
        setLatestPaperId(response.paperId);
        window.location.href = `/workflow?workflowId=${response.workflowId}`;
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : String(submitError),
        );
      } finally {
        setSubmitting(false);
      }
    },
    [paperInput],
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-10">
      <header className="mb-8">
        <p className="text-sm font-semibold tracking-[0.15em] text-[#8ba2c7]">
          DeepLab / Paper Reading
        </p>
        <h1 className="mt-3 font-serif text-5xl leading-[0.95] font-semibold text-[#e5ecff]">
          论文精读报告
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[#9fb0d0]">
          输入 arXiv id 或链接，系统会在后台完成元信息抓取、OCR 与报告生成。
        </p>
      </header>

      <section className="rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-5 shadow-[0_14px_40px_rgba(0,0,0,0.35)]">
        <form
          className="grid gap-3 md:grid-cols-[1fr_auto]"
          onSubmit={handleSubmit}
        >
          <label className="text-sm text-[#c7d5ef]">
            arXiv id / URL
            <input
              value={paperInput}
              onChange={(event) => setPaperInput(event.target.value)}
              placeholder="例如：2501.12345 或 https://arxiv.org/abs/2501.12345"
              className="mt-2 w-full rounded-xl border border-[#1f2a3d] px-3 py-3 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={submitting || Boolean(inputError)}
            className="cursor-pointer self-end rounded-full bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "提交中..." : "开始精读"}
          </button>
        </form>

        {inputError ? (
          <p className="mt-3 text-xs text-[#ff9fba]">{inputError}</p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-[#ff9fba]">{error}</p> : null}
      </section>

      <section className="mt-6 rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-5 shadow-[0_14px_40px_rgba(0,0,0,0.35)]">
        {loading ? (
          <p className="text-sm text-[#8ba2c7]">正在加载报告列表...</p>
        ) : null}

        {!loading && !error ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#26344d] text-[#9fb0d0]">
                    <th className="px-3 py-3 font-semibold">论文 ID</th>
                    <th className="px-3 py-3 font-semibold">标题</th>
                    <th className="px-3 py-3 font-semibold">状态</th>
                    <th className="px-3 py-3 font-semibold">更新时间</th>
                    <th className="px-3 py-3 font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {history?.items.map((item) => {
                    const isLatest = latestPaperId === item.paperId;
                    return (
                      <tr
                        key={item.paperId}
                        className={`border-b border-[#1f2a3d] text-[#dbe6ff] transition-colors ${
                          isLatest ? "bg-[#142033]" : "hover:bg-[#101a2c]"
                        }`}
                      >
                        <td className="px-3 py-3">{item.paperId}</td>
                        <td className="px-3 py-3">{item.title}</td>
                        <td className="px-3 py-3">
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-semibold ${
                              item.status === "ready"
                                ? "bg-[#123524] text-[#9AF7C4]"
                                : item.status === "failed"
                                  ? "bg-[#4A1628] text-[#FFB0CC]"
                                  : "bg-[#1D355B] text-[#A7C5FF]"
                            }`}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td className="px-3 py-3">{item.updatedAt}</td>
                        <td className="px-3 py-3">
                          <Link
                            href={`/paper_report/detail?paperId=${encodeURIComponent(item.paperId)}`}
                            className="cursor-pointer rounded-full border border-[#2d3a52] px-3 py-1 text-xs font-semibold text-[#c7d5ef] transition-colors duration-200 hover:border-[#4f7dff] hover:bg-[#142033]"
                          >
                            查看详情
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
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
