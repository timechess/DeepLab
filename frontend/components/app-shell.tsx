'use client';

import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: '首页总览' },
  { href: '/knowledge', label: '知识库' },
  { href: '/ops/workflows', label: '工作流' },
  { href: '/ops/rules', label: '筛选规则' },
  { href: '/ops/reports', label: '报告管理' },
  { href: '/ops/read-by-id', label: '报告生成' },
  { href: '/ops/settings', label: '系统设置' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStandaloneEditorRoute =
    pathname === '/knowledge/notes/new' || /^\/knowledge\/notes\/[^/]+\/edit$/.test(pathname);

  if (isStandaloneEditorRoute) {
    return <main className="content-wrap content-wrap-fullscreen">{children}</main>;
  }

  return (
    <div className="app-frame">
      <header className="topbar">
        <div className="brand-block">
          <p className="brand-eyebrow">DeepLab 轨道控制界面</p>
          <h1 className="brand-title">论文工作流控制台</h1>
        </div>
        <nav className="nav-strip" aria-label="主导航">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === '/'
                ? pathname === '/'
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <a
                key={item.href}
                className={`nav-pill${isActive ? ' nav-pill-active' : ''}`}
                href={item.href}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      </header>
      <main className="content-wrap">{children}</main>
    </div>
  );
}
