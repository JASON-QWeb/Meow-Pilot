import { useEffect, useState } from "react";
import type { PetActivityEvent, PetEmotion } from "@pet/protocol";

export function usePetPresence() {
  const [petEmotion, setPetEmotion] = useState<PetEmotion>("idle");
  const [petActivity, setPetActivity] = useState<Omit<PetActivityEvent, "sessionId">>({
    activity: "sleeping",
    active: false,
    reason: "initial-rest",
  });

  useEffect(() => {
    if (petActivity.active) return;
    const interval = window.setInterval(() => {
      setPetActivity((current) =>
        current.active
          ? current
          : {
              activity: current.activity === "sleeping" ? "exercise" : "sleeping",
              active: false,
              reason: "idle-rotation",
            },
      );
    }, 12_000);
    return () => window.clearInterval(interval);
  }, [petActivity.active]);

  return {
    petEmotion,
    petActivity,
    setPetEmotion,
    setPetActivity,
  };
}
