"use client";

import { usePathname } from "next/navigation";
import { AppNav } from "@/components/AppNav";

export function LayoutChrome() {
  const pathname = usePathname();
  if (pathname === "/note/detail") {
    return null;
  }
  return <AppNav />;
}
