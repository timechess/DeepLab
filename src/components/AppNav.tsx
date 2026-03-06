"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const PRIMARY_NAV_ITEMS = [
  { href: "/", label: "今日推荐" },
  { href: "/note", label: "双链笔记" },
  { href: "/paper_report", label: "论文精读" },
  { href: "/work_report", label: "工作日报" },
  { href: "/task", label: "任务清单" },
];

const MORE_NAV_ITEMS = [
  { href: "/workflow", label: "工作流管理" },
  { href: "/rule", label: "筛选规则" },
  { href: "/setting", label: "系统设置" },
] as const;

export function AppNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-50 border-b border-[#1f2a3d] bg-[#0b1422]/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-6 py-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.22em] text-[#8ba2c7]">
            DeepLab
          </p>
          <h1 className="font-serif text-3xl font-semibold text-[#e5ecff]">
            AI Research Workspace
          </h1>
        </div>
        <nav aria-label="Primary" className="flex flex-wrap items-center gap-2">
          {PRIMARY_NAV_ITEMS.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-full border px-5 py-3 text-sm font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f7dff] ${
                  active
                    ? "border-[#4f7dff] bg-[#4f7dff] text-white"
                    : "border-[#2d3a52] text-[#c7d5ef] hover:border-[#4f7dff] hover:bg-[#142033]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className={`cursor-pointer rounded-full border px-5 py-3 text-sm font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f7dff] ${
                open
                  ? "border-[#4f7dff] bg-[#142033] text-[#e5ecff]"
                  : "border-[#2d3a52] text-[#c7d5ef] hover:border-[#4f7dff] hover:bg-[#142033]"
              }`}
            >
              更多
            </button>
            {open ? (
              <div className="absolute top-[calc(100%+8px)] right-0 w-44 rounded-2xl border border-[#2d3a52] bg-[#0f1724] p-2 shadow-[0_16px_30px_rgba(0,0,0,0.45)]">
                {MORE_NAV_ITEMS.map((item) => {
                  const active =
                    pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`block cursor-pointer rounded-xl px-3 py-2 text-sm font-semibold transition-colors duration-200 ${
                        active
                          ? "bg-[#4f7dff] text-white"
                          : "text-[#c7d5ef] hover:bg-[#142033]"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        </nav>
      </div>
    </header>
  );
}
