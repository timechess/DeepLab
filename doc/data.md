# 数据表格式

本文档主要描述该应用中Sqlite数据库中存储的数据表格式，可根据该文档生成对应初始化用的sql文件。注意下面的所有数据模型默认添加createdAt和updatedAt属性。

## RuntimeSetting

运行时配置，随时可能新增新的属性，全局唯一。

| 属性                 | 描述                                  |
| -------------------- | ------------------------------------- |
| id                   | id                                    |
| provider             | google/openai compatible两种          |
| base_url             | base_url字符串                        |
| api_key              | 字符串                                |
| model_name           | 模型名                                |
| ocr_provider         | 目前仅mistral_ai                      |
| ocr_base_url         | base_url字符串                        |
| ocr_api_key          | 字符串                                |
| ocr_model            | ocr模型名                             |
| thinking_level       | google模型推理等级（low/medium/high） |
| temperature          | 推理温度（浮点数）                    |
| paper_filter_prompt  | 论文初筛模板提示词                    |
| paper_reading_prompt | 论文精读模板提示词                    |
| work_report_prompt   | 工作报告总结模板提示词                |

## Paper

从huggingface daily paper api抓取的论文记录。

| 属性         | 描述                  |
| ------------ | --------------------- |
| id           | arxiv id              |
| title        | 论文标题              |
| authors      | 论文作者列表          |
| organization | 论文组织              |
| summary      | 论文摘要              |
| ai_summary   | AI总结的论文摘要      |
| ai_keywords  | AI总结的论文关键词    |
| upvotes      | 论文获得的赞          |
| githubRepo   | Github链接，可能为空  |
| githubStars  | Github Star，可能为空 |
| publishedAt  | 发表日期              |
| report       | 关联的论文精读报告    |

## Rule

用于论文初筛的用户自定义规则。

| 属性    | 描述     |
| ------- | -------- |
| id      | id       |
| content | 规则内容 |

## PaperReport

由AI根据论文内容生成的精读报告，含用户评论。

| 属性        | 描述                                                          |
| ----------- | ------------------------------------------------------------- |
| id          | id                                                            |
| paper       | 关联的论文                                                    |
| workflow_id | 关联工作流id（可能为空）                                      |
| source      | 元信息来源（`huggingface` 或 `arxiv`）                        |
| ocr_model   | OCR模型名                                                     |
| status      | 报告状态（`running` / `ready` / `failed`）                    |
| error       | 失败错误信息（仅失败时）                                      |
| comment     | 用户的评论（初始为空）                                        |
| report      | AI返回的报告正文（Markdown，仅在精读链路成功后写入/更新该字段） |

## Task

任务列表。

| 属性          | 描述            |
| ------------- | --------------- |
| id            | id              |
| title         | 任务标题        |
| description   | 任务描述        |
| priority      | low/meidum/high |
| completedDate | 完成日期（初始为空） |

## Note

双链笔记。

| 属性        | 描述                   |
| ----------- | ---------------------- |
| id          | id                     |
| title       | 标题                   |
| content     | 笔记内容（json字符串） |
| linkedPaper | 链接到的数据库中论文   |
| linkedTask  | 链接到的任务           |
| linkedNote  | 链接到的笔记           |

## BehaviorSnapshot

每次工作日报生成时对数据库中用户行为进行快照，全局唯一，每次更新。

| 属性     | 描述                                             |
| -------- | ------------------------------------------------ |
| id       | id                                               |
| tasks    | 任务列表，包含当时每个任务的json格式数据         |
| comments | 当前具有用户评论的所有论文精读报告的id与评论     |
| notes    | 当前所有笔记的id以及以Markdown格式存储的笔记内容 |

## WorkReport

由AI根据用户行为数据生成的工作汇总报告。

| 属性       | 描述                                             |
| ---------- | ------------------------------------------------ |
| id         | id                                               |
| statistics | 与上次快照相比新增的用户行为统计，以json格式存储 |
| report     | AI生成的工作报告（Markdown）                     |
| startDate  | 统计起始日期                                     |
| endDate    | 统计结束日期                                     |

## LLMInvocationLog

调用LLM时的输入输出记录。

| 属性           | 描述                  |
| -------------- | --------------------- |
| id             | id                    |
| base_url       | base_url              |
| model          | 模型名                |
| prompt         | 输入的提示词列表      |
| output         | 模型输出的文本        |
| inputToken     | 输入token数           |
| outputToken    | 输出token数（含思考） |
| temperature    | 推理温度              |
| thinking_level | 推理等级              |

## Workflow

工作流。

| 属性    | 描述                   |
| ------- | ---------------------- |
| id      | id                     |
| name    | 工作流名称             |
| stage   | 进行中/成功/失败       |
| error   | 报错信息               |
| payload | 工作流相关信息（json） |
