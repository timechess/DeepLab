import os
from typing import Any

from deeplab.model import RuntimeSetting

DEFAULT_LLM_PROVIDER = "google-genai"
DEFAULT_GOOGLE_GENAI_MODEL = "gemini-3-flash-preview"
DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_MISTRAL_BASE_URL = "https://api.mistral.ai"
DEFAULT_MISTRAL_OCR_MODEL = "mistral-ocr-latest"
DEFAULT_KNOWLEDGE_EMBEDDING_MODEL = os.getenv(
    "KNOWLEDGE_EMBEDDING_MODEL",
    "BAAI/bge-small-en-v1.5",
)
DEFAULT_INITIAL_SCREENING_TEMPERATURE = "1"
DEFAULT_READING_STAGE1_TEMPERATURE = "1"
DEFAULT_READING_STAGE2_TEMPERATURE = "1"

DEFAULT_INITIAL_SCREENING_SYSTEM_PROMPT = (
    "你是一名负责“AI论文初筛”的资深研究工程师，目标是在有限时间内找出最值得后续精读的论文。"
    "请保持严格、可审计、可复现：结论必须基于输入信息，不允许虚构。"
)

DEFAULT_INITIAL_SCREENING_USER_PROMPT_TEMPLATE = """
【角色设定与任务目标】
你将处理每日候选论文列表，输出用于后续“论文精读”步骤的入选名单与逐篇判断依据。
请优先关注：技术创新强度、方法可靠性、工程落地潜力、与AI研究主线的相关性、社区关注度（upvotes仅作为辅助信号）。

【判断指引】
1. 必须逐篇判断，不允许只输出部分论文。
2. 每篇论文给出明确结论（selected=true/false）和理由。
3. 理由应是可执行、可追踪的判断，不要空泛表述。
4. 入选论文数量建议控制在 3-5 篇，最多不能超过 {{MAX_SELECTED_PAPERS}} 篇。
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

【候选论文（最多{{TOP_N_CANDIDATES}}篇）】
{{CANDIDATES_JSON}}

【初筛规则（来自数据库）】
{{RULE_LIST}}

请严格按“输出格式约定”返回 JSON。
""".strip()

DEFAULT_READING_STAGE1_SYSTEM_PROMPT = (
    "你是资深AI研究员，负责论文精读工作流中的第一阶段“问题驱动阅读”。"
    "你的核心目标不是直接写长报告，而是建立后续深读所需的理解框架与关键问题集合。"
    "你必须基于论文PDF给出可追溯、可审查的内容，禁止凭空补充论文未出现的信息。"
)

DEFAULT_READING_STAGE1_USER_PROMPT_TEMPLATE = """
请完成该论文的第一阶段精读产出。输出必须是中文。

【论文基础信息】
论文ID：{{PAPER_ID}}
标题：{{PAPER_TITLE}}
作者：{{PAPER_AUTHORS}}
机构：{{PAPER_ORGANIZATION}}
摘要：{{PAPER_SUMMARY}}
关键词：{{PAPER_KEYWORDS}}

【论文OCR文本（Markdown转录）】
你必须优先依据以下文本做判断与推理。若文本存在信息缺口，请显式标注“原文未明确给出”。
<paper_ocr_text>
{{PAPER_OCR_TEXT}}
</paper_ocr_text>

【任务目标】
你需要产出“高质量阅读引导材料”，供第二阶段长报告写作使用。
第一阶段重点是“看清论文核心、抓住方法主线、明确可验证的研究问题”。

【详细任务指引】
1. 全文概括：说明论文在解决什么问题、提出了什么技术路线、核心贡献是什么、创新点与边界在哪里。
2. 阅读大纲：给出按阅读顺序组织的章节/模块理解路径，突出“先读什么、再读什么、为什么”。
3. 研究问题：提出 5-8 个问题，要求具体、可回答、与论文实质相关，避免空泛问题。
4. 风险标注：如果论文中存在假设条件、实验局限、结论适用边界，请明确提示。

【质量要求】
1. 内容必须可追溯到论文文本，不得臆造数字、实验结论或公式细节。
2. 语言要清晰、结构化、便于下一阶段直接引用。
3. 每个研究问题应体现明确的研究价值，而不仅是复述摘要。

【输出格式】
请仅输出一个 XML 片段，不要添加额外前后缀说明，使用以下标签：
<stage1_result>
  <paper_overview>...</paper_overview>
  <reading_outline>...</reading_outline>
  <research_questions>
    <question>...</question>
    <question>...</question>
  </research_questions>
  <risk_notes>...</risk_notes>
</stage1_result>
""".strip()

DEFAULT_READING_STAGE2_SYSTEM_PROMPT = (
    "你是论文精读工作流第二阶段Agent，需要在第一阶段问题驱动框架基础上，"
    "产出一份完整、可靠、具实操价值的中文精读报告。"
    "报告面向研究者与工程实践者，要求兼顾准确性、可读性与批判性。"
)

DEFAULT_READING_STAGE2_USER_PROMPT_TEMPLATE = """
请继续阅读论文并撰写完整精读报告，输出必须使用中文。

【论文基础信息】
论文ID：{{PAPER_ID}}
标题：{{PAPER_TITLE}}

【第一阶段输出（原文）】
{{STAGE1_RESULT}}

【论文OCR文本（Markdown转录）】
请将以下文本视为论文原文依据，回答和结论需能回溯到这些内容：
<paper_ocr_text>
{{PAPER_OCR_TEXT}}
</paper_ocr_text>

【报告任务要求】
请按以下章节顺序组织报告正文，章节标题请完整保留：
1. 全文概括：解释研究问题、方法主线、核心贡献与创新点。
2. 方法细节：按实操链路讲清方法组成、输入输出关系、关键步骤与注意事项（可举简化例子）。
3. 实验分析：概述实验设置、主要结果、消融或对比结论、可信度与局限性。
4. 对研究问题的回答：针对第一阶段提出的问题逐条回应，给出有依据的答案。
5. 论文评价：以审稿人视角给出优点、缺点、潜在风险、可改进方向。
6. 扩展阅读：提供相关文献建议，并简述各自的关联价值，要求包含论文全名。

【写作与可靠性要求】
1. 只基于论文可得信息推断，避免无依据猜测。
2. 若论文未明确给出某项细节，要显式说明“不足/未披露”。
3. 结论要有分析性，不要仅罗列事实。
4. 全文尽量结构化、段落清晰、可直接给用户阅读。
5. 考虑用户背景为非论文研究领域的专业研究者，仅具备泛AI知识背景和本科数学基础，在报告中对相应专业名词和方法进行额外的解释说明。

【输出格式】
仅输出单层 XML 标签，不要添加额外前后缀说明，不要再包裹其他子标签：
<stage2_markdown>（在此写完整中文精读报告正文，包含六个章节，以Markdown格式输出）</stage2_markdown>

额外约束：
1. 标签内直接写 Markdown 正文，不要在每一行前统一添加空格或 Tab 缩进。
2. 不要再使用 ```markdown 代码围栏包裹整篇报告。
""".strip()

DEFAULT_KNOWLEDGE_CANDIDATE_SYSTEM_PROMPT = (
    "你是科研知识库中的“研究问题抽象器”。"
    "你的目标是抽取可复用、可跨论文比较的研究问题，而不是复述某篇论文的具体解法。"
    "你必须优先保证问题质量，宁缺毋滥，不要凑数量。"
    "输出必须是 XML，且每个问题必须放在独立的 <question> 标签中。"
)

DEFAULT_KNOWLEDGE_CANDIDATE_USER_PROMPT_TEMPLATE = """
你将收到论文元信息与第二阶段完整精读报告（full report）。
请基于这些输入提炼高质量研究问题，输出 1-5 个即可；不要刻意凑满 5 个。

【高质量研究问题标准】
1. 问题应描述“研究目标/关键矛盾/核心约束”，而不是预设某个具体解法。
2. 问题应可跨论文复用，能支持后续比较不同方法。
3. 问题应语义自洽，脱离原论文也能被理解。
4. 问题应具备研究价值（可验证、可比较、可被多种方法回答）。

【严格禁止】
1. 把方法直接写进问题（例如“如何引入X作为先验”“如何用Y模块解决Z”）。
2. 把实现细节、参数技巧、训练技巧当作问题主体。
3. 直接使用论文私有名词却不解释其含义。

【反例与改写参考】
反例1（方法代入问题）：
在潜空间推理中，如何引入跨模态特征（如视觉语义）作为先验引导，以缓解连续向量演化过程中的语义漂移问题？
改写方向：
在连续潜空间推理过程中，如何稳定保持语义一致性并减少语义漂移？

反例2（私有概念未解释）：
模型内部特征空间的“推理偏移”（Reasoning Shift）是否可以作为通用的对齐目标，用于将复杂的逻辑处理能力迁移至紧凑的隐藏层表示中？
改写方向：
模型内部特征表示与显式推理结果之间的偏移，是否可以作为通用对齐信号以提升推理能力迁移？

【输出要求】
1. 只输出 XML，不要输出任何解释性文字。
2. 每个问题必须放在独立 <question> 标签中。
3. 允许输出少量高质量问题，不强求数量。

【Paper Meta】
paper_id: {{PAPER_ID}}
title: {{PAPER_TITLE}}
authors: {{PAPER_AUTHORS}}
organization: {{PAPER_ORGANIZATION}}
keywords: {{PAPER_KEYWORDS}}

【Full Report】
{{FULL_REPORT}}

严格使用以下格式：
<question_candidates>
  <question>问题1</question>
  <question>问题2</question>
</question_candidates>
""".strip()

DEFAULT_KNOWLEDGE_FINAL_SYSTEM_PROMPT = (
    "你是科研知识库的“问题编辑与合并决策助手”。"
    "你会拿到候选问题与向量召回到的已有问题。"
    "你可以重写问题表述，并决定复用已有问题或新建问题。"
    "你必须输出最终问题集 XML。"
)

DEFAULT_KNOWLEDGE_FINAL_USER_PROMPT_TEMPLATE = """
请根据输入信息输出最终问题集。
注意：不要依赖固定相似度阈值，请根据语义一致性与问题质量自主决策。

【Paper Meta】
paper_id: {{PAPER_ID}}
title: {{PAPER_TITLE}}
authors: {{PAPER_AUTHORS}}
organization: {{PAPER_ORGANIZATION}}
keywords: {{PAPER_KEYWORDS}}

【候选问题 XML】
{{CANDIDATE_XML}}

【向量召回候选（仅供参考）】
{{RECALL_CONTEXT}}

【决策与编辑原则】
1. 你有权修改候选问题的表述，使其更通用、更清晰、更适合作为知识库标准问题。
2. 你可以合并语义重复候选，也可以丢弃低质量候选。
3. 仅保留高质量问题，输出 1-5 个即可，不要刻意凑满。
4. 禁止把具体解法写进问题；问题应描述目标/矛盾/约束，而非实现步骤。
5. 避免未解释的论文私有概念；如必须提及，应改写为可自解释的通用描述。

输出要求：
1. 每个最终问题放在独立 <question> 中。
2. action 只能是 reuse 或 create。
3. action=reuse 时必须给出 target_question_id（来自召回候选）。
4. text 字段应为你最终确认后的标准问题表述（可与候选原文不同）。
5. method_summary/effect_summary/limitations 必须简洁明确。
6. method_summary 不得直接把 text 改写成实施步骤；应概括“可行思路类别”。
7. 只输出 XML，不要输出其他文字。

格式如下：
<final_question_set>
  <question>
    <action>reuse|create</action>
    <target_question_id>uuid-or-empty</target_question_id>
    <text>...</text>
    <method_summary>...</method_summary>
    <effect_summary>...</effect_summary>
    <limitations>...</limitations>
  </question>
</final_question_set>
""".strip()

RUNTIME_SETTING_SPECS: dict[str, dict[str, Any]] = {
    "llm_provider": {
        "label": "LLM Provider",
        "description": "模型提供方：google-genai 或 openai-compatible。",
        "is_secret": False,
        "default": DEFAULT_LLM_PROVIDER,
    },
    "google_api_key": {
        "label": "Google GenAI API Key",
        "description": "用于 Google GenAI 推理的 API Key。",
        "is_secret": True,
        "default": "",
    },
    "google_base_url": {
        "label": "Google GenAI Base URL",
        "description": "可选代理地址，不设置则使用官方默认地址。",
        "is_secret": False,
        "default": "",
    },
    "google_model": {
        "label": "Google GenAI Model",
        "description": "使用 Google Provider 时的模型名称。",
        "is_secret": False,
        "default": DEFAULT_GOOGLE_GENAI_MODEL,
    },
    "google_thinking_level": {
        "label": "Google Thinking Level",
        "description": "可选：minimal/low/medium/high，留空表示不指定。",
        "is_secret": False,
        "default": "",
    },
    "openai_api_key": {
        "label": "OpenAI Compatible API Key",
        "description": "使用 openai-compatible provider 时的 API Key。",
        "is_secret": True,
        "default": "",
    },
    "openai_base_url": {
        "label": "OpenAI Compatible Base URL",
        "description": "例如 https://api.openai.com/v1 或任意兼容网关地址。",
        "is_secret": False,
        "default": DEFAULT_OPENAI_BASE_URL,
    },
    "openai_model": {
        "label": "OpenAI Compatible Model",
        "description": "使用 openai-compatible provider 时的模型名称。",
        "is_secret": False,
        "default": "",
    },
    "knowledge_embedding_model": {
        "label": "Knowledge Embedding Model",
        "description": "知识库向量化模型（fastembed 支持的模型名）。例如 BAAI/bge-small-en-v1.5。",
        "is_secret": False,
        "default": DEFAULT_KNOWLEDGE_EMBEDDING_MODEL,
    },
    "initial_screening_temperature": {
        "label": "初筛 Temperature",
        "description": "初筛阶段温度，建议范围 0-2。",
        "is_secret": False,
        "default": DEFAULT_INITIAL_SCREENING_TEMPERATURE,
    },
    "initial_screening_system_prompt": {
        "label": "初筛 System Prompt",
        "description": "论文初筛系统提示词。",
        "is_secret": False,
        "default": DEFAULT_INITIAL_SCREENING_SYSTEM_PROMPT,
    },
    "initial_screening_user_prompt_template": {
        "label": "初筛 User Prompt 模板",
        "description": "支持占位符：{{TOP_N_CANDIDATES}} {{MAX_SELECTED_PAPERS}} {{CANDIDATES_JSON}} {{RULE_LIST}}。",
        "is_secret": False,
        "default": DEFAULT_INITIAL_SCREENING_USER_PROMPT_TEMPLATE,
    },
    "reading_stage1_system_prompt": {
        "label": "精读阶段1 System Prompt",
        "description": "阶段1（问题驱动阅读）系统提示词。",
        "is_secret": False,
        "default": DEFAULT_READING_STAGE1_SYSTEM_PROMPT,
    },
    "reading_stage1_user_prompt_template": {
        "label": "精读阶段1 User Prompt 模板",
        "description": "支持占位符：{{PAPER_ID}} {{PAPER_TITLE}} {{PAPER_AUTHORS}} {{PAPER_ORGANIZATION}} {{PAPER_SUMMARY}} {{PAPER_KEYWORDS}} {{PAPER_OCR_TEXT}}。",
        "is_secret": False,
        "default": DEFAULT_READING_STAGE1_USER_PROMPT_TEMPLATE,
    },
    "reading_stage1_temperature": {
        "label": "精读阶段1 Temperature",
        "description": "精读第一阶段温度，建议范围 0-2。",
        "is_secret": False,
        "default": DEFAULT_READING_STAGE1_TEMPERATURE,
    },
    "reading_stage2_system_prompt": {
        "label": "精读阶段2 System Prompt",
        "description": "阶段2（报告生成）系统提示词。",
        "is_secret": False,
        "default": DEFAULT_READING_STAGE2_SYSTEM_PROMPT,
    },
    "reading_stage2_user_prompt_template": {
        "label": "精读阶段2 User Prompt 模板",
        "description": "支持占位符：{{PAPER_ID}} {{PAPER_TITLE}} {{STAGE1_RESULT}} {{PAPER_OCR_TEXT}}。",
        "is_secret": False,
        "default": DEFAULT_READING_STAGE2_USER_PROMPT_TEMPLATE,
    },
    "knowledge_candidate_system_prompt": {
        "label": "知识库候选问题 System Prompt",
        "description": "知识库提炼阶段1（候选问题提炼）系统提示词。",
        "is_secret": False,
        "default": DEFAULT_KNOWLEDGE_CANDIDATE_SYSTEM_PROMPT,
    },
    "knowledge_candidate_user_prompt_template": {
        "label": "知识库候选问题 User Prompt 模板",
        "description": "支持占位符：{{PAPER_ID}} {{PAPER_TITLE}} {{PAPER_AUTHORS}} {{PAPER_ORGANIZATION}} {{PAPER_KEYWORDS}} {{FULL_REPORT}}。",
        "is_secret": False,
        "default": DEFAULT_KNOWLEDGE_CANDIDATE_USER_PROMPT_TEMPLATE,
    },
    "knowledge_final_system_prompt": {
        "label": "知识库最终问题集 System Prompt",
        "description": "知识库提炼阶段2（最终问题集决策）系统提示词。",
        "is_secret": False,
        "default": DEFAULT_KNOWLEDGE_FINAL_SYSTEM_PROMPT,
    },
    "knowledge_final_user_prompt_template": {
        "label": "知识库最终问题集 User Prompt 模板",
        "description": "支持占位符：{{PAPER_ID}} {{PAPER_TITLE}} {{PAPER_AUTHORS}} {{PAPER_ORGANIZATION}} {{PAPER_KEYWORDS}} {{CANDIDATE_XML}} {{RECALL_CONTEXT}}。",
        "is_secret": False,
        "default": DEFAULT_KNOWLEDGE_FINAL_USER_PROMPT_TEMPLATE,
    },
    "reading_stage2_temperature": {
        "label": "精读阶段2 Temperature",
        "description": "精读第二阶段温度，建议范围 0-2。",
        "is_secret": False,
        "default": DEFAULT_READING_STAGE2_TEMPERATURE,
    },
    "mistral_api_key": {
        "label": "Mistral OCR API Key",
        "description": "用于 PDF OCR 的 Key。",
        "is_secret": True,
        "default": "",
    },
    "mistral_base_url": {
        "label": "Mistral Base URL",
        "description": "OCR 接口地址。",
        "is_secret": False,
        "default": DEFAULT_MISTRAL_BASE_URL,
    },
    "mistral_ocr_model": {
        "label": "Mistral OCR Model",
        "description": "OCR 模型名称。",
        "is_secret": False,
        "default": DEFAULT_MISTRAL_OCR_MODEL,
    },
}

LLM_PROVIDER_ENV_KEYS = ("llm_provider", "LLM_PROVIDER")
GOOGLE_API_KEY_ENV_KEYS = ("api_key", "API_KEY", "GOOGLE_GENAI_API_KEY", "GENAI_API_KEY")
GOOGLE_BASE_URL_ENV_KEYS = ("base_url", "BASE_URL", "GOOGLE_GENAI_BASE_URL", "GENAI_BASE_URL")
GOOGLE_MODEL_ENV_KEYS = ("GOOGLE_GENAI_MODEL", "GENAI_MODEL")
GOOGLE_THINKING_LEVEL_ENV_KEYS = ("google_thinking_level", "GOOGLE_THINKING_LEVEL")
OPENAI_API_KEY_ENV_KEYS = ("openai_api_key", "OPENAI_API_KEY")
OPENAI_BASE_URL_ENV_KEYS = ("openai_base_url", "OPENAI_BASE_URL")
OPENAI_MODEL_ENV_KEYS = ("openai_model", "OPENAI_MODEL")
KNOWLEDGE_EMBEDDING_MODEL_ENV_KEYS = (
    "knowledge_embedding_model",
    "KNOWLEDGE_EMBEDDING_MODEL",
)
INITIAL_SCREENING_TEMPERATURE_ENV_KEYS = (
    "initial_screening_temperature",
    "INITIAL_SCREENING_TEMPERATURE",
)
READING_STAGE1_TEMPERATURE_ENV_KEYS = (
    "reading_stage1_temperature",
    "READING_STAGE1_TEMPERATURE",
)
READING_STAGE2_TEMPERATURE_ENV_KEYS = (
    "reading_stage2_temperature",
    "READING_STAGE2_TEMPERATURE",
)
MISTRAL_API_KEY_ENV_KEYS = (
    "mistral_api_key",
    "MISTRAL_API_KEY",
    "MISTRAL_KEY",
    "MISTRAL_OCR_API_KEY",
)
MISTRAL_BASE_URL_ENV_KEYS = ("mistral_base_url", "MISTRAL_BASE_URL")
MISTRAL_MODEL_ENV_KEYS = ("mistral_ocr_model", "MISTRAL_OCR_MODEL")


def first_nonempty_env(*keys: str) -> str | None:
    for key in keys:
        value = os.getenv(key)
        if value and value.strip():
            return value.strip()
    return None


def is_runtime_setting_key_supported(key: str) -> bool:
    return key in RUNTIME_SETTING_SPECS


def list_runtime_setting_keys() -> list[str]:
    return list(RUNTIME_SETTING_SPECS.keys())


def runtime_setting_spec(key: str) -> dict[str, Any]:
    return dict(RUNTIME_SETTING_SPECS[key])


async def get_runtime_setting_value(key: str) -> str | None:
    setting = await RuntimeSetting.get_or_none(key=key)
    if setting is None:
        return None
    value = setting.value.strip()
    return value or None


def default_runtime_setting_value(key: str) -> str:
    return str(RUNTIME_SETTING_SPECS[key].get("default", "") or "")


async def resolve_setting_value(
    *,
    key: str,
    env_keys: tuple[str, ...],
    default: str | None = None,
) -> str | None:
    db_value = await get_runtime_setting_value(key)
    if db_value is not None:
        return db_value
    env_value = first_nonempty_env(*env_keys)
    if env_value is not None:
        return env_value
    if default is None:
        return None
    default_clean = default.strip()
    return default_clean or None
