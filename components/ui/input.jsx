import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef(({ className, type = "text", ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-11 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus-visible:border-amber-300/60 focus-visible:ring-2 focus-visible:ring-amber-300/20",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
