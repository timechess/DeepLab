"use client";

import Link from "next/link";
import { useState } from "react";
import type { PaperCardDTO } from "@/lib/workflow";

interface RecommendedPaperCardProps {
  paper: PaperCardDTO;
}

export function RecommendedPaperCard({ paper }: RecommendedPaperCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article className="rounded-2xl border border-[#1f2a3d] bg-[#0f1724] p-6 transition-shadow duration-200 hover:shadow-[0_16px_40px_rgba(79,125,255,0.2)]">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f7dff]"
      >
        <div className="flex flex-wrap items-center gap-3">
          {paper.rank ? (
            <span className="rounded-full border border-[#2d3a52] px-3 py-1 text-xs font-semibold text-[#c7d5ef]">
              Rank #{paper.rank}
            </span>
          ) : null}
          {paper.score !== undefined && paper.score !== null ? (
            <span className="rounded-full bg-[#132034] px-3 py-1 text-xs font-semibold text-[#c7d5ef]">
              Score {paper.score}
            </span>
          ) : null}
        </div>
        <h3 className="mt-3 font-serif text-2xl leading-tight font-semibold text-[#e5ecff]">
          {paper.title}
        </h3>
        <p className="mt-2 text-sm text-[#8ba2c7]">{paper.id}</p>
      </button>

      {expanded ? (
        <div className="mt-5 space-y-4 border-t border-[#1f2a3d] pt-5">
          {paper.reason ? (
            <p className="text-sm leading-6 text-[#c7d5ef]">{paper.reason}</p>
          ) : null}
          <p className="text-sm leading-6 text-[#c7d5ef]">{paper.summary}</p>
          <div className="flex flex-wrap gap-2 text-xs text-[#9fb0d0]">
            <span>Upvotes: {paper.upvotes ?? 0}</span>
            <span>Stars: {paper.githubStars ?? 0}</span>
            <span>作者: {paper.authors.join(" / ") || "未知"}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {paper.keywords.map((keyword) => (
              <span
                key={`${paper.id}-${keyword}`}
                className="rounded-full bg-[#132034] px-3 py-1 text-xs text-[#c7d5ef]"
              >
                {keyword}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href={paper.arxivUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-[#2d3a52] px-4 py-2 text-sm text-[#c7d5ef] transition-colors duration-200 hover:bg-[#142033] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f7dff]"
            >
              打开 arXiv
            </Link>
            {paper.githubRepo ? (
              <Link
                href={paper.githubRepo}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-[#2d3a52] px-4 py-2 text-sm text-[#c7d5ef] transition-colors duration-200 hover:bg-[#142033] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f7dff]"
              >
                打开 GitHub
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}
