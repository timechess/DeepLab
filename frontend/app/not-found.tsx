import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="page">
      <div className="panel">
        <h2 className="panel-title">未找到资源</h2>
        <p className="page-subtitle">请确认编号是否正确，或返回首页查看最新数据。</p>
        <Link className="button button-primary" href="/">
          返回首页
        </Link>
      </div>
    </section>
  );
}
