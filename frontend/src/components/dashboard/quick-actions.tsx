"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Phone, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

export function QuickActions() {
  return (
    <div className="flex items-center gap-3">
      <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
        <Button asChild>
          <Link href="/call-center">
            <Phone className="size-4" />
            New Call
          </Link>
        </Button>
      </motion.div>
      <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
        <Button variant="outline" asChild>
          <Link href="/leads">
            <Upload className="size-4" />
            Import Leads
          </Link>
        </Button>
      </motion.div>
    </div>
  );
}
