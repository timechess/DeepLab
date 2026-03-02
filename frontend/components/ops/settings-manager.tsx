'use client';

import { useEffect, useMemo, useState } from 'react';

import type { RuntimeSetting } from '@/lib/api/schemas';
import { formatDateTime } from '@/lib/time';

type SectionKey = 'provider' | 'inference' | 'prompt';

type SectionConfig = {
  key: SectionKey;
  title: string;
  subtitle: string;
  description: string;
  settingKeys: string[];
};

type EmbeddingDownloadStatus = {
  modelName: string;
  downloaded: boolean;
  downloading: boolean;
  progress: number;
  message: string;
  error: string | null;
  updatedAt: string;
};

const SECTION_CONFIGS: SectionConfig[] = [
  {
    key: 'provider',
    title: 'Provider 配置',
    subtitle: '模型与 OCR 连接参数',
    description: '配置 provider、LLM 连接参数以及 Mistral OCR 的 API 设置。',
    settingKeys: [
      'llm_provider',
      'google_api_key',
      'google_base_url',
      'google_model',
      'openai_api_key',
      'openai_base_url',
      'openai_model',
      'mistral_api_key',
      'mistral_base_url',
      'mistral_ocr_model',
    ],
  },
  {
    key: 'inference',
    title: '推理设置',
    subtitle: '推理行为与温度参数',
    description: '配置 thinking level 与各阶段 temperature。',
    settingKeys: [
      'google_thinking_level',
      'initial_screening_temperature',
      'reading_stage1_temperature',
      'reading_stage2_temperature',
    ],
  },
  {
    key: 'prompt',
    title: 'Prompt 配置',
    subtitle: '初筛、精读与知识库提示词模板',
    description: '集中维护初筛、精读和知识库提炼阶段 prompt，保存后立即生效。',
    settingKeys: [
      'initial_screening_system_prompt',
      'initial_screening_user_prompt_template',
      'reading_stage1_system_prompt',
      'reading_stage1_user_prompt_template',
      'reading_stage2_system_prompt',
      'reading_stage2_user_prompt_template',
      'knowledge_candidate_system_prompt',
      'knowledge_candidate_user_prompt_template',
      'knowledge_final_system_prompt',
      'knowledge_final_user_prompt_template',
    ],
  },
];

function sourceLabel(source: RuntimeSetting['source']): string {
  if (source === 'database') {
    return '数据库';
  }
  if (source === 'default') {
    return '默认值';
  }
  return '未设置';
}

function settingByKey(settings: RuntimeSetting[]): Record<string, RuntimeSetting> {
  return Object.fromEntries(settings.map((item) => [item.key, item]));
}

function initialDrafts(
  section: SectionConfig,
  byKey: Record<string, RuntimeSetting>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of section.settingKeys) {
    const item = byKey[key];
    result[key] = item?.value ?? '';
  }
  return result;
}

function parseErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '请求失败，请稍后重试。';
  }
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === 'string' && detail.trim()) {
    return detail;
  }
  return '请求失败，请稍后重试。';
}

async function fetchRuntimeSettingsClient(): Promise<RuntimeSetting[]> {
  const response = await fetch('/api/backend/runtime_settings', {
    method: 'GET',
    cache: 'no-store',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(parseErrorMessage(payload));
  }
  return (await response.json()) as RuntimeSetting[];
}

async function saveRuntimeSetting(key: string, value: string): Promise<void> {
  const response = await fetch(`/api/backend/runtime_settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(parseErrorMessage(payload));
  }
}

async function fetchEmbeddingDownloadStatusClient(): Promise<EmbeddingDownloadStatus> {
  const response = await fetch('/api/backend/knowledge/embedding/status', {
    method: 'GET',
    cache: 'no-store',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(parseErrorMessage(payload));
  }
  return (await response.json()) as EmbeddingDownloadStatus;
}

async function triggerEmbeddingDownloadClient(): Promise<EmbeddingDownloadStatus> {
  const response = await fetch('/api/backend/knowledge/embedding/download', {
    method: 'POST',
    cache: 'no-store',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(parseErrorMessage(payload));
  }
  return (await response.json()) as EmbeddingDownloadStatus;
}

export function SettingsManager({
  initialSettings,
}: {
  initialSettings: RuntimeSetting[];
}) {
  const initialByKey = settingByKey(initialSettings);
  const initialEmbeddingModelDraft = initialByKey.knowledge_embedding_model?.value ?? '';

  const [settings, setSettings] = useState<RuntimeSetting[]>(initialSettings);
  const [activeSectionKey, setActiveSectionKey] = useState<SectionKey | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingDownloadStatus | null>(null);
  const [embeddingError, setEmbeddingError] = useState<string | null>(null);
  const [embeddingLoading, setEmbeddingLoading] = useState(false);
  const [embeddingModelDraft, setEmbeddingModelDraft] = useState(initialEmbeddingModelDraft);
  const [embeddingModelSaving, setEmbeddingModelSaving] = useState(false);

  const byKey = useMemo(() => settingByKey(settings), [settings]);
  const embeddingModelSetting = byKey.knowledge_embedding_model;
  const activeSection =
    activeSectionKey === null
      ? null
      : SECTION_CONFIGS.find((item) => item.key === activeSectionKey) || null;

  useEffect(() => {
    setEmbeddingModelDraft(embeddingModelSetting?.value ?? '');
  }, [embeddingModelSetting?.value]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const latest = await fetchEmbeddingDownloadStatusClient();
        if (!cancelled) {
          setEmbeddingStatus(latest);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : '获取 embedding 状态失败。';
          setEmbeddingError(message);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!embeddingStatus?.downloading) {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const latest = await fetchEmbeddingDownloadStatusClient();
        setEmbeddingStatus(latest);
      } catch (err) {
        const message = err instanceof Error ? err.message : '刷新 embedding 状态失败。';
        setEmbeddingError(message);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [embeddingStatus?.downloading]);

  const openSection = (section: SectionConfig) => {
    setActiveSectionKey(section.key);
    setDrafts(initialDrafts(section, byKey));
    setNotice(null);
    setError(null);
  };

  const closeSection = () => {
    if (saving) {
      return;
    }
    setActiveSectionKey(null);
    setDrafts({});
  };

  const saveSection = async () => {
    if (!activeSection) {
      return;
    }

    setSaving(true);
    setNotice(null);
    setError(null);

    try {
      for (const key of activeSection.settingKeys) {
        await saveRuntimeSetting(key, drafts[key] ?? '');
      }
      const latest = await fetchRuntimeSettingsClient();
      setSettings(latest);
      setNotice(`${activeSection.title}已保存`);
      setActiveSectionKey(null);
      setDrafts({});
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存失败，请稍后重试。';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const saveEmbeddingModel = async () => {
    setEmbeddingModelSaving(true);
    setEmbeddingError(null);
    setNotice(null);
    setError(null);
    try {
      await saveRuntimeSetting('knowledge_embedding_model', embeddingModelDraft);
      const [latestSettings, latestEmbeddingStatus] = await Promise.all([
        fetchRuntimeSettingsClient(),
        fetchEmbeddingDownloadStatusClient(),
      ]);
      setSettings(latestSettings);
      setEmbeddingStatus(latestEmbeddingStatus);
      setNotice('embedding 模型配置已保存。');
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存 embedding 模型失败。';
      setEmbeddingError(message);
    } finally {
      setEmbeddingModelSaving(false);
    }
  };

  const triggerEmbeddingDownload = async () => {
    setEmbeddingLoading(true);
    setEmbeddingError(null);
    setNotice(null);
    setError(null);
    try {
      const latest = await triggerEmbeddingDownloadClient();
      setEmbeddingStatus(latest);
      setNotice('已触发 embedding 模型下载任务。');
    } catch (err) {
      const message = err instanceof Error ? err.message : '触发 embedding 下载失败。';
      setEmbeddingError(message);
    } finally {
      setEmbeddingLoading(false);
    }
  };

  return (
    <>
      {notice ? <p className="notice">{notice}</p> : null}
      {error ? <p className="notice notice-error">{error}</p> : null}
      {embeddingError ? <p className="notice notice-error">{embeddingError}</p> : null}

      <section className="panel" style={{ display: 'grid', gap: 12 }}>
        <p className="panel-kicker">Embedding Model</p>
        <h3 className="panel-title">本地向量模型下载管理</h3>
        <p className="page-subtitle">
          知识提炼前必须先下载本地 embedding 模型。下载状态会实时刷新。
        </p>
        <p className="page-subtitle">
          模型名称来自运行时配置 <code>knowledge_embedding_model</code>，可填写 fastembed 支持的模型名。
        </p>
        <article className="panel-list-item">
          <p className="panel-kicker">{embeddingModelSetting?.label || 'Knowledge Embedding Model'}</p>
          <h4 className="panel-title" style={{ margin: 0, fontSize: 18 }}>
            knowledge_embedding_model
          </h4>
          <p className="page-subtitle" style={{ marginTop: 6 }}>
            {embeddingModelSetting?.description || '知识库向量化模型名称。'}
          </p>
          <p className="page-subtitle" style={{ marginTop: 6 }}>
            来源：{sourceLabel(embeddingModelSetting?.source || 'unset')} · 更新时间：
            {embeddingModelSetting?.updatedAt ? formatDateTime(embeddingModelSetting.updatedAt) : '--'}
          </p>
          <input
            disabled={embeddingLoading || embeddingModelSaving || embeddingStatus?.downloading === true}
            name="knowledge_embedding_model"
            onChange={(event) => setEmbeddingModelDraft(event.target.value)}
            type="text"
            value={embeddingModelDraft}
          />
          <div className="toolbar" style={{ marginTop: 10 }}>
            <button
              className="button button-secondary"
              disabled={
                embeddingLoading || embeddingModelSaving || embeddingStatus?.downloading === true
              }
              onClick={saveEmbeddingModel}
              type="button"
            >
              {embeddingModelSaving ? '保存中...' : '保存模型配置'}
            </button>
          </div>
        </article>
        <div className="meta-kv-grid">
          <div className="meta-kv">
            <span>模型名称</span>
            <strong>{embeddingStatus?.modelName || '--'}</strong>
          </div>
          <div className="meta-kv">
            <span>下载状态</span>
            <strong>
              {embeddingStatus?.downloaded
                ? '已下载'
                : embeddingStatus?.downloading
                  ? '下载中'
                  : '未下载'}
            </strong>
          </div>
          <div className="meta-kv">
            <span>进度</span>
            <strong>{embeddingStatus ? `${embeddingStatus.progress}%` : '--'}</strong>
          </div>
          <div className="meta-kv">
            <span>最近刷新</span>
            <strong>
              {embeddingStatus?.updatedAt ? formatDateTime(embeddingStatus.updatedAt) : '--'}
            </strong>
          </div>
        </div>

        <div
          style={{
            height: 10,
            borderRadius: 999,
            border: '1px solid rgba(103, 183, 213, 0.42)',
            background: 'rgba(8, 18, 30, 0.9)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.max(0, Math.min(embeddingStatus?.progress ?? 0, 100))}%`,
              height: '100%',
              background: 'linear-gradient(90deg, rgba(53, 214, 255, 0.95), rgba(87, 242, 184, 0.9))',
              transition: 'width 280ms ease',
            }}
          />
        </div>

        <p className="page-subtitle">{embeddingStatus?.message || '等待状态加载...'}</p>
        {embeddingStatus?.error ? <p className="notice notice-error">{embeddingStatus.error}</p> : null}

        <div className="toolbar">
          <button
            className="button button-primary"
            disabled={
              embeddingLoading ||
              embeddingModelSaving ||
              embeddingStatus?.downloading === true ||
              embeddingStatus?.downloaded === true
            }
            onClick={triggerEmbeddingDownload}
            type="button"
          >
            {embeddingStatus?.downloaded
              ? '模型已就绪'
              : embeddingStatus?.downloading
                ? '下载中...'
                : embeddingLoading
                  ? '处理中...'
                  : '下载 embedding 模型'}
          </button>
        </div>
      </section>

      <section className="panel" style={{ display: 'grid', gap: 12 }}>
        <p className="panel-kicker">Runtime Settings</p>
        <h3 className="panel-title">配置分组</h3>
        <div style={{ display: 'grid', gap: 12 }}>
          {SECTION_CONFIGS.map((section) => (
            <article className="panel-list-item" key={section.key}>
              <p className="panel-kicker" style={{ marginBottom: 6 }}>
                {section.subtitle}
              </p>
              <h4 className="panel-title" style={{ margin: 0, fontSize: 22 }}>
                {section.title}
              </h4>
              <p className="page-subtitle" style={{ marginTop: 8 }}>
                {section.description}
              </p>
              <p className="page-subtitle" style={{ marginTop: 8 }}>
                含 {section.settingKeys.length} 项配置。
              </p>
              <div className="toolbar" style={{ marginTop: 12 }}>
                <button
                  className="button button-secondary"
                  onClick={() => openSection(section)}
                  type="button"
                >
                  编辑并保存
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {activeSection ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(4, 10, 18, 0.72)',
            backdropFilter: 'blur(2px)',
            zIndex: 100,
            display: 'grid',
            placeItems: 'center',
            padding: 16,
          }}
        >
          <section
            className="panel"
            style={{
              width: 'min(1100px, 100%)',
              maxHeight: '88vh',
              overflow: 'auto',
              display: 'grid',
              gap: 14,
            }}
          >
            <header className="page-header">
              <div>
                <h3 className="page-title" style={{ fontSize: 32 }}>
                  {activeSection.title}
                </h3>
                <p className="page-subtitle">{activeSection.description}</p>
              </div>
            </header>

            <div style={{ display: 'grid', gap: 12 }}>
              {activeSection.settingKeys.map((key) => {
                const setting = byKey[key];
                if (!setting) {
                  return null;
                }

                const value = drafts[key] ?? '';
                const isPrompt = key.includes('prompt');
                const isProvider = key === 'llm_provider';
                const isTemperature = key.endsWith('_temperature');

                return (
                  <article className="panel-list-item" key={key}>
                    <p className="panel-kicker">{setting.label}</p>
                    <h4 className="panel-title" style={{ margin: 0, fontSize: 18 }}>
                      {setting.key}
                    </h4>
                    <p className="page-subtitle" style={{ marginTop: 6 }}>
                      {setting.description}
                    </p>
                    <p className="page-subtitle" style={{ marginTop: 6 }}>
                      来源：{sourceLabel(setting.source)} · 更新时间：
                      {setting.updatedAt ? formatDateTime(setting.updatedAt) : '--'}
                    </p>

                    {isProvider ? (
                      <select
                        disabled={saving}
                        name={key}
                        onChange={(event) => {
                          const next = event.target.value;
                          setDrafts((prev) => ({ ...prev, [key]: next }));
                        }}
                        value={value || 'google-genai'}
                      >
                        <option value="google-genai">google-genai</option>
                        <option value="openai-compatible">openai-compatible</option>
                      </select>
                    ) : isPrompt ? (
                      <textarea
                        disabled={saving}
                        name={key}
                        onChange={(event) => {
                          const next = event.target.value;
                          setDrafts((prev) => ({ ...prev, [key]: next }));
                        }}
                        rows={14}
                        style={{ fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace' }}
                        value={value}
                      />
                    ) : (
                      <input
                        disabled={saving}
                        name={key}
                        onChange={(event) => {
                          const next = event.target.value;
                          setDrafts((prev) => ({ ...prev, [key]: next }));
                        }}
                        step={isTemperature ? '0.1' : undefined}
                        type={isTemperature ? 'number' : setting.isSecret ? 'password' : 'text'}
                        value={value}
                      />
                    )}
                  </article>
                );
              })}
            </div>

            <div className="toolbar" style={{ justifyContent: 'flex-end', gap: 10 }}>
              <button className="button button-secondary" disabled={saving} onClick={closeSection} type="button">
                取消
              </button>
              <button className="button button-primary" disabled={saving} onClick={saveSection} type="button">
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
