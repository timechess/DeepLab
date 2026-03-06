"use client";

import { cjk } from "@streamdown/cjk";
import { createCodePlugin } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { createMermaidPlugin } from "@streamdown/mermaid";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import { EmptyStateToday } from "@/components/EmptyStateToday";
import { RecommendationSummaryCard } from "@/components/RecommendationSummaryCard";
import { RecommendedPaperCard } from "@/components/RecommendedPaperCard";
import {
  getWorkReportDetail,
  getTodayWorkReportOverview,
  startWorkReportWorkflow,
  type WorkReportDetail,
  type WorkReportOverviewResponse,
} from "@/lib/workReport";
import {
  getTodayPaperRecommendation,
  startPaperRecommendationWorkflow,
  type TodayRecommendationResponse,
} from "@/lib/workflow";

export default function HomePage() {
  const [paperData, setPaperData] = useState<TodayRecommendationResponse | null>(
    null,
  );
  const [workReportData, setWorkReportData] =
    useState<WorkReportOverviewResponse | null>(null);
  const [workReportDetail, setWorkReportDetail] =
    useState<WorkReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggeringPaper, setTriggeringPaper] = useState(false);
  const [triggeringWorkReport, setTriggeringWorkReport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadToday = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [paperResponse, workReportResponse] = await Promise.all([
        getTodayPaperRecommendation(),
        getTodayWorkReportOverview(),
      ]);
      setPaperData(paperResponse);
      setWorkReportData(workReportResponse);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  useEffect(() => {
    if (workReportData?.status !== "ready" || !workReportData.reportId) {
      setWorkReportDetail(null);
      return;
    }
    void (async () => {
      try {
        const detail = await getWorkReportDetail(workReportData.reportId as number);
        setWorkReportDetail(detail);
      } catch {
        setWorkReportDetail(null);
      }
    })();
  }, [workReportData?.reportId, workReportData?.status]);

  const reportPlugins = useMemo(
    () => ({
      cjk,
      code: createCodePlugin({ themes: ["github-light", "github-dark"] }),
      math: createMathPlugin({ singleDollarTextMath: true }),
      mermaid: createMermaidPlugin({ config: { theme: "dark" } }),
    }),
    [],
  );

  const handleTriggerPaper = useCallback(async () => {
    setTriggeringPaper(true);
    try {
      const response = await startPaperRecommendationWorkflow();
      window.location.href = `/workflow?workflowId=${response.workflowId}`;
    } catch (triggerError) {
      setTriggeringPaper(false);
      setError(
        triggerError instanceof Error ? triggerError.message : String(triggerError),
      );
    }
  }, []);

  const handleTriggerWorkReport = useCallback(async () => {
    setTriggeringWorkReport(true);
    setError(null);
    try {
      const response = await startWorkReportWorkflow();
      window.location.href = `/workflow?workflowId=${response.workflowId}`;
    } catch (triggerError) {
      setTriggeringWorkReport(false);
      setError(
        triggerError instanceof Error ? triggerError.message : String(triggerError),
      );
      await loadToday();
    }
  }, [loadToday]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-10">
      <header className="mb-10">
        <p className="text-sm font-semibold tracking-[0.15em] text-[#8ba2c7]">DeepLab</p>
        <h1 className="mt-3 font-serif text-5xl leading-[0.92] font-semibold text-[#e5ecff]">
          今日 AI 论文推荐
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-[#9fb0d0]">
          基于当日新增候选论文进行自动初筛，支持后台执行、规则驱动和可审计输出。
        </p>
      </header>

      {loading ? (
        <section className="rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-8 text-[#9fb0d0]">
          正在加载今日数据...
        </section>
      ) : null}

      {!loading && error ? (
        <section className="rounded-3xl border border-[#6e2a45] bg-[#2a1020] p-8 text-[#ff9fba]">
          {error}
        </section>
      ) : null}

      {!loading && !error && paperData?.status === "none" ? (
        <EmptyStateToday loading={triggeringPaper} onTrigger={handleTriggerPaper} />
      ) : null}

      {!loading && !error && paperData?.status === "running" ? (
        <section className="rounded-3xl border border-[#2d3a52] bg-[#101a2c] p-8 text-[#9fc1ff]">
          <p>今日工作流正在后台运行。</p>
          <Link
            href={
              paperData.workflowId
                ? `/workflow?workflowId=${paperData.workflowId}`
                : "/workflow"
            }
            className="mt-4 inline-flex rounded-full border border-[#4f7dff] px-4 py-2 text-sm font-semibold text-[#cfe0ff]"
          >
            前往 /workflow 查看进度
          </Link>
        </section>
      ) : null}

      {!loading && !error && paperData?.status === "failed" ? (
        <section className="rounded-3xl border border-[#6e2a45] bg-[#2a1020] p-8 text-[#ff9fba]">
          <p>今日工作流执行失败：{paperData.error ?? "未知错误"}</p>
          <div className="mt-4">
            <EmptyStateToday loading={triggeringPaper} onTrigger={handleTriggerPaper} />
          </div>
        </section>
      ) : null}

      {!loading && !error && paperData?.status === "ready" ? (
        <div className="space-y-8">
          <RecommendationSummaryCard
            dayKey={paperData.dayKey}
            summary={paperData.summary ?? ""}
          />
          <section className="grid gap-4">
            {paperData.papers?.map((paper) => (
              <RecommendedPaperCard key={paper.id} paper={paper} />
            ))}
          </section>
        </div>
      ) : null}

      {!loading && !error && workReportData ? (
        <section className="mt-8 rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-6 shadow-[0_14px_40px_rgba(0,0,0,0.35)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold tracking-[0.12em] text-[#8ba2c7]">
                {workReportData.dayKey}
              </p>
              <h2 className="mt-2 font-serif text-4xl leading-tight font-semibold text-[#e5ecff]">
                工作日报
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/work_report"
                className="cursor-pointer rounded-full border border-[#2d3a52] px-4 py-2 text-xs font-semibold text-[#c7d5ef] transition-colors duration-200 hover:border-[#4f7dff] hover:bg-[#142033]"
              >
                历史管理
              </Link>
              {workReportData.reportId ? (
                <Link
                  href={`/work_report/detail?reportId=${workReportData.reportId}`}
                  className="cursor-pointer rounded-full border border-[#2d3a52] px-4 py-2 text-xs font-semibold text-[#c7d5ef] transition-colors duration-200 hover:border-[#4f7dff] hover:bg-[#142033]"
                >
                  查看今日日报
                </Link>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <article className="rounded-xl border border-[#2d3a52] bg-[#111d31] p-3">
              <p className="text-xs text-[#8ba2c7]">新任务</p>
              <p className="mt-1 text-2xl font-semibold text-[#e5ecff]">{workReportData.stats.newTasks}</p>
            </article>
            <article className="rounded-xl border border-[#2d3a52] bg-[#102524] p-3">
              <p className="text-xs text-[#8ba2c7]">新完成</p>
              <p className="mt-1 text-2xl font-semibold text-[#9AF7C4]">{workReportData.stats.completedTasks}</p>
            </article>
            <article className="rounded-xl border border-[#2d3a52] bg-[#111d31] p-3">
              <p className="text-xs text-[#8ba2c7]">新评论</p>
              <p className="mt-1 text-2xl font-semibold text-[#e5ecff]">{workReportData.stats.newComments}</p>
            </article>
            <article className="rounded-xl border border-[#2d3a52] bg-[#111d31] p-3">
              <p className="text-xs text-[#8ba2c7]">改评论</p>
              <p className="mt-1 text-2xl font-semibold text-[#e5ecff]">{workReportData.stats.updatedComments}</p>
            </article>
            <article className="rounded-xl border border-[#2d3a52] bg-[#111d31] p-3">
              <p className="text-xs text-[#8ba2c7]">新笔记</p>
              <p className="mt-1 text-2xl font-semibold text-[#e5ecff]">{workReportData.stats.newNotes}</p>
            </article>
            <article className="rounded-xl border border-[#2d3a52] bg-[#111d31] p-3">
              <p className="text-xs text-[#8ba2c7]">改笔记</p>
              <p className="mt-1 text-2xl font-semibold text-[#e5ecff]">{workReportData.stats.updatedNotes}</p>
            </article>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleTriggerWorkReport()}
              disabled={!workReportData.canTrigger || triggeringWorkReport}
              className="cursor-pointer rounded-full border border-[#4f7dff] bg-[#4f7dff] px-5 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#3d66da] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {triggeringWorkReport ? "正在触发..." : "生成工作日报"}
            </button>
            {workReportData.workflowId ? (
              <Link
                href={`/workflow?workflowId=${workReportData.workflowId}`}
                className="cursor-pointer rounded-full border border-[#2d3a52] px-4 py-2 text-xs font-semibold text-[#c7d5ef] transition-colors duration-200 hover:border-[#4f7dff] hover:bg-[#142033]"
              >
                查看工作流
              </Link>
            ) : null}
            {workReportData.blockReason ? (
              <p className="text-sm text-[#9fb0d0]">{workReportData.blockReason}</p>
            ) : null}
          </div>

          {workReportData.status === "ready" ? (
            <div className="report-markdown mt-6 rounded-2xl border border-[#1f2a3d] bg-[#101a2c] p-5">
              <h3 className="font-serif text-2xl text-[#e5ecff]">今日日报内容</h3>
              {workReportDetail?.report ? (
                <Streamdown className="mt-4" parseIncompleteMarkdown={false} plugins={reportPlugins}>
                  {workReportDetail.report}
                </Streamdown>
              ) : (
                <p className="mt-3 text-sm text-[#8ba2c7]">日报内容加载中...</p>
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
