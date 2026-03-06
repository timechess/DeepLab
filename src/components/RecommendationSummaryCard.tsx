interface RecommendationSummaryCardProps {
  dayKey: string;
  summary: string;
}

export function RecommendationSummaryCard({
  dayKey,
  summary,
}: RecommendationSummaryCardProps) {
  return (
    <section className="rounded-3xl border border-[#1f2a3d] bg-[#0f1724] p-8 shadow-[0_20px_45px_rgba(0,0,0,0.35)]">
      <p className="text-sm font-semibold tracking-[0.12em] text-[#8ba2c7]">
        {dayKey}
      </p>
      <h2 className="mt-2 font-serif text-4xl leading-tight font-semibold text-[#e5ecff]">
        今日论文推荐摘要
      </h2>
      <p className="mt-4 text-base leading-7 text-[#c7d5ef]">{summary}</p>
    </section>
  );
}
