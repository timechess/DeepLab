"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  createTaskItem,
  deleteTaskItem,
  getTaskHistory,
  type TaskInput,
  type TaskItem,
  type TaskListResponse,
  type TaskPriority,
  toggleTaskCompleted,
} from "@/lib/tasks";

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

const PRIORITY_CLASSNAME: Record<TaskPriority, string> = {
  low: "border-[#2d4f69] bg-[#142535] text-[#9fc1ff]",
  medium: "border-[#3f4f2a] bg-[#232f17] text-[#d7f3a1]",
  high: "border-[#6e2a45] bg-[#2a1020] text-[#ffb2cc]",
};

function normalizePriority(value: string): TaskPriority {
  if (value === "low" || value === "high") {
    return value;
  }
  return "medium";
}

export default function TaskPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TaskListResponse | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [pendingDeleteTask, setPendingDeleteTask] = useState<TaskItem | null>(
    null,
  );

  const totalPages = useMemo(() => {
    if (!data || data.pageSize <= 0) {
      return 1;
    }
    return Math.max(1, Math.ceil(data.total / data.pageSize));
  }, [data]);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getTaskHistory(page);
      setData(response);
      if (
        expandedTaskId !== null &&
        !response.items.some((item) => item.id === expandedTaskId)
      ) {
        setExpandedTaskId(null);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    } finally {
      setLoading(false);
    }
  }, [expandedTaskId, page]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const handleCreate = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const normalizedTitle = title.trim();
      if (!normalizedTitle) {
        setError("任务标题不能为空");
        return;
      }

      setSaving(true);
      setError(null);
      const input: TaskInput = {
        title: normalizedTitle,
        description: description.trim() || null,
        priority,
      };
      try {
        await createTaskItem(input);
        setTitle("");
        setDescription("");
        setPriority("medium");
        setPage(1);
        setExpandedTaskId(null);
        await loadTasks();
      } catch (createError) {
        setError(
          createError instanceof Error
            ? createError.message
            : String(createError),
        );
      } finally {
        setSaving(false);
      }
    },
    [description, loadTasks, priority, title],
  );

  const handleToggleCompleted = useCallback(
    async (task: TaskItem) => {
      setSaving(true);
      setError(null);
      try {
        await toggleTaskCompleted(task.id, !task.completedDate);
        await loadTasks();
      } catch (toggleError) {
        setError(
          toggleError instanceof Error
            ? toggleError.message
            : String(toggleError),
        );
      } finally {
        setSaving(false);
      }
    },
    [loadTasks],
  );

  const handleDelete = useCallback(
    async (taskId: number) => {
      setSaving(true);
      setError(null);
      try {
        await deleteTaskItem(taskId);
        if (expandedTaskId === taskId) {
          setExpandedTaskId(null);
        }
        await loadTasks();
      } catch (deleteError) {
        setError(
          deleteError instanceof Error
            ? deleteError.message
            : String(deleteError),
        );
      } finally {
        setSaving(false);
      }
    },
    [expandedTaskId, loadTasks],
  );

  const items = data?.items ?? [];

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-10">
      <header className="mb-8 rounded-3xl border border-[#1f2a3d] bg-[linear-gradient(140deg,rgba(15,23,36,0.96),rgba(11,20,34,0.96))] p-6 shadow-[0_18px_48px_rgba(0,0,0,0.38)]">
        <p className="text-sm font-semibold tracking-[0.15em] text-[#8ba2c7]">
          DeepLab / Task
        </p>
        <h1 className="mt-3 font-serif text-5xl leading-[0.95] font-semibold text-[#e5ecff]">
          任务清单
        </h1>
        <p className="mt-2 text-sm text-[#9fb0d0]">
          管理当前工作任务，支持快速创建、完成状态切换与删除。
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <article className="rounded-2xl border border-[#2d3a52] bg-[#111d31] p-4">
            <p className="text-xs tracking-wide text-[#8ba2c7]">任务总数</p>
            <p className="mt-1 text-3xl font-semibold text-[#e5ecff]">
              {data?.total ?? 0}
            </p>
          </article>
          <article className="rounded-2xl border border-[#2d3a52] bg-[#102524] p-4">
            <p className="text-xs tracking-wide text-[#8ba2c7]">未完成</p>
            <p className="mt-1 text-3xl font-semibold text-[#9AF7C4]">
              {data?.pendingTotal ?? 0}
            </p>
          </article>
          <article className="rounded-2xl border border-[#2d3a52] bg-[#2a1020] p-4">
            <p className="text-xs tracking-wide text-[#8ba2c7]">已完成</p>
            <p className="mt-1 text-3xl font-semibold text-[#ffb2cc]">
              {data?.completedTotal ?? 0}
            </p>
          </article>
        </div>
      </header>

      <section className="rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-5 shadow-[0_14px_40px_rgba(0,0,0,0.35)]">
        <form className="grid gap-4" onSubmit={handleCreate}>
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <label className="text-sm text-[#c7d5ef]">
              任务标题
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：整理本周论文阅读笔记"
                className="mt-2 w-full rounded-xl border border-[#1f2a3d] px-3 py-3 text-sm outline-none transition-colors duration-200 focus:border-[#4f7dff] focus-visible:ring-2 focus-visible:ring-[#4f7dff]/40"
              />
            </label>
            <div className="grid grid-cols-[minmax(120px,160px)_auto] gap-3">
              <label className="text-sm text-[#c7d5ef]">
                优先级
                <select
                  value={priority}
                  onChange={(event) =>
                    setPriority(normalizePriority(event.target.value))
                  }
                  className="mt-2 h-[46px] w-full cursor-pointer rounded-xl border border-[#1f2a3d] px-3 py-0 text-sm outline-none transition-colors duration-200 focus:border-[#4f7dff] focus-visible:ring-2 focus-visible:ring-[#4f7dff]/40"
                >
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                </select>
              </label>
              <button
                type="submit"
                disabled={saving}
                className="cursor-pointer self-end rounded-2xl bg-[#4f7dff] px-5 py-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#5f8bff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f7dff]/50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                新增任务
              </button>
            </div>
          </div>

          <label className="text-sm text-[#c7d5ef]">
            任务描述
            <textarea
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="可选，补充任务上下文、验收标准、相关链接等信息"
              className="mt-2 w-full rounded-xl border border-[#1f2a3d] px-3 py-3 text-sm leading-relaxed outline-none transition-colors duration-200 focus:border-[#4f7dff] focus-visible:ring-2 focus-visible:ring-[#4f7dff]/40"
            />
          </label>
        </form>
      </section>

      <section className="mt-6 rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-5 shadow-[0_14px_40px_rgba(0,0,0,0.35)]">
        {loading ? (
          <p className="text-sm text-[#8ba2c7]">正在加载任务列表...</p>
        ) : null}
        {error ? <p className="mb-3 text-sm text-[#ff9fba]">{error}</p> : null}

        {!loading && items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#2d3a52] bg-[#101a2c] p-6 text-center">
            <p className="text-sm text-[#9fb0d0]">
              暂无任务，先创建第一条任务吧。
            </p>
          </div>
        ) : null}

        {!loading && items.length > 0 ? (
          <div className="space-y-3">
            {items.map((task) => {
              const expanded = expandedTaskId === task.id;
              const completed = Boolean(task.completedDate);
              const priorityValue = normalizePriority(task.priority);
              return (
                <article
                  key={task.id}
                  className={`overflow-hidden rounded-2xl border transition-colors duration-200 ${
                    expanded
                      ? "border-[#4f7dff] bg-[#13213a]"
                      : "border-[#25344d] bg-[#101a2c] hover:border-[#395178] hover:bg-[#12203a]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedTaskId((current) =>
                        current === task.id ? null : task.id,
                      )
                    }
                    className="flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f7dff]/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-[#e5ecff]">
                        {task.title}
                      </p>
                      <p className="mt-1 text-xs text-[#8ba2c7]">
                        更新于 {task.updatedAt}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-1 text-xs font-semibold ${PRIORITY_CLASSNAME[priorityValue]}`}
                      >
                        {PRIORITY_LABEL[priorityValue]}
                      </span>
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          completed
                            ? "bg-[#173a29] text-[#9AF7C4]"
                            : "bg-[#1d355b] text-[#a7c5ff]"
                        }`}
                      >
                        {completed ? "已完成" : "进行中"}
                      </span>
                    </div>
                  </button>

                  <div
                    className={`grid transition-[grid-template-rows,opacity] duration-250 ease-out ${
                      expanded
                        ? "grid-rows-[1fr] opacity-100"
                        : "grid-rows-[0fr] opacity-0"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="border-t border-[#2d3a52] px-4 py-4">
                        <p className="whitespace-pre-wrap text-sm text-[#c7d5ef]">
                          {task.description?.trim() || "暂无描述"}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void handleToggleCompleted(task)}
                            className={`cursor-pointer rounded-full border px-4 py-2 text-xs font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f7dff]/50 disabled:cursor-not-allowed disabled:opacity-60 ${
                              completed
                                ? "border-[#2d3a52] text-[#c7d5ef] hover:bg-[#142033]"
                                : "border-[#4f7dff] text-[#cfe0ff] hover:bg-[#1a2f52]"
                            }`}
                          >
                            {completed ? "标记为未完成" : "标记为完成"}
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => setPendingDeleteTask(task)}
                            className="cursor-pointer rounded-full border border-[#ff6f91] px-4 py-2 text-xs font-semibold text-[#ff9fba] transition-colors duration-200 hover:bg-[#3a1220] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6f91]/40 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            删除任务
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}

        <div className="mt-5 flex items-center justify-between">
          <p className="text-xs text-[#8ba2c7]">
            第 {data?.page ?? page} / {totalPages} 页，共 {data?.total ?? 0} 条
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => {
                setPage((current) => Math.max(1, current - 1));
                setExpandedTaskId(null);
              }}
              className="cursor-pointer rounded-full border border-[#1f2a3d] px-4 py-2 text-xs font-semibold text-[#c7d5ef] transition-colors duration-200 hover:bg-[#142033] disabled:cursor-not-allowed disabled:opacity-50"
            >
              上一页
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => {
                setPage((current) => Math.min(totalPages, current + 1));
                setExpandedTaskId(null);
              }}
              className="cursor-pointer rounded-full border border-[#1f2a3d] px-4 py-2 text-xs font-semibold text-[#c7d5ef] transition-colors duration-200 hover:bg-[#142033] disabled:cursor-not-allowed disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        </div>
      </section>
      <ConfirmDialog
        open={pendingDeleteTask !== null}
        title="确认删除任务"
        description={`删除后将无法恢复：${pendingDeleteTask?.title ?? ""}`}
        confirmText="删除任务"
        loading={saving}
        onCancel={() => setPendingDeleteTask(null)}
        onConfirm={() => {
          if (!pendingDeleteTask) {
            return;
          }
          void handleDelete(pendingDeleteTask.id);
          setPendingDeleteTask(null);
        }}
      />
    </main>
  );
}
