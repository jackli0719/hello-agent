"use client";

// 刷新全部 iframe 按钮 — 演示者用
import { useCallback } from "react";

export function RefreshAllButton() {
  const handleRefresh = useCallback(() => {
    const iframes = document.querySelectorAll<HTMLIFrameElement>(
      "iframe[data-demo-frame]",
    );
    iframes.forEach((f) => {
      if (f.contentWindow) f.contentWindow.location.reload();
    });
  }, []);

  return (
    <button
      type="button"
      onClick={handleRefresh}
      style={{
        padding: "6px 12px",
        background: "#fff",
        color: "#374151",
        border: "1px solid #d1d5db",
        borderRadius: 6,
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      🔄 刷新全部
    </button>
  );
}
