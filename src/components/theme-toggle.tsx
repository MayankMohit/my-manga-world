"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Cycles between light and dark. Renders a stable placeholder until mounted. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  // Mount guard: the resolved theme is only known on the client, so we defer the
  // real icon until after hydration to avoid a mismatch (standard next-themes pattern).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  // Until mounted, the resolved theme is unknown, so keep the label and icon in a
  // fixed state that matches the server render (avoids a hydration mismatch).
  const label = mounted
    ? isDark
      ? "Switch to light theme"
      : "Switch to dark theme"
    : "Toggle theme";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {mounted && !isDark ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}
