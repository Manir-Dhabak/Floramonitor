import { Suspense } from "react";
import type { Metadata } from "next";
import { Workspace } from "@/components/workspace/Workspace";

export const metadata: Metadata = {
  title: "Workspace — FloraScope",
};

export default function WorkspacePage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-muted">Loading FloraScope…</div>}>
      <Workspace />
    </Suspense>
  );
}
