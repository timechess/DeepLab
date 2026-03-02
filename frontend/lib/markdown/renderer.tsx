'use client';

import { Streamdown } from 'streamdown';
import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { createMathPlugin } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';

const math = createMathPlugin({
  singleDollarTextMath: true,
});

export function MarkdownRenderer({ content }: { content: string }) {
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
        {content}
      </Streamdown>
    </div>
  );
}
