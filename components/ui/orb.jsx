"use client";

import { cn } from "@/lib/utils";

const ORB_STATE = {
  idle: {
    gradient: "from-[#007f70] via-[#78c4bb] to-[#b87eb1]",
    coreAnimation: "animate-[orbFloat_8.6s_ease-in-out_infinite]",
    shellAnimation: "animate-[orbMorphIdle_7.2s_ease-in-out_infinite]",
    ringAnimation: "animate-[orbHaloIdle_6s_ease-in-out_infinite]",
  },
  listening: {
    gradient: "from-[#007f70] via-[#59b8ac] to-[#b87eb1]",
    coreAnimation: "animate-[orbFloat_5.4s_ease-in-out_infinite]",
    shellAnimation: "animate-[orbMorphListen_3.6s_ease-in-out_infinite]",
    ringAnimation: "animate-[orbHaloListen_3.4s_ease-in-out_infinite]",
  },
  "user-talking": {
    gradient: "from-[#0d8476] via-[#7de0cf] to-[#b87eb1]",
    coreAnimation: "animate-[orbFloat_3.1s_ease-in-out_infinite]",
    shellAnimation: "animate-[orbMorphUser_1.18s_cubic-bezier(0.4,0,0.2,1)_infinite]",
    ringAnimation: "animate-[orbHaloUser_1.55s_ease-out_infinite]",
  },
  "agent-talking": {
    gradient: "from-[#006d61] via-[#8fd8ce] to-[#d4a1ce]",
    coreAnimation: "animate-[orbFloat_2.8s_ease-in-out_infinite]",
    shellAnimation: "animate-[orbMorphAgent_1.3s_cubic-bezier(0.4,0,0.2,1)_infinite]",
    ringAnimation: "animate-[orbHaloAgent_1.9s_ease-out_infinite]",
  },
};

export function Orb({ state = "idle", small = false, className }) {
  const stateConfig = ORB_STATE[state] || ORB_STATE.idle;

  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-full border border-white/90 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.96),rgba(241,251,248,0.92)_48%,rgba(248,238,248,0.9)_100%)] shadow-[0_24px_80px_rgba(0,127,112,0.18)]",
        small ? "size-20" : "size-28",
        className
      )}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.92),transparent_38%),radial-gradient(circle_at_78%_78%,rgba(184,126,177,0.16),transparent_32%)]" />
      <div className="absolute inset-2 rounded-full bg-white/30" />
      <div
        className={cn(
          "absolute inset-3 rounded-[42%] bg-gradient-to-br opacity-100 blur-[1px]",
          stateConfig.gradient,
          stateConfig.shellAnimation
        )}
      />
      <div
        className={cn(
          "absolute inset-[16%] rounded-[46%] border border-white/45 opacity-70",
          stateConfig.ringAnimation
        )}
      />
      <div
        className={cn(
          "absolute inset-[20%] rounded-[44%] bg-[radial-gradient(circle_at_30%_28%,rgba(255,255,255,0.58),rgba(255,255,255,0.12)_48%,transparent_74%)] blur-[1px]",
          stateConfig.coreAnimation
        )}
      />
      <div className="absolute inset-[24%] rounded-[44%] bg-white/35 blur-2xl" />
      <div className="absolute inset-[12%] rounded-full border border-white/50" />
      <div className="absolute inset-[30%] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.55),transparent_72%)] blur-xl" />
    </div>
  );
}
