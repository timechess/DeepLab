"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getRuntimeSetting,
  type RuntimeSettingDTO,
  type RuntimeSettingUpsertInput,
  updateRuntimeSetting,
} from "@/lib/settings";

function mapToInput(source: RuntimeSettingDTO): RuntimeSettingUpsertInput {
  return {
    provider: source.provider,
    baseUrl: source.baseUrl,
    apiKey: source.apiKey,
    modelName: source.modelName,
    ocrProvider: source.ocrProvider,
    ocrBaseUrl: source.ocrBaseUrl,
    ocrApiKey: source.ocrApiKey,
    ocrModel: source.ocrModel,
    thinkingLevel: source.thinkingLevel,
    temperature: source.temperature,
    paperFilterPrompt: source.paperFilterPrompt,
    paperReadingPrompt: source.paperReadingPrompt,
    workReportPrompt: source.workReportPrompt,
  };
}

export default function SettingPage() {
  const [data, setData] = useState<RuntimeSettingDTO | null>(null);
  const [input, setInput] = useState<RuntimeSettingUpsertInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSetting = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getRuntimeSetting();
      setData(response);
      setInput(mapToInput(response));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSetting();
  }, [loadSetting]);

  const defaultsAppliedText = useMemo(
    () =>
      data?.defaultsApplied.length ? data.defaultsApplied.join(", ") : "无",
    [data],
  );

  const updateField = useCallback(
    <K extends keyof RuntimeSettingUpsertInput>(
      key: K,
      value: RuntimeSettingUpsertInput[K],
    ) => {
      setInput((prev) => {
        if (!prev) {
          return prev;
        }
        return { ...prev, [key]: value };
      });
    },
    [],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!input) {
        return;
      }
      setSaving(true);
      setMessage(null);
      setError(null);
      try {
        const saved = await updateRuntimeSetting(input);
        setData(saved);
        setInput(mapToInput(saved));
        setMessage("设置已保存");
      } catch (saveError) {
        setError(
          saveError instanceof Error ? saveError.message : String(saveError),
        );
      } finally {
        setSaving(false);
      }
    },
    [input],
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-12">
      <header className="mb-10 flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-[0.15em] text-[#8ba2c7]">
            DeepLab / Setting
          </p>
          <h1 className="mt-3 font-serif text-5xl leading-[0.95] font-semibold text-[#e5ecff]">
            系统设置
          </h1>
          <p className="mt-3 text-sm text-[#9fb0d0]">
            默认提示词自动回填，便于直接编辑与覆盖。
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex rounded-full border border-[#1f2a3d] px-4 py-2 text-sm text-[#c7d5ef] transition-colors duration-200 hover:bg-[#142033]"
        >
          返回首页
        </Link>
      </header>

      {loading ? <p className="text-[#8ba2c7]">正在加载设置...</p> : null}
      {!loading && error ? (
        <section className="rounded-2xl border border-[#6e2a45] bg-[#2a1020] p-4 text-sm text-[#ff9fba]">
          {error}
        </section>
      ) : null}

      {!loading && input ? (
        <form className="space-y-6" onSubmit={handleSubmit}>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#1f2a3d] bg-[#0f1724] px-4 py-3">
            {message ? (
              <p className="rounded-xl border border-[#1f5f4a] bg-[#102920] px-3 py-2 text-sm text-[#8ef3cf]">
                {message}
              </p>
            ) : (
              <p className="text-sm text-[#8ba2c7]">修改后请先保存配置</p>
            )}
            <button
              type="submit"
              disabled={saving}
              className="cursor-pointer rounded-full bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-[#1D4ED8] disabled:opacity-60"
            >
              {saving ? "保存中..." : "保存设置"}
            </button>
          </section>

          <section className="rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-6">
            <h2 className="font-serif text-3xl font-semibold text-[#e5ecff]">
              模型配置
            </h2>
            <p className="mt-2 text-xs text-[#8ba2c7]">
              当前默认字段: {defaultsAppliedText}
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="text-sm text-[#c7d5ef]">
                Provider
                <select
                  className="mt-1 w-full rounded-xl border border-[#1f2a3d] px-3 py-2"
                  value={input.provider}
                  onChange={(e) => updateField("provider", e.target.value)}
                >
                  <option value="openai compatible">openai compatible</option>
                  <option value="google">google</option>
                </select>
              </label>
              <label className="text-sm text-[#c7d5ef]">
                Base URL
                <input
                  className="mt-1 w-full rounded-xl border border-[#1f2a3d] px-3 py-2"
                  value={input.baseUrl}
                  onChange={(e) => updateField("baseUrl", e.target.value)}
                />
              </label>
              <label className="text-sm text-[#c7d5ef]">
                API Key
                <input
                  type="password"
                  className="mt-1 w-full rounded-xl border border-[#1f2a3d] px-3 py-2"
                  value={input.apiKey}
                  onChange={(e) => updateField("apiKey", e.target.value)}
                />
              </label>
              <label className="text-sm text-[#c7d5ef]">
                Model Name
                <input
                  className="mt-1 w-full rounded-xl border border-[#1f2a3d] px-3 py-2"
                  value={input.modelName}
                  onChange={(e) => updateField("modelName", e.target.value)}
                />
              </label>
              <label className="text-sm text-[#c7d5ef]">
                Thinking Level
                <select
                  className="mt-1 w-full rounded-xl border border-[#1f2a3d] px-3 py-2"
                  value={input.thinkingLevel}
                  onChange={(e) => updateField("thinkingLevel", e.target.value)}
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </label>
              <label className="text-sm text-[#c7d5ef]">
                Temperature
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  className="mt-1 w-full rounded-xl border border-[#1f2a3d] px-3 py-2"
                  value={input.temperature}
                  onChange={(e) =>
                    updateField(
                      "temperature",
                      Number.parseFloat(e.target.value || "0"),
                    )
                  }
                />
              </label>
            </div>
          </section>

          <section className="rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-6">
            <h2 className="font-serif text-3xl font-semibold text-[#e5ecff]">
              OCR配置
            </h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="text-sm text-[#c7d5ef]">
                OCR Provider
                <input
                  className="mt-1 w-full rounded-xl border border-[#1f2a3d] px-3 py-2"
                  value={input.ocrProvider}
                  onChange={(e) => updateField("ocrProvider", e.target.value)}
                />
              </label>
              <label className="text-sm text-[#c7d5ef]">
                OCR Base URL
                <input
                  className="mt-1 w-full rounded-xl border border-[#1f2a3d] px-3 py-2"
                  value={input.ocrBaseUrl}
                  onChange={(e) => updateField("ocrBaseUrl", e.target.value)}
                />
              </label>
              <label className="text-sm text-[#c7d5ef]">
                OCR API Key
                <input
                  type="password"
                  className="mt-1 w-full rounded-xl border border-[#1f2a3d] px-3 py-2"
                  value={input.ocrApiKey}
                  onChange={(e) => updateField("ocrApiKey", e.target.value)}
                />
              </label>
              <label className="text-sm text-[#c7d5ef]">
                OCR Model
                <input
                  className="mt-1 w-full rounded-xl border border-[#1f2a3d] px-3 py-2"
                  value={input.ocrModel}
                  onChange={(e) => updateField("ocrModel", e.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-6">
            <h2 className="font-serif text-3xl font-semibold text-[#e5ecff]">
              默认提示词模板
            </h2>
            <div className="mt-3 rounded-2xl border border-[#2d3a52] bg-[#142033] p-4">
              <p className="text-xs font-semibold tracking-wide text-[#9fc1ff]">
                默认模板说明
              </p>
              <p className="mt-2 text-xs text-[#9fc1ff]/90">
                这里展示并编辑的是各工作流默认提示词模板。若你覆盖模板，请保留变量名不变，系统会在运行时注入对应内容。
              </p>
            </div>
            <div className="mt-4 space-y-4">
              <label className="block text-sm text-[#c7d5ef]">
                Paper Filter Prompt
                <div className="mt-2 rounded-xl border border-[#2d3a52] bg-[#142033] p-3">
                  <p className="text-xs font-semibold tracking-wide text-[#9fc1ff]">
                    可用变量
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <code className="rounded-full bg-[#0f1724] px-3 py-1 text-xs text-[#9fc1ff]">
                      {"{{CANDIDATES_PAPER}}"}
                    </code>
                    <code className="rounded-full bg-[#0f1724] px-3 py-1 text-xs text-[#9fc1ff]">
                      {"{{RULE_LIST}}"}
                    </code>
                  </div>
                </div>
                <textarea
                  rows={10}
                  className="mt-1 w-full rounded-xl border border-[#1f2a3d] px-3 py-2"
                  value={input.paperFilterPrompt}
                  onChange={(e) =>
                    updateField("paperFilterPrompt", e.target.value)
                  }
                />
              </label>
              <label className="block text-sm text-[#c7d5ef]">
                Paper Reading Prompt
                <div className="mt-2 rounded-xl border border-[#2d3a52] bg-[#142033] p-3">
                  <p className="text-xs font-semibold tracking-wide text-[#9fc1ff]">
                    可用变量
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <code className="rounded-full bg-[#0f1724] px-3 py-1 text-xs text-[#9fc1ff]">
                      {"{{PAPER_ID}}"}
                    </code>
                    <code className="rounded-full bg-[#0f1724] px-3 py-1 text-xs text-[#9fc1ff]">
                      {"{{PAPER_TITLE}}"}
                    </code>
                    <code className="rounded-full bg-[#0f1724] px-3 py-1 text-xs text-[#9fc1ff]">
                      {"{{PAPER_OCR_TEXT}}"}
                    </code>
                  </div>
                </div>
                <textarea
                  rows={6}
                  className="mt-1 w-full rounded-xl border border-[#1f2a3d] px-3 py-2"
                  value={input.paperReadingPrompt}
                  onChange={(e) =>
                    updateField("paperReadingPrompt", e.target.value)
                  }
                />
              </label>
              <label className="block text-sm text-[#c7d5ef]">
                Work Report Prompt
                <div className="mt-2 rounded-xl border border-[#2d3a52] bg-[#142033] p-3">
                  <p className="text-xs font-semibold tracking-wide text-[#9fc1ff]">
                    可用变量
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <code className="rounded-full bg-[#0f1724] px-3 py-1 text-xs text-[#9fc1ff]">
                      {"{{BUSINESS_DATE}}"}
                    </code>
                    <code className="rounded-full bg-[#0f1724] px-3 py-1 text-xs text-[#9fc1ff]">
                      {"{{SOURCE_DATE}}"}
                    </code>
                    <code className="rounded-full bg-[#0f1724] px-3 py-1 text-xs text-[#9fc1ff]">
                      {"{{ACTIVITY_MARKDOWN}}"}
                    </code>
                  </div>
                </div>
                <textarea
                  rows={6}
                  className="mt-1 w-full rounded-xl border border-[#1f2a3d] px-3 py-2"
                  value={input.workReportPrompt}
                  onChange={(e) =>
                    updateField("workReportPrompt", e.target.value)
                  }
                />
              </label>
            </div>
          </section>
        </form>
      ) : null}
    </main>
  );
}
