"use client";

import { cjk } from "@streamdown/cjk";
import { createCodePlugin } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { createMermaidPlugin } from "@streamdown/mermaid";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import {
  getPaperReportDetail,
  type PaperReportDetail,
  updatePaperReportComment,
} from "@/lib/paperReport";

function normalizeMathDelimiters(markdown: string): string {
  return markdown
    .replace(/\\\[(.*?)\\\]/gs, (_, expr: string) => `$$${expr}$$`)
    .replace(/\\\((.*?)\\\)/gs, (_, expr: string) => `$${expr}$`);
}

function PaperReportDetailPageContent() {
  const searchParams = useSearchParams();
  const paperId = useMemo(
    () => decodeURIComponent(searchParams.get("paperId") ?? ""),
    [searchParams],
  );

  const [detail, setDetail] = useState<PaperReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!paperId) {
      setLoading(false);
      setDetail(null);
      setError("缺少 paperId 参数");
      return;
    }
    setLoading(true);
    try {
      const response = await getPaperReportDetail(paperId);
      setDetail(response);
      setComment(response.comment ?? "");
      setError(null);
    } catch (detailError) {
      setError(
        detailError instanceof Error
          ? detailError.message
          : String(detailError),
      );
    } finally {
      setLoading(false);
    }
  }, [paperId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const reportMarkdown = useMemo(() => {
    const raw = detail?.report ?? "";
    return normalizeMathDelimiters(raw);
  }, [detail?.report]);
  const plugins = useMemo(
    () => ({
      cjk,
      code: createCodePlugin({
        themes: ["github-light", "github-dark"],
      }),
      math: createMathPlugin({ singleDollarTextMath: true }),
      mermaid: createMermaidPlugin({
        config: { theme: "dark" },
      }),
    }),
    [],
  );

  const handleSaveComment = useCallback(async () => {
    if (!paperId) {
      return;
    }
    setSavingComment(true);
    setMessage(null);
    setError(null);
    try {
      await updatePaperReportComment(paperId, { comment });
      setMessage("评论已保存");
      await loadDetail();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    } finally {
      setSavingComment(false);
    }
  }, [comment, loadDetail, paperId]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-10">
      <header className="mb-6">
        <p className="text-sm font-semibold tracking-[0.15em] text-[#8ba2c7]">
          DeepLab / Paper Reading Detail
        </p>
        <h1 className="mt-3 font-serif text-4xl leading-tight font-semibold text-[#e5ecff]">
          报告详情
        </h1>
      </header>

      {loading ? (
        <p className="text-sm text-[#8ba2c7]">正在加载详情...</p>
      ) : null}
      {error ? (
        <section className="mb-4 rounded-2xl border border-[#6e2a45] bg-[#2a1020] p-4 text-sm text-[#ff9fba]">
          {error}
        </section>
      ) : null}

      {detail ? (
        <>
          <section className="rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-serif text-3xl font-semibold text-[#e5ecff]">
                  {detail.title}
                </h2>
                <p className="mt-2 text-sm text-[#9fb0d0]">
                  paperId: {detail.paperId}
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  href={detail.arxivUrl}
                  target="_blank"
                  className="cursor-pointer rounded-full border border-[#2d3a52] px-3 py-2 text-xs font-semibold text-[#c7d5ef] transition-colors duration-200 hover:border-[#4f7dff] hover:bg-[#142033]"
                >
                  打开 arXiv
                </Link>
                {detail.githubRepo ? (
                  <Link
                    href={detail.githubRepo}
                    target="_blank"
                    className="cursor-pointer rounded-full border border-[#2d3a52] px-3 py-2 text-xs font-semibold text-[#c7d5ef] transition-colors duration-200 hover:border-[#4f7dff] hover:bg-[#142033]"
                  >
                    打开 GitHub
                  </Link>
                ) : null}
              </div>
            </div>

            <div className="mt-4 grid gap-3 text-sm text-[#c7d5ef] md:grid-cols-2">
              <p>
                <span className="text-[#8ba2c7]">状态：</span>
                {detail.status}
              </p>
              <p>
                <span className="text-[#8ba2c7]">更新时间：</span>
                {detail.updatedAt}
              </p>
              <p className="md:col-span-2">
                <span className="text-[#8ba2c7]">作者：</span>
                {detail.authors.length > 0 ? detail.authors.join("，") : "-"}
              </p>
              <p className="md:col-span-2">
                <span className="text-[#8ba2c7]">机构：</span>
                {detail.organization ?? "-"}
              </p>
            </div>

            <div className="mt-4 rounded-2xl border border-[#1f2a3d] bg-[#101a2c] p-4">
              <p className="text-xs font-semibold tracking-wide text-[#8ba2c7]">
                摘要
              </p>
              <p className="mt-2 text-sm leading-7 text-[#dbe6ff]">
                {detail.summary || "-"}
              </p>
            </div>

            {detail.status === "failed" ? (
              <div className="mt-4 rounded-2xl border border-[#6e2a45] bg-[#2a1020] p-4 text-sm text-[#ff9fba]">
                报告生成失败：{detail.error ?? "未知错误"}
              </div>
            ) : null}
          </section>

          <section className="report-markdown mt-6 max-w-none rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-6">
            <h3 className="font-serif text-2xl text-[#e5ecff]">精读报告</h3>
            {detail.report ? (
              <Streamdown
                className="mt-4"
                parseIncompleteMarkdown={false}
                plugins={plugins}
              >
                {reportMarkdown}
              </Streamdown>
            ) : (
              <p className="text-sm text-[#8ba2c7]">暂无报告内容。</p>
            )}
          </section>

          <section className="mt-6 rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-6">
            <h3 className="font-serif text-2xl text-[#e5ecff]">评论</h3>
            <p className="mt-1 text-xs text-[#8ba2c7]">
              支持随时更新；留空保存可清空评论。
            </p>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={6}
              className="mt-3 w-full rounded-xl border border-[#1f2a3d] px-3 py-2 text-sm"
            />
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleSaveComment()}
                disabled={savingComment}
                className="cursor-pointer rounded-full bg-[#2563EB] px-5 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingComment ? "保存中..." : "保存评论"}
              </button>
              {message ? (
                <p className="text-sm text-[#8ef3cf]">{message}</p>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

export default function PaperReportDetailPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-[#8ba2c7]">正在加载...</main>}>
      <PaperReportDetailPageContent />
    </Suspense>
  );
}
