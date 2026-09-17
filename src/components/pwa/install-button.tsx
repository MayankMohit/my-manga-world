"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useInstallPrompt } from "@/components/pwa/install-prompt";

/**
 * Install button. Shows only when the app is installable (or on iOS, where it
 * surfaces Add-to-Home-Screen guidance). Renders nothing once installed.
 */
export function InstallButton(props: Omit<ButtonProps, "onClick" | "children">) {
  const { canInstall, isInstalled, isIOS, promptInstall } = useInstallPrompt();

  if (isInstalled) return null;
  if (!canInstall && !isIOS) return null;

  const onClick = () => {
    if (canInstall) {
      void promptInstall();
      return;
    }
    toast("Install Shelf", {
      description: "In Safari, tap the Share button, then choose Add to Home Screen.",
    });
  };

  return (
    <Button variant="outline" size="sm" onClick={onClick} {...props}>
      <Download aria-hidden />
      Install app
    </Button>
  );
}
