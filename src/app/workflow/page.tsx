"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkflowStatusPanel } from "@/components/WorkflowStatusPanel";
import {
  getWorkflowHistory,
  getWorkflowStatus,
  type WorkflowHistoryResponse,
  type WorkflowStatusResponse,
} from "@/lib/workflow";

export default function WorkflowPage() {
  const searchParams = useSearchParams();
  const queryWorkflowId = useMemo(() => {
    const raw = searchParams.get("workflowId");
    if (!raw) {
      return null;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }, [searchParams]);

  const [page, setPage] = useState(1);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [history, setHistory] = useState<WorkflowHistoryResponse | null>(null);

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<number | null>(
    queryWorkflowId,
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | undefined>();
  const [detail, setDetail] = useState<WorkflowStatusResponse | undefined>();

  const totalPages = useMemo(() => {
    if (!history || history.pageSize <= 0) {
      return 1;
    }
    return Math.max(1, Math.ceil(history.total / history.pageSize));
  }, [history]);

  const loadHistory = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const response = await getWorkflowHistory(page);
      setHistory(response);
      if (response.items.length > 0 && !selectedWorkflowId) {
        setSelectedWorkflowId(response.items[0].id);
      }
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingList(false);
    }
  }, [page, selectedWorkflowId]);

  const loadDetail = useCallback(async () => {
    if (!selectedWorkflowId) {
      setDetail(undefined);
      setDetailError(undefined);
      return;
    }
    setDetailLoading(true);
    try {
      const response = await getWorkflowStatus(selectedWorkflowId);
      setDetail(response);
      setDetailError(undefined);
    } catch (error) {
      setDetail(undefined);
      setDetailError(error instanceof Error ? error.message : String(error));
    } finally {
      setDetailLoading(false);
    }
  }, [selectedWorkflowId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (queryWorkflowId) {
      setSelectedWorkflowId(queryWorkflowId);
    }
  }, [queryWorkflowId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-10">
      <header className="mb-8">
        <p className="text-sm font-semibold tracking-[0.15em] text-[#8ba2c7]">
          DeepLab / Workflow
        </p>
        <h1 className="mt-3 font-serif text-5xl leading-[0.95] font-semibold text-[#e5ecff]">
          历史工作流管理
        </h1>
        <p className="mt-2 text-sm text-[#9fb0d0]">
          分页查看所有工作流，点击行可查看 payload 详情与错误信息。
        </p>
      </header>

      <section className="rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-5 shadow-[0_14px_40px_rgba(0,0,0,0.35)]">
        {loadingList ? (
          <p className="text-sm text-[#8ba2c7]">正在加载历史记录...</p>
        ) : null}
        {!loadingList && listError ? (
          <p className="text-sm text-[#ff9fba]">{listError}</p>
        ) : null}

        {!loadingList && !listError ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#26344d] text-[#9fb0d0]">
                    <th className="px-3 py-3 font-semibold">ID</th>
                    <th className="px-3 py-3 font-semibold">名称</th>
                    <th className="px-3 py-3 font-semibold">状态</th>
                    <th className="px-3 py-3 font-semibold">日期</th>
                    <th className="px-3 py-3 font-semibold">创建时间</th>
                    <th className="px-3 py-3 font-semibold">错误</th>
                  </tr>
                </thead>
                <tbody>
                  {history?.items.map((item) => {
                    const selected = selectedWorkflowId === item.id;
                    return (
                      <tr
                        key={item.id}
                        className={`cursor-pointer border-b border-[#1f2a3d] text-[#dbe6ff] transition-colors ${
                          selected ? "bg-[#142033]" : "hover:bg-[#101a2c]"
                        }`}
                        onClick={() => setSelectedWorkflowId(item.id)}
                      >
                        <td className="px-3 py-3">{item.id}</td>
                        <td className="px-3 py-3">{item.name}</td>
                        <td className="px-3 py-3">{item.stage}</td>
                        <td className="px-3 py-3">{item.dayKey ?? "-"}</td>
                        <td className="px-3 py-3">{item.createdAt}</td>
                        <td className="px-3 py-3">{item.error ?? "-"}</td>
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
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="cursor-pointer rounded-full border border-[#1f2a3d] px-4 py-2 text-xs font-semibold text-[#c7d5ef] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="cursor-pointer rounded-full border border-[#1f2a3d] px-4 py-2 text-xs font-semibold text-[#c7d5ef] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  下一页
                </button>
              </div>
            </div>
          </>
        ) : null}
      </section>

      <div className="mt-6">
        <WorkflowStatusPanel
          loading={detailLoading}
          status={detail}
          fallbackError={detailError}
        />
      </div>
    </main>
  );
}
