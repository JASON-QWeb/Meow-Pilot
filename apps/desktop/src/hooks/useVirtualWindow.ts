import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

export type VirtualWindowItem<T> = {
  item: T;
  index: number;
};

type VirtualWindowOptions = {
  estimateItemHeight: number;
  overscan?: number;
  enabled?: boolean;
};

export function useVirtualWindow<T>(items: T[], options: VirtualWindowOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const enabled = options.enabled ?? true;
  const overscan = options.overscan ?? 6;

  const onScroll = useCallback(() => {
    setScrollTop(containerRef.current?.scrollTop ?? 0);
  }, []);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setViewportHeight(element.clientHeight);
    update();
    const observer = "ResizeObserver" in window ? new ResizeObserver(update) : null;
    observer?.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return useMemo(() => {
    if (!enabled) {
      return {
        containerRef,
        enabled: false,
        items: items.map((item, index) => ({ item, index })),
        totalHeight: 0,
        offsetY: 0,
        onScroll,
      };
    }

    const start = Math.max(0, Math.floor(scrollTop / options.estimateItemHeight) - overscan);
    const visibleCount = Math.ceil((viewportHeight || options.estimateItemHeight * 8) / options.estimateItemHeight) + overscan * 2;
    const end = Math.min(items.length, start + visibleCount);
    return {
      containerRef,
      enabled: true,
      items: items.slice(start, end).map((item, index) => ({ item, index: start + index })),
      totalHeight: items.length * options.estimateItemHeight,
      offsetY: start * options.estimateItemHeight,
      onScroll,
    };
  }, [enabled, items, onScroll, options.estimateItemHeight, overscan, scrollTop, viewportHeight]);
}
