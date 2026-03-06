"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmptyStateToday } from "@/components/EmptyStateToday";
import { RecommendationSummaryCard } from "@/components/RecommendationSummaryCard";
import { RecommendedPaperCard } from "@/components/RecommendedPaperCard";
import {
  getTodayPaperRecommendation,
  startPaperRecommendationWorkflow,
  type TodayRecommendationResponse,
} from "@/lib/workflow";

export default function HomePage() {
  const [data, setData] = useState<TodayRecommendationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadToday = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getTodayPaperRecommendation();
      setData(response);
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

  const handleTrigger = useCallback(async () => {
    setTriggering(true);
    try {
      const response = await startPaperRecommendationWorkflow();
      window.location.href = `/workflow?workflowId=${response.workflowId}`;
    } catch (triggerError) {
      setTriggering(false);
      setError(
        triggerError instanceof Error
          ? triggerError.message
          : String(triggerError),
      );
    }
  }, []);

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-10">
      <header className="mb-10">
        <p className="text-sm font-semibold tracking-[0.15em] text-[#8ba2c7]">
          DeepLab
        </p>
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

      {!loading && !error && data?.status === "none" ? (
        <EmptyStateToday loading={triggering} onTrigger={handleTrigger} />
      ) : null}

      {!loading && !error && data?.status === "running" ? (
        <section className="rounded-3xl border border-[#2d3a52] bg-[#101a2c] p-8 text-[#9fc1ff]">
          <p>今日工作流正在后台运行。</p>
          <Link
            href={
              data.workflowId
                ? `/workflow?workflowId=${data.workflowId}`
                : "/workflow"
            }
            className="mt-4 inline-flex rounded-full border border-[#4f7dff] px-4 py-2 text-sm font-semibold text-[#cfe0ff]"
          >
            前往 /workflow 查看进度
          </Link>
        </section>
      ) : null}

      {!loading && !error && data?.status === "failed" ? (
        <section className="rounded-3xl border border-[#6e2a45] bg-[#2a1020] p-8 text-[#ff9fba]">
          <p>今日工作流执行失败：{data.error ?? "未知错误"}</p>
          <div className="mt-4">
            <EmptyStateToday loading={triggering} onTrigger={handleTrigger} />
          </div>
        </section>
      ) : null}

      {!loading && !error && data?.status === "ready" ? (
        <div className="space-y-8">
          <RecommendationSummaryCard
            dayKey={data.dayKey}
            summary={data.summary ?? ""}
          />
          <section className="grid gap-4">
            {data.papers?.map((paper) => (
              <RecommendedPaperCard key={paper.id} paper={paper} />
            ))}
          </section>
        </div>
      ) : null}
    </main>
  );
}
