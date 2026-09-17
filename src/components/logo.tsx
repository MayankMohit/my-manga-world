import { cn } from "@/lib/cn";

/** Wordmark: a small accent tile + "Shelf". */
export function Logo({
  className,
  showText = true,
}: {
  className?: string;
  showText?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold", className)}>
      <span
        aria-hidden
        className="bg-accent text-accent-foreground flex size-7 items-center justify-center rounded-md text-sm font-bold"
      >
        S
      </span>
      {showText && <span className="tracking-tight">Shelf</span>}
    </span>
  );
}
