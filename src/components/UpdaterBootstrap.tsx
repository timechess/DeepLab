"use client";

import { useEffect } from "react";
import { checkForAppUpdate } from "@/lib/updater";

export function UpdaterBootstrap() {
  useEffect(() => {
    void (async () => {
      try {
        await checkForAppUpdate({ silent: true });
      } catch {
        // no-op: startup auto check should not block app usage
      }
    })();
  }, []);

  return null;
}
