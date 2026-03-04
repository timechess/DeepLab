import { SettingsManager } from '@/components/ops/settings-manager';
import { getRuntimeSettings } from '@/lib/api/client';

export default async function OpsSettingsPage() {
  const settings = await getRuntimeSettings();

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h2 className="page-title">系统设置</h2>
        </div>
      </header>

      <SettingsManager initialSettings={settings} />
    </section>
  );
}
