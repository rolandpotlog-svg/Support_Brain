"use client";
import { useEffect, useRef, useState } from "react";

// Motivations-Ticker: zählt den Gesamtumsatz beim Laden animiert hoch.
export function RevenueTicker({ cents, label }: { cents: number; label: string }) {
  const [val, setVal] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const target = cents;
    const dur = 1300;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * eased));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [cents]);

  return (
    <div className="revticker">
      <span className="revticker-dot" />
      <span className="revticker-l">{label}</span>
      <span className="revticker-v">{(val / 100).toLocaleString("de-DE", { maximumFractionDigits: 0 })} €</span>
    </div>
  );
}
