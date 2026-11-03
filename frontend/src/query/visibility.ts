"use client";
import { useEffect, useState } from "react";
export function usePageVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState === "visible");
    changed();
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  return visible;
}
