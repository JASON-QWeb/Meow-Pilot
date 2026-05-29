import { useEffect, useState } from "react";

export function usePersistentState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return fallback;

    const stored = window.localStorage.getItem(key);
    if (!stored) return fallback;

    try {
      return JSON.parse(stored) as T;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== key || event.newValue === null) return;
      try {
        setValue(JSON.parse(event.newValue) as T);
      } catch {
        setValue(fallback);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [fallback, key]);

  return [value, setValue] as const;
}
