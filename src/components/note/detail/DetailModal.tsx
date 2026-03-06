import { cjk } from "@streamdown/cjk";
import { createCodePlugin } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { createMermaidPlugin } from "@streamdown/mermaid";
import { useMemo } from "react";
import { Streamdown } from "streamdown";
import type { PaperReportDetail } from "@/lib/paperReport";
import type { ModalState } from "./types";

interface DetailModalProps {
  modal: ModalState;
  paperTab: "rendered" | "source";
  paperDetail: PaperReportDetail | null;
  onClose: () => void;
  onChangePaperTab: (tab: "rendered" | "source") => void;
}

export function DetailModal({
  modal,
  paperTab,
  paperDetail,
  onClose,
  onChangePaperTab,
}: DetailModalProps) {
  const paperPlugins = useMemo(
    () => ({
      cjk,
      code: createCodePlugin({ themes: ["github-light", "github-dark"] }),
      math: createMathPlugin({ singleDollarTextMath: true }),
      mermaid: createMermaidPlugin({ config: { theme: "dark" } }),
    }),
    [],
  );

  if (!modal) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[72vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#1f2a3d] bg-[#0f1724]">
        <div className="flex items-center justify-between border-b border-[#1f2a3d] px-4 py-3">
          <p className="text-sm font-semibold text-[#e5ecff]">
            {modal.type === "paper" ? "论文精读报告" : "任务详情"}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-full border border-[#2d3a52] px-3 py-1 text-xs text-[#c7d5ef]"
          >
            关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {modal.type === "task" ? (
            <div className="space-y-3 text-sm text-[#dbe6ff]">
              <p className="text-xl font-semibold text-[#e5ecff]">
                {modal.task.title}
              </p>
              <p>优先级：{modal.task.priority}</p>
              <p>状态：{modal.task.completedDate ? "已完成" : "未完成"}</p>
              <p className="whitespace-pre-wrap">
                {modal.task.description || "无描述"}
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => onChangePaperTab("rendered")}
                  className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${
                    paperTab === "rendered"
                      ? "border-[#4f7dff] bg-[#4f7dff] text-white"
                      : "border-[#2d3a52] text-[#c7d5ef]"
                  }`}
                >
                  渲染视图
                </button>
                <button
                  type="button"
                  onClick={() => onChangePaperTab("source")}
                  className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${
                    paperTab === "source"
                      ? "border-[#4f7dff] bg-[#4f7dff] text-white"
                      : "border-[#2d3a52] text-[#c7d5ef]"
                  }`}
                >
                  Markdown 源码
                </button>
              </div>

              {paperTab === "rendered" ? (
                <div className="report-markdown">
                  {paperDetail?.report ? (
                    <Streamdown plugins={paperPlugins}>
                      {paperDetail.report}
                    </Streamdown>
                  ) : (
                    <p className="text-sm text-[#8ba2c7]">暂无报告内容。</p>
                  )}
                </div>
              ) : (
                <pre className="whitespace-pre-wrap rounded-xl border border-[#1f2a3d] bg-[#0b1422] p-3 text-xs text-[#dbe6ff]">
                  {paperDetail?.report ?? "暂无报告内容。"}
                </pre>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
