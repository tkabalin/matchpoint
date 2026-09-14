import { useEffect, useRef, useState } from "react";

/** Defers an expensive per-row fetch (a stats call, a full point log) until the
 *  element scrolls into view — a list can hold any number of rows, and a row
 *  only asks for its own data once it's actually reached, rather than every
 *  row firing on mount. Shared by the Players tab's roster card and the
 *  Matches tab's match card. */
export function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || inView) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setInView(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView]);

  return { ref, inView };
}
