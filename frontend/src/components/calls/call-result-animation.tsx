"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, XCircle } from "lucide-react";

interface CallResultAnimationProps {
  type: "success" | "error";
  onComplete: () => void;
}

export function CallResultAnimation({
  type,
  onComplete,
}: CallResultAnimationProps) {
  useEffect(() => {
    const timeout = setTimeout(
      () => {
        onComplete();
      },
      type === "success" ? 2000 : 3000
    );

    return () => clearTimeout(timeout);
  }, [type, onComplete]);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Backdrop */}
        <motion.div
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />

        {/* Content */}
        <div className="relative flex flex-col items-center gap-4">
          {type === "success" ? (
            <>
              {/* Expanding ring */}
              <motion.div
                className="absolute h-24 w-24 rounded-full border-2 border-green-400"
                initial={{ scale: 0.5, opacity: 1 }}
                animate={{ scale: 2.5, opacity: 0 }}
                transition={{ duration: 1.2, ease: "easeOut" }}
              />

              {/* Checkmark circle */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 300,
                  damping: 20,
                  delay: 0.1,
                }}
              >
                <CheckCircle className="h-24 w-24 text-green-500" />
              </motion.div>

              {/* Text */}
              <motion.p
                className="text-xl font-semibold text-white"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                Call Initiated!
              </motion.p>
            </>
          ) : (
            <>
              {/* X circle with shake */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{
                  scale: 1,
                  x: [0, -10, 10, -10, 10, 0],
                }}
                transition={{
                  scale: {
                    type: "spring",
                    stiffness: 300,
                    damping: 20,
                  },
                  x: {
                    duration: 0.5,
                    delay: 0.3,
                  },
                }}
              >
                <XCircle className="h-24 w-24 text-red-500" />
              </motion.div>

              {/* Text */}
              <motion.p
                className="text-xl font-semibold text-white"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                Call Failed
              </motion.p>
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
