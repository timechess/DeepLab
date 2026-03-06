# 论文推荐工作流

该工作流从 https://huggingface.co/api/daily_papers 获取最新的论文，该网页返回一个列表，其中的数据项例子如下：

```json
{
    "paper": {
      "id": "2602.23229",
      "authors": [
        {
          "_id": "69aa20ecc4f6edddcc6c85cd",
          "name": "Marco Garosi",
          "hidden": false
        },
        {
          "_id": "69aa20ecc4f6edddcc6c85ce",
          "name": "Matteo Farina",
          "hidden": false
        },
        {
          "_id": "69aa20ecc4f6edddcc6c85cf",
          "name": "Alessandro Conti",
          "hidden": false
        },
        {
          "_id": "69aa20ecc4f6edddcc6c85d0",
          "name": "Massimiliano Mancini",
          "hidden": false
        },
        {
          "_id": "69aa20ecc4f6edddcc6c85d1",
          "name": "Elisa Ricci",
          "hidden": false
        }
      ],
      "mediaUrls": [
        "https://cdn-uploads.huggingface.co/production/uploads/65a103d5230f8846b1b99cfa/UUPae7qIumdx3m-4RDOkm.webp"
      ],
      "publishedAt": "2026-02-26T17:08:18.000Z",
      "submittedOnDailyAt": "2026-03-06T03:55:12.777Z",
      "title": "Large Multimodal Models as General In-Context Classifiers",
      "submittedOnDailyBy": {
        "_id": "65a103d5230f8846b1b99cfa",
        "avatarUrl": "/avatars/0bcba885d6e0ff74e03f42faa5c86783.svg",
        "isPro": false,
        "fullname": "Marco Garosi",
        "user": "marco-garosi",
        "type": "user"
      },
      "summary": "Which multimodal model should we use for classification? Previous studies suggest that the answer lies in CLIP-like contrastive Vision-Language Models (VLMs), due to their remarkable performance in zero-shot classification. In contrast, Large Multimodal Models (LMM) are more suitable for complex tasks. In this work, we argue that this answer overlooks an important capability of LMMs: in-context learning. We benchmark state-of-the-art LMMs on diverse datasets for closed-world classification and find that, although their zero-shot performance is lower than CLIP's, LMMs with a few in-context examples can match or even surpass contrastive VLMs with cache-based adapters, their \"in-context\" equivalent. We extend this analysis to the open-world setting, where the generative nature of LMMs makes them more suitable for the task. In this challenging scenario, LMMs struggle whenever provided with imperfect context information. To address this issue, we propose CIRCLE, a simple training-free method that assigns pseudo-labels to in-context examples, iteratively refining them with the available context itself. Through extensive experiments, we show that CIRCLE establishes a robust baseline for open-world classification, surpassing VLM counterparts and highlighting the potential of LMMs to serve as unified classifiers, and a flexible alternative to specialized models.",
      "upvotes": 10,
      "discussionId": "69aa20edc4f6edddcc6c85d2",
      "projectPage": "https://circle-lmm.github.io/",
      "githubRepo": "https://github.com/marco-garosi/CIRCLE",
      "githubRepoAddedBy": "user",
      "ai_summary": "Large Multimodal Models demonstrate superior performance in closed-world classification with in-context learning and excel in open-world scenarios when equipped with context refinement techniques.",
      "ai_keywords": [
        "Vision-Language Models",
        "Large Multimodal Models",
        "zero-shot classification",
        "in-context learning",
        "open-world classification",
        "cache-based adapters",
        "CIRCLE",
        "pseudo-labeling",
        "context refinement"
      ],
      "githubStars": 9,
      "organization": {
        "_id": "647ef9ce45baf21ad707cc59",
        "name": "MHUGLab",
        "fullname": "Multimedia and Human Understanding Group",
        "avatar": "https://cdn-uploads.huggingface.co/production/uploads/647ef81a45baf21ad707bfb1/VfcRM08QNOTXAqIUcf-WO.png"
      }
    },
    "publishedAt": "2026-02-26T12:08:18.000Z",
    "title": "Large Multimodal Models as General In-Context Classifiers",
    "summary": "Which multimodal model should we use for classification? Previous studies suggest that the answer lies in CLIP-like contrastive Vision-Language Models (VLMs), due to their remarkable performance in zero-shot classification. In contrast, Large Multimodal Models (LMM) are more suitable for complex tasks. In this work, we argue that this answer overlooks an important capability of LMMs: in-context learning. We benchmark state-of-the-art LMMs on diverse datasets for closed-world classification and find that, although their zero-shot performance is lower than CLIP's, LMMs with a few in-context examples can match or even surpass contrastive VLMs with cache-based adapters, their \"in-context\" equivalent. We extend this analysis to the open-world setting, where the generative nature of LMMs makes them more suitable for the task. In this challenging scenario, LMMs struggle whenever provided with imperfect context information. To address this issue, we propose CIRCLE, a simple training-free method that assigns pseudo-labels to in-context examples, iteratively refining them with the available context itself. Through extensive experiments, we show that CIRCLE establishes a robust baseline for open-world classification, surpassing VLM counterparts and highlighting the potential of LMMs to serve as unified classifiers, and a flexible alternative to specialized models.",
    "mediaUrls": [
      "https://cdn-uploads.huggingface.co/production/uploads/65a103d5230f8846b1b99cfa/UUPae7qIumdx3m-4RDOkm.webp"
    ],
    "thumbnail": "https://cdn-thumbnails.huggingface.co/social-thumbnails/papers/2602.23229.png",
    "numComments": 1,
    "submittedBy": {
      "_id": "65a103d5230f8846b1b99cfa",
      "avatarUrl": "/avatars/0bcba885d6e0ff74e03f42faa5c86783.svg",
      "fullname": "Marco Garosi",
      "name": "marco-garosi",
      "type": "user",
      "isPro": false,
      "isHf": false,
      "isHfAdmin": false,
      "isMod": false,
      "followerCount": 1,
      "isUserFollowing": false
    },
    "organization": {
      "_id": "647ef9ce45baf21ad707cc59",
      "name": "MHUGLab",
      "fullname": "Multimedia and Human Understanding Group",
      "avatar": "https://cdn-uploads.huggingface.co/production/uploads/647ef81a45baf21ad707bfb1/VfcRM08QNOTXAqIUcf-WO.png"
    },
    "isAuthorParticipating": false
  },
```

该工作流获取该内容后，将其加工为数据库中定义的 `Paper` 数据结构，并将新增加的数据存入数据库。然后，对于每篇新增的论文，将其标题、摘要、ai总结、ai关键词以及其他相关元信息组织成文本字符串，将新增论文的字符串进行拼接，然后按如下提示词模板交由LLM进行推荐。

系统提示词：
```markdown
你是一名负责“AI论文初筛”的资深研究工程师，目标是在有限时间内找出最值得后续精读的论文。
请保持严格、可审计、可复现：结论必须基于输入信息，不允许虚构。
```

用户提示词：
```markdown
【角色设定与任务目标】
你将处理每日候选论文列表，输出用于后续“论文精读”步骤的入选名单与逐篇判断依据。
请优先关注：技术创新强度、方法可靠性、工程落地潜力、与AI研究主线的相关性、社区关注度（upvotes仅作为辅助信号）。

【判断指引】
1. 必须逐篇判断，不允许只输出部分论文。
2. 每篇论文给出明确结论（selected=true/false）和理由。
3. 理由应是可执行、可追踪的判断，不要空泛表述。
4. 入选论文数量建议控制在 3-5 篇。
5. 若规则存在冲突，请在 summary 中解释如何权衡。

【输出格式约定】
仅输出一个 JSON 对象，不要输出 Markdown，不要输出解释性前后缀文字，结构如下：
{
  "summary": "整体筛选总结（中文）",
  "selected_ids": ["论文id1", "论文id2"],
  "decisions": [
    {
      "id": "论文id",
      "selected": true,
      "score": 0-100之间数字,
      "rank": 1,
      "reason": "中文理由",
      "tags": ["可选标签1", "可选标签2"]
    }
  ]
}

【强制校验要求】
1. decisions 必须覆盖全部候选论文，不能缺失、不能出现未知 id。
2. selected_ids 必须与 decisions 中 selected=true 的 id 一致。
3. rank 仅对 selected=true 的论文给出，从1开始连续编号。

【候选论文】
{{CANDIDATES_PAPER}}

【初筛规则】
{{RULE_LIST}}

请严格按“输出格式约定”返回 JSON。
```

其中CANDIDATES_PAPER即上述拼接后的论文信息，RULE_LIST为数据库中 `Rule` 表中的数据，需以换行符拼接后插入。该提示词为默认提示词，如果数据库中 `RuntimeSetting` 存在新的提示词，则优先采用数据库中的提示词，但数据库中的提示词也仅能使用上述变量命名的信息。

得到LLM反馈后，解析输出的json，并将推荐的论文展示给用户。该工作流的 `payload` 中，创建时包含工作流触发时间，结束后需要把LLM输出的json也带上。

论文推荐内容显示于应用首页 `/`，仅显示当日结果，如果当日还没运行工作流，则提供一个触发工作流的按钮，点击后运行工作流，同时跳转到 `/workflow` 管理页。完成后，论文推荐板块需包含当日推荐的summary，以及推荐的论文列表，该列表中包含每篇论文的卡片，点击后展开元信息，包含摘要、arxiv链接按钮、github链接按钮、upvotes数目、github star数、作者、摘要、关键词。

工作流在后台运行，不应影响前端页面渲染。