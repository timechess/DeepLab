import type { Metadata } from 'next';

import { AppShell } from '@/components/app-shell';

import 'katex/dist/katex.min.css';
import 'streamdown/styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'DeepLab 前端控制台',
  description: 'DeepLab 工作流与报告运营控制台',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
