import { SettingsManager } from '@/components/ops/settings-manager';
import { getRuntimeSettings } from '@/lib/api/client';

export default async function OpsSettingsPage() {
  const settings = await getRuntimeSettings();

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 className="page-title">运营后台 · 系统设置</h2>
          <p className="page-subtitle">
            配置已拆分为 Provider、推理设置、Prompt 三个分块，使用弹出框统一编辑并保存。
          </p>
        </div>
      </header>

      <SettingsManager initialSettings={settings} />
    </section>
  );
}
