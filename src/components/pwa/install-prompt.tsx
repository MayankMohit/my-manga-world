"use client";

import * as React from "react";

/**
 * Captures the `beforeinstallprompt` event so the app can offer a custom Install
 * button instead of the browser mini-infobar. On iOS (no such event) it exposes
 * an `isIOS` flag so the UI can show "Add to Home Screen" instructions instead.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallContextValue {
  canInstall: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  promptInstall: () => Promise<void>;
}

const InstallContext = React.createContext<InstallContextValue | null>(null);

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true
  );
}

function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !("MSStream" in window) &&
    !detectStandalone()
  );
}

export function InstallPromptProvider({ children }: { children: React.ReactNode }) {
  const [deferred, setDeferred] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = React.useState(false);
  const [isIOS, setIsIOS] = React.useState(false);

  React.useEffect(() => {
    // Initialize from browser-only APIs available after mount.
    /* eslint-disable react-hooks/set-state-in-effect */
    setIsInstalled(detectStandalone());
    setIsIOS(detectIOS());
    /* eslint-enable react-hooks/set-state-in-effect */

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = React.useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  }, [deferred]);

  const value = React.useMemo<InstallContextValue>(
    () => ({ canInstall: deferred !== null, isInstalled, isIOS, promptInstall }),
    [deferred, isInstalled, isIOS, promptInstall],
  );

  return <InstallContext.Provider value={value}>{children}</InstallContext.Provider>;
}

export function useInstallPrompt(): InstallContextValue {
  const ctx = React.useContext(InstallContext);
  if (!ctx) {
    throw new Error("useInstallPrompt must be used within InstallPromptProvider");
  }
  return ctx;
}
