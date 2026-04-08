import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[120px] w-full rounded-3xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus-visible:border-amber-300/60 focus-visible:ring-2 focus-visible:ring-amber-300/20",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
