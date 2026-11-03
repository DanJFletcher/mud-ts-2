import { useEffect, useRef, useState } from "react";

export type Screen = "play" | "vitals" | "items" | "equipment" | "stats" | "notes" | "codex";

export function currentScreen(): Screen {
  const route = window.location.hash.slice(2).split("?")[0];
  if (route === "info/codex" || route.startsWith("info/codex/")) return "codex";
  if (["notes", "info/notes", "info/field-notes"].includes(route)) return "notes";
  if (route === "info/items") return "items";
  if (route === "info/equipment") return "equipment";
  if (route === "info/stats") return "stats";
  if (["traveler", "info", "info/traveler", "info/vitals"].includes(route)) return "vitals";
  return "play";
}

/** Owns browser navigation, theme persistence, and the navigation disclosure. */
export function useWorldNavigation() {
  const [screen, setScreen] = useState<Screen>(currentScreen);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    window.localStorage.getItem("mudd-theme") === "light" ? "light" : "dark");
  const [menuOpen, setMenuOpen] = useState(false);
  const contentRef = useRef<HTMLElement>(null);
  const navMenuRef = useRef<HTMLDivElement>(null);
  const navMenuTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("mudd-theme", theme);
  }, [theme]);

  useEffect(() => { setMenuOpen(false); }, [screen]);

  useEffect(() => {
    let frame: number | undefined;
    const navigate = () => {
      setScreen(currentScreen());
      window.scrollTo?.(0, 0);
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => contentRef.current?.focus());
    };
    window.addEventListener("hashchange", navigate);
    return () => {
      window.removeEventListener("hashchange", navigate);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !navMenuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      navMenuTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);

  const toggleTheme = () => setTheme((current) => current === "light" ? "dark" : "light");
  return { screen, theme, menuOpen, setMenuOpen, contentRef, navMenuRef, navMenuTriggerRef, toggleTheme };
}
