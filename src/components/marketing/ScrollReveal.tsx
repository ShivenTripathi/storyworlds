"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/**
 * Fades + rises a section into place as it enters the viewport.
 *
 * The `prefers-reduced-motion: reduce` baseline is enforced in CSS
 * (`.landing-reveal` in marketing.css forces full opacity, no transform, no
 * transition under that media query) so this component never needs to branch
 * on it — it only ever has to flip `visible` once the element scrolls into
 * view, and the reduced-motion CSS silently makes that a no-op visually.
 */
export function ScrollReveal({
  children,
  className = "",
  delayMs = 0,
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const style: CSSProperties | undefined = delayMs
    ? { transitionDelay: `${delayMs}ms` }
    : undefined;

  return (
    <div
      ref={ref}
      className={`landing-reveal ${visible ? "landing-reveal--visible" : ""} ${className}`.trim()}
      style={style}
    >
      {children}
    </div>
  );
}
