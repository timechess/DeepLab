"use client";

import { cjk } from "@streamdown/cjk";
import { createCodePlugin } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { createMermaidPlugin } from "@streamdown/mermaid";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import { getWorkReportDetail, type WorkReportDetail } from "@/lib/workReport";

function normalizeMathDelimiters(markdown: string): string {
  return markdown
    .replace(/\\\[(.*?)\\\]/gs, (_, expr: string) => `$$${expr}$$`)
    .replace(/\\\((.*?)\\\)/gs, (_, expr: string) => `$${expr}$`);
}

function WorkReportDetailPageContent() {
  const searchParams = useSearchParams();
  const reportId = useMemo(() => {
    const raw = searchParams.get("reportId");
    if (!raw) {
      return null;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }, [searchParams]);

  const [detail, setDetail] = useState<WorkReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!reportId) {
      setLoading(false);
      setDetail(null);
      setError("缺少 reportId 参数");
      return;
    }
    setLoading(true);
    try {
      const response = await getWorkReportDetail(reportId);
      setDetail(response);
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
  }, [reportId]);

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
      code: createCodePlugin({ themes: ["github-light", "github-dark"] }),
      math: createMathPlugin({ singleDollarTextMath: true }),
      mermaid: createMermaidPlugin({ config: { theme: "dark" } }),
    }),
    [],
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-10">
      <header className="mb-6">
        <p className="text-sm font-semibold tracking-[0.15em] text-[#8ba2c7]">
          DeepLab / Work Report Detail
        </p>
        <h1 className="mt-3 font-serif text-4xl leading-tight font-semibold text-[#e5ecff]">
          日报详情
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
            <h2 className="font-serif text-3xl font-semibold text-[#e5ecff]">
              {detail.endDate} 工作日报
            </h2>
            <div className="mt-4 grid gap-3 text-sm text-[#c7d5ef] md:grid-cols-2">
              <p>
                <span className="text-[#8ba2c7]">报告 ID：</span>
                {detail.id}
              </p>
              <p>
                <span className="text-[#8ba2c7]">工作流：</span>
                {detail.workflowId ?? "-"}
              </p>
              <p>
                <span className="text-[#8ba2c7]">起始日期：</span>
                {detail.startDate}
              </p>
              <p>
                <span className="text-[#8ba2c7]">结束日期：</span>
                {detail.endDate}
              </p>
            </div>

            <div className="mt-4 grid gap-3 text-sm md:grid-cols-3 lg:grid-cols-6">
              <p className="rounded-xl border border-[#2d3a52] bg-[#111d31] px-3 py-2 text-[#dbe6ff]">
                新任务: {detail.statistics.newTasks}
              </p>
              <p className="rounded-xl border border-[#2d3a52] bg-[#111d31] px-3 py-2 text-[#dbe6ff]">
                新完成: {detail.statistics.completedTasks}
              </p>
              <p className="rounded-xl border border-[#2d3a52] bg-[#111d31] px-3 py-2 text-[#dbe6ff]">
                新评论: {detail.statistics.newComments}
              </p>
              <p className="rounded-xl border border-[#2d3a52] bg-[#111d31] px-3 py-2 text-[#dbe6ff]">
                改评论: {detail.statistics.updatedComments}
              </p>
              <p className="rounded-xl border border-[#2d3a52] bg-[#111d31] px-3 py-2 text-[#dbe6ff]">
                新笔记: {detail.statistics.newNotes}
              </p>
              <p className="rounded-xl border border-[#2d3a52] bg-[#111d31] px-3 py-2 text-[#dbe6ff]">
                改笔记: {detail.statistics.updatedNotes}
              </p>
            </div>
          </section>

          <section className="report-markdown mt-6 max-w-none rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-6">
            <h3 className="font-serif text-2xl text-[#e5ecff]">工作日报正文</h3>
            <Streamdown
              className="mt-4"
              parseIncompleteMarkdown={false}
              plugins={plugins}
            >
              {reportMarkdown}
            </Streamdown>
          </section>
        </>
      ) : null}
    </main>
  );
}

export default function WorkReportDetailPage() {
  return (
    <Suspense
      fallback={<main className="p-6 text-sm text-[#8ba2c7]">正在加载...</main>}
    >
      <WorkReportDetailPageContent />
    </Suspense>
  );
}
