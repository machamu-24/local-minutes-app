"""
summary_templates.py
要約テンプレート定義。
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class SummaryTemplateDefinition:
    """要約テンプレート定義"""

    name: str
    label: str
    description: str
    chunk_guidance: str
    final_guidance: str
    markdown_template: str


SUMMARY_TEMPLATE_LIST = [
    SummaryTemplateDefinition(
        name="general",
        label="汎用議事録",
        description=(
            "標準的な会議議事録です。議題、主な議論、決定事項、次のアクションを"
            "バランスよく整理します。"
        ),
        chunk_guidance=(
            "- 議題、主要な論点、決定事項、保留事項、次のアクションにつながる情報を抜き出す\n"
            "- 発言の細部よりも、会議全体の合意内容と論点の流れを優先する"
        ),
        final_guidance=(
            "- 各セクションは簡潔に整理する\n"
            "- 決定事項とアクションは箇条書き中心でまとめる\n"
            "- 背景説明が長くなりすぎる場合は要点だけに絞る"
        ),
        markdown_template="""# 議事録

## 基本情報
- 会議名: {title}
- 日付: {meeting_date}

## 議題・目的

## 主な議論内容

## 決定事項

## 次のアクション・TODO

## その他・備考
""",
    ),
    SummaryTemplateDefinition(
        name="decision_log",
        label="決定事項重視",
        description=(
            "意思決定の記録を重視するテンプレートです。決まったことと、その背景や"
            "未決事項を優先して整理します。"
        ),
        chunk_guidance=(
            "- 決定事項、判断理由、採用しなかった案、保留事項を優先して抽出する\n"
            "- だれが何を懸念し、どの条件で判断したかが分かる情報を残す"
        ),
        final_guidance=(
            "- 「決定事項」と「決定理由・背景」は明確に分ける\n"
            "- 未決事項は次回確認ポイントが分かる形で簡潔にまとめる\n"
            "- アクションがある場合は担当や期限の有無も明記する"
        ),
        markdown_template="""# 議事録

## 基本情報
- 会議名: {title}
- 日付: {meeting_date}

## 要点サマリー

## 決定事項

## 決定理由・背景

## 未決事項

## 次のアクション・TODO
""",
    ),
    SummaryTemplateDefinition(
        name="action_items",
        label="アクション重視",
        description=(
            "会議後の実務対応を重視するテンプレートです。担当・期限・依存関係が"
            "分かるように整理します。"
        ),
        chunk_guidance=(
            "- タスク、宿題、確認事項、依頼事項、担当者、期限に関する記述を優先して抽出する\n"
            "- 実務上の前提条件、依存関係、リスクも後続作業に必要なら残す"
        ),
        final_guidance=(
            "- 「タスク一覧」は担当・期限・内容が追いやすい箇条書きで記載する\n"
            "- 担当や期限が不明な場合は「（未記載）」と明示する\n"
            "- リスクや依存関係は実務上の支障が分かる書き方にする"
        ),
        markdown_template="""# 議事録

## 基本情報
- 会議名: {title}
- 日付: {meeting_date}

## 会議サマリー

## タスク一覧

## 確認事項・依存関係

## リスク・懸念

## その他・備考
""",
    ),
]

SUMMARY_TEMPLATES = {template.name: template for template in SUMMARY_TEMPLATE_LIST}


def get_summary_template(template_name: str) -> SummaryTemplateDefinition:
    """テンプレート名から定義を取得する。"""
    template = SUMMARY_TEMPLATES.get(template_name)
    if not template:
        raise ValueError(f"未対応の要約テンプレートです: {template_name}")
    return template


def list_summary_templates() -> list[dict[str, str]]:
    """フロント表示用のテンプレート一覧を返す。"""
    return [
        {
            "name": template.name,
            "label": template.label,
            "description": template.description,
        }
        for template in SUMMARY_TEMPLATE_LIST
    ]
