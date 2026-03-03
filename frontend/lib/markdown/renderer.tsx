'use client';

import { Streamdown } from 'streamdown';
import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { createMathPlugin } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import { useMemo } from 'react';

const math = createMathPlugin({
  singleDollarTextMath: true,
});

function normalizeMathDelimiters(content: string): string {
  if (!content.includes('\\(') && !content.includes('\\[')) {
    return content;
  }

  const convertMath = (text: string): string =>
    text
      .replace(/\\\[([\s\S]*?)\\\]/g, (_match, expression: string) => `$$\n${expression}\n$$`)
      .replace(/\\\((.+?)\\\)/g, (_match, expression: string) => `$${expression}$`);

  const fencePattern = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;
  const inlineCodePattern = /(`+[^`]*`+)/g;

  return content
    .split(fencePattern)
    .map((segment) => {
      if (segment.startsWith('```') || segment.startsWith('~~~')) {
        return segment;
      }
      return segment
        .split(inlineCodePattern)
        .map((inlineChunk) =>
          inlineChunk.startsWith('`') && inlineChunk.endsWith('`')
            ? inlineChunk
            : convertMath(inlineChunk),
        )
        .join('');
    })
    .join('');
}

export function MarkdownRenderer({ content }: { content: string }) {
  const normalizedContent = useMemo(() => normalizeMathDelimiters(content), [content]);

  return (
    <div className="markdown-wrap">
      <Streamdown
        controls={{
          code: true,
          table: true,
          mermaid: {
            copy: true,
            download: true,
            fullscreen: true,
            panZoom: true,
          },
        }}
        mode="static"
        plugins={{ cjk, code, math, mermaid }}
      >
        {normalizedContent}
      </Streamdown>
    </div>
  );
}
