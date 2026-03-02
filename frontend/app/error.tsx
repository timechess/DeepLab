'use client';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="page">
      <div className="panel danger-panel">
        <h2 className="panel-title">页面加载失败</h2>
        <p className="page-subtitle">{error.message}</p>
        <button className="button button-primary" onClick={reset} type="button">
          重试
        </button>
      </div>
    </section>
  );
}
