import { cn } from "@/lib/utils";

const SIZES = {
  sm: "size-8 rounded-lg",
  md: "size-10 rounded-xl",
} as const;

/**
 * A subscription's logo tile. Renders the fetched logo (a data URI) when we
 * have one, otherwise a colour-coded letter avatar using the category colour.
 * Plain markup (no hooks) so it works in both server and client components.
 */
export function SubscriptionLogo({
  name,
  logoUrl,
  color,
  size = "sm",
  className,
}: {
  name: string;
  logoUrl?: string | null;
  color?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const box = cn(
    "flex shrink-0 items-center justify-center overflow-hidden",
    SIZES[size],
    className,
  );

  if (logoUrl) {
    return (
      <div className={cn(box, "border bg-background")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt="" className="size-full object-contain p-1" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        box,
        "font-semibold text-white",
        size === "sm" ? "text-xs" : "text-sm",
      )}
      style={{ backgroundColor: color ?? "#64748b" }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
