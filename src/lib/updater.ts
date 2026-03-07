"use client";

import { confirm, message } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";

export interface CheckForUpdateOptions {
  silent?: boolean;
}

export type CheckForUpdateResult =
  | {
      status: "up-to-date";
    }
  | {
      status: "available";
      version: string;
    }
  | {
      status: "downloaded";
      version: string;
    };

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as Window & { __TAURI_INTERNALS__?: unknown })
  );
}

export async function checkForAppUpdate(
  options: CheckForUpdateOptions = {},
): Promise<CheckForUpdateResult> {
  const { silent = false } = options;

  if (!isTauriRuntime()) {
    return { status: "up-to-date" };
  }

  const update = await check();
  if (!update) {
    if (!silent) {
      await message("当前已是最新版本。", { title: "检查更新" });
    }
    return { status: "up-to-date" };
  }

  const shouldInstall = await confirm(
    `发现新版本 ${update.version}，是否立即下载并安装？`,
    {
      title: "发现更新",
      kind: "info",
      okLabel: "下载并安装",
      cancelLabel: "稍后再说",
    },
  );

  if (!shouldInstall) {
    if (!silent) {
      await message(`检测到新版本 ${update.version}，你可以稍后再安装。`, {
        title: "检查更新",
      });
    }
    return { status: "available", version: update.version };
  }

  await update.downloadAndInstall();
  await message("更新已下载完成，请重启应用以完成更新。", {
    title: "更新已就绪",
    kind: "info",
  });
  return { status: "downloaded", version: update.version };
}
