# 论文收集

每日从https://huggingface.co/api/daily_papers收集最新论文，获取元信息如下表：

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

抓取后，加上抓取时时间 `collectedAt`，存入数据库中。数据库类型定义见[model.py](../../deeplab/model.py)。

```python
class Paper(Model):
    id = fields.CharField(max_length=32, pk=True, description="ArXiv ID")
    title = fields.TextField(description="Paper title")
    authors = fields.JSONField(default=list, description="Author list")
    organization = fields.TextField(null=True, description="Organization")
    summary = fields.TextField(description="Paper abstract")
    ai_summary = fields.TextField(null=True, description="AI-generated abstract summary")
    ai_keywords = fields.JSONField(default=list, description="AI-generated keywords")
    upvotes = fields.IntField(default=0, description="Upvote count")
    github_repo = fields.CharField(
        max_length=500,
        null=True,
        source_field="githubRepo",
        description="GitHub repository URL",
    )
    github_stars = fields.IntField(
        null=True,
        source_field="githubStars",
        description="GitHub repository stars",
    )
    published_at = fields.DatetimeField(
        source_field="publishedAt",
        description="Publication datetime",
    )
    collected_at = fields.DatetimeField(
        auto_now_add=True,
        source_field="collectedAt",
        index=True,
        description="Record collection datetime",
    )

    class Meta:
        table = "papers"
        ordering = ["-collected_at"]
```