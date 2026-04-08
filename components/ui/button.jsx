import * as React from "react";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
  {
    variants: {
      variant: {
        default:
          "bg-[linear-gradient(135deg,#007f70_0%,#b87eb1_100%)] text-white shadow-lg shadow-[rgba(0,127,112,0.22)] hover:translate-y-[-1px]",
        outline:
          "border border-[#007f70]/12 bg-white/80 text-[#0d3d38] hover:bg-[#f4fbf9] hover:translate-y-[-1px]",
      },
      size: {
        default: "h-11 px-4 py-2",
        lg: "h-12 px-5 py-3 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const Button = React.forwardRef(({ className, variant, size, ...props }, ref) => {
  return (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  );
});
Button.displayName = "Button";

export { Button, buttonVariants };
