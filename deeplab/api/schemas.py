from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ScreeningRuleCreateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    rule: str = Field(min_length=1)
    created_by: str = Field(default="user", alias="createdBy", min_length=1, max_length=64)


class ScreeningRuleUpdateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    rule: str | None = None
    created_by: str | None = Field(default=None, alias="createdBy")


class ManualFilterRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    candidate_ids: list[str] | None = Field(default=None, alias="candidateIds")
    trigger_type: str = Field(default="manual", alias="triggerType")
    metadata: dict[str, Any] = Field(default_factory=dict)


class ManualReadingRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    paper_ids: list[str] | None = Field(default=None, alias="paperIds")
    source_filtering_run_id: str | None = Field(default=None, alias="sourceFilteringRunId")
    trigger_type: str = Field(default="manual", alias="triggerType")
    metadata: dict[str, Any] = Field(default_factory=dict)


class ManualPaperMetadataRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str = Field(min_length=1)
    authors: list[str] = Field(default_factory=list)
    summary: str = Field(min_length=1)
    organization: str | None = None
    published_at: datetime | None = Field(default=None, alias="publishedAt")
    ai_keywords: list[str] = Field(default_factory=list, alias="aiKeywords")


class ManualReadByArxivIdRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    paper_id: str = Field(alias="paperId", min_length=1)
    trigger_type: str = Field(default="manual", alias="triggerType")
    metadata: dict[str, Any] = Field(default_factory=dict)
    paper_metadata: ManualPaperMetadataRequest | None = Field(default=None, alias="paperMetadata")


class ReportCommentUpdateRequest(BaseModel):
    comment: str = ""


class RuntimeSettingUpdateRequest(BaseModel):
    value: str = ""


class KnowledgeQuestionCreateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    question: str = Field(min_length=1)
    created_by: str = Field(default="user", alias="createdBy", min_length=1, max_length=64)


class KnowledgeQuestionUpdateRequest(BaseModel):
    question: str = Field(min_length=1)


class KnowledgeNoteCreateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str = ""
    content_json: dict[str, Any] = Field(default_factory=dict, alias="contentJson")
    created_by: str = Field(default="user", alias="createdBy", min_length=1, max_length=64)


class KnowledgeNoteUpdateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str | None = None
    content_json: dict[str, Any] | None = Field(default=None, alias="contentJson")

