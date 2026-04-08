"use client";

import { cn } from "@/lib/utils";

const ORB_STATE = {
  idle: "from-[#007f70] via-[#78c4bb] to-[#b87eb1]",
  listening: "from-[#007f70] via-[#59b8ac] to-[#b87eb1]",
  talking: "from-[#006d61] via-[#8fd8ce] to-[#b87eb1]",
};

export function Orb({ state = "idle", small = false, className }) {
  return (
    <div
      className={cn(
        "relative isolate rounded-full border border-white/90 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.96),rgba(241,251,248,0.92)_48%,rgba(248,238,248,0.9)_100%)] shadow-[0_24px_80px_rgba(0,127,112,0.18)]",
        small ? "size-20" : "size-28",
        className
      )}
    >
      <div className="absolute inset-2 rounded-full bg-white/30" />
      <div
        className={cn(
          "absolute inset-3 rounded-full bg-gradient-to-br opacity-100 blur-[1px] animate-[orbPulse_3.4s_ease-in-out_infinite]",
          ORB_STATE[state] || ORB_STATE.idle
        )}
      />
      <div className="absolute inset-[22%] rounded-full bg-white/35 blur-2xl" />
      <div className="absolute inset-[12%] rounded-full border border-white/50" />
    </div>
  );
}
