"use client";

import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { CheckStatus } from "@/lib/types";
import { useAnalysis } from "./AnalysisContext";
import { Card, cx } from "@/components/ui";
import { Gauge } from "@/components/ui/charts";

export const STATUS_ICON: Record<CheckStatus, React.ReactNode> = {
  pass: <CheckCircle2 size={16} className="text-leaf" />,
  warn: <AlertTriangle size={16} className="text-warn" />,
  fail: <XCircle size={16} className="text-bad" />,
  info: <Info size={16} className="text-sky" />,
};

export function AuditTab() {
  const { checks, score } = useAnalysis();
  const groups = Array.from(new Set(checks.map((c) => c.group)));
  return (
    <div className="grid h-full gap-3 overflow-y-auto pb-6 lg:grid-cols-[300px_1fr]">
      <div className="space-y-3">
        <Card title="Pre-audit readiness">
          <div className="flex flex-col items-center">
            <Gauge value={score.score} label="readiness score" size={180} color={score.score >= 80 ? "#3ddc97" : score.score >= 55 ? "#f5b942" : "#f2685c"} />
            <div className="mt-2 flex gap-4 text-[12px] tabular">
              <span className="text-leaf">{score.pass} pass</span>
              <span className="text-warn">{score.warn} warn</span>
              <span className="text-bad">{score.fail} fail</span>
            </div>
          </div>
          <p className="mt-4 text-[11.5px] leading-relaxed text-muted">
            Flags the issues a validation/verification body (VVB) is most likely to raise about drone-derived inventories, so they are fixed before the audit rather than becoming findings. Internal QA aid — always check against the applicable methodology and VVB guidance.
          </p>
        </Card>
      </div>
      <div className="space-y-3">
        {groups.map((g) => (
          <Card key={g} title={g} pad={false}>
            <div className="divide-y divide-line">
              {checks
                .filter((c) => c.group === g)
                .map((c) => (
                  <div key={c.id} className="flex gap-3 px-4 py-3">
                    <div className="pt-0.5">{STATUS_ICON[c.status]}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cx("text-[13px] font-medium", c.status === "fail" ? "text-bad" : "text-ink")}>{c.title}</span>
                        {c.ref && <span className="rounded bg-panel3 px-1.5 py-0.5 text-[10.5px] text-muted">{c.ref}</span>}
                      </div>
                      <div className="mt-0.5 break-words text-[12px] leading-relaxed text-muted">{c.detail}</div>
                    </div>
                  </div>
                ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
