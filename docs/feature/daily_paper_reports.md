# 每日论文推送

平台每日从https://huggingface.co/api/daily_papers获取最新AI论文，交由后台Agent系统处理，根据用户偏好推送中文论文精读报告。

工作流：

- [论文收集](../module/paper_collection.md)：爬取每日论文元信息，存储到本地数据库。
- [论文初筛](../module/paper_filtering.md)：对论文进行筛选，得到需要精读的论文名单。
- [论文精读](../module/paper_reading.md)：对每篇论文进行精读，形成报告，推送给用户。
- [前端开发指南](./frontend_development_guide.md)：Next.js 前端实现说明（首页、报告渲染、后台记录页）。
