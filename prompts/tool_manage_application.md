---
id: tool_manage_application
kind: selectable
summary: 応募・お気に入り登録・応募状況の確認・応募の取り消しを行うツール manage_application の定義と使い方
summary_en: Definition and usage of manage_application, which applies to jobs, saves favorites, checks application status, and withdraws applications
use_when: ユーザーが応募したい・お気に入り(保存)したい・応募状況や選考結果を確認したい・応募や辞退を取り消したいと言っている
use_when_en: The user wants to apply, save a job to favorites, check application/selection status, or withdraw an application
not_when: 応募・保存・応募状況の操作や確認が不要
not_when_en: No apply/save/status action or check is needed
---
# ツール: manage_application

応募やお気に入りの操作をします。ユーザーの代わりに送信する操作なので、必ず確認を取ります。

## 定義
```json
{
  "name": "manage_application",
  "description": "求人への応募、お気に入り登録・解除、応募状況の取得、応募の取り消しを行う",
  "input_schema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["apply", "favorite_add", "favorite_remove", "list_status", "withdraw"]
      },
      "job_id": {
        "type": "string",
        "description": "list_status 以外で必須"
      },
      "message": {
        "type": "string",
        "maxLength": 1000,
        "description": "apply のときに企業へ送る応募メッセージ(任意)"
      },
      "confirmed": {
        "type": "boolean",
        "description": "apply と withdraw では、ユーザーの明示的な同意を得た後に true にする"
      }
    },
    "required": ["action"]
  }
}
```

## 返り値
- apply: { status: "submitted" | "needs_profile" | "closed" | "duplicate", missing_fields? }
- favorite_add / favorite_remove: { status: "ok" }
- list_status: { applications: [{ job_id, title, company_name, applied_at,
  stage: "submitted" | "screening" | "interview" | "offer" | "rejected" | "withdrawn" }] }
- withdraw: { status: "withdrawn" | "not_found" }

## 使い方
### 応募(apply)
1. 応募する求人を特定する(会話から一意に決まらなければ確認する)。
2. 求人名と企業名を示し、「この求人に応募してよいですか」と確認する。
3. 応募メッセージを添えるか聞く(任意)。添える場合は、下書きを示して確認する。
4. ユーザーが同意したら confirmed: true で呼ぶ。
- needs_profile が返ったら、missing_fields を示し、Web履歴書の入力を案内する([[page:resume_builder]])。
- closed が返ったら、掲載終了を伝え、似た求人の検索を提案する。
- duplicate が返ったら、すでに応募済みであることを伝える。

### お気に入り(favorite_add / favorite_remove)
- 「保存して」「キープ」「あとで見る」→ favorite_add。確認は不要。
- お気に入り一覧は [[page:favorites]] で見られると案内する。

### 応募状況(list_status)
- 「応募したやつどうなってる?」「結果来た?」→ list_status。
- stage をユーザー向けの言葉に直して伝える(screening→書類選考中、interview→面接の段階 など)。
- rejected を伝えるときは、事実だけを簡潔に伝え、次の行動を1つ提案する。
- 選考の見通しや合否の予想は言わない。

### 取り消し(withdraw)
- 応募の取り消しは元に戻せないことを伝え、確認を取ってから confirmed: true で呼ぶ。
- 面接日程が決まっている場合は、企業へ一言連絡することを勧める。

## してはいけないこと
- 確認を取らずに apply / withdraw を実行しない。
- 「とりあえず全部応募しておきます」のような一括応募を提案しない。
- 応募メッセージに、ユーザーが言っていない経歴や意欲を書き足さない。

## 呼び出し例
ユーザー: じゃあさっきの2つ目、応募でお願いします
(確認後)
```json
{ "action": "apply", "job_id": "J-31877", "confirmed": true }
```
