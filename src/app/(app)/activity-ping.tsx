"use client";
// Zählt nur echte Arbeit: Tab sichtbar UND Maus/Tastatur/Scrollen in den letzten 2 Minuten.
import { useEffect } from "react";
import { pingActivity } from "@/server/actions/activity";

export function ActivityPing() {
  useEffect(() => {
    let last = Date.now();
    const mark = () => { last = Date.now(); };
    const evs = ["mousemove", "keydown", "mousedown", "scroll", "touchstart"] as const;
    evs.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const tick = () => {
      if (document.visibilityState === "visible" && Date.now() - last < 120_000) void pingActivity();
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => {
      clearInterval(id);
      evs.forEach((e) => window.removeEventListener(e, mark));
    };
  }, []);
  return null;
}
