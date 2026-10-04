/**
 * The design of the v3 test set: 100 slots, each with the class it is meant to exercise,
 * tags, the neighbour it sits on the boundary with, and (for out_of_scope / base) whether
 * its topic is one the classifier descriptions mention. Writes data/test-spec.v3.json.
 * The target class is a design intent only; the label comes from the labeler in step 4.
 */
import { writeFileSync } from 'node:fs';

export type Tag = 'colloquial' | 'context' | 'boundary' | 'typo' | 'qn_purpose' | 'topic_listed' | 'topic_unlisted';
export interface Slot { slot: string; target: string; brief: string; tags: Tag[]; boundaryWith?: string }

const S = (target: string, brief: string, tags: Tag[], boundaryWith?: string) => ({ target, brief, tags, boundaryWith });

const spec: Omit<Slot, 'slot'>[] = [
  // search_conditions 14
  S('search_conditions', '職種と勤務地を指定して正社員の求人を探す', []),
  S('search_conditions', '時給と曜日の条件でアルバイトを探す', ['colloquial']),
  S('search_conditions', '前の検索結果を受けて、勤務地の範囲を広げて探し直してほしい', ['context']),
  S('search_conditions', '前の検索結果を受けて、雇用形態を絞り込みたい', ['context', 'colloquial']),
  S('search_conditions', '引っ越したばかりで土地勘がないまま、近くで働ける仕事を探したい(職種は未定)', ['colloquial']),
  S('search_conditions', '資格を活かせる仕事を探したい(資格名を出す)', []),
  S('search_conditions', '職種名に誤字があるが、目的は仕事探し', ['typo']),
  S('search_conditions', '地名をひらがなで書いて仕事を探す', ['typo', 'colloquial']),
  S('search_conditions', '地元の人が使う地名の略称・愛称(正式な地名ではないもの)を必ず1つ入れ、事務以外の職種と働き方の条件も付けて仕事を探す(目的は仕事探し)', ['boundary', 'colloquial'], 'query_normalization'),
  S('search_conditions', '職種の略語を含めて仕事を探す(目的は仕事探し)', ['boundary'], 'query_normalization'),
  S('search_conditions', '検索結果が1件しか出ず、条件のせいか不具合か分からないと言いつつ、もっと見たい(画面は正常に動いている)', ['boundary', 'colloquial'], 'error_handling'),
  S('search_conditions', '天気や体調の雑談をしつつ、条件を言って仕事を探す', ['boundary', 'colloquial'], 'out_of_scope'),
  S('search_conditions', 'アシスタントの「この条件で探しますか?」に対する短い肯定の返事', ['context']),
  S('search_conditions', '通勤時間の上限を条件に仕事を探す', ['colloquial']),
  // query_normalization 6 (all: the purpose is the renaming itself)
  S('query_normalization', '求人の勤務地に書かれた「〇〇エリア」のような広い呼び方が、どの市まで含むのか知りたい', ['qn_purpose']),
  S('query_normalization', '職種の略語が何の職種のことか知りたい', ['qn_purpose', 'colloquial']),
  S('query_normalization', '求人の勤務地に書かれた難しい地名の読み方を知りたい(仕事探しそのものではない)', ['qn_purpose', 'boundary'], 'search_conditions'),
  S('query_normalization', '自分の住んでいる地域の呼び方で検索して通じるか確かめたい', ['qn_purpose']),
  S('query_normalization', '前の会話で出てきた略称の正式名称を聞き返す', ['qn_purpose', 'context']),
  S('query_normalization', 'カタカナ職種名の正しい表記を確かめたい', ['qn_purpose', 'typo']),
  // company_info 7
  S('company_info', '特定の企業の事業内容以外の公式情報(設立年・従業員数など)を知りたい', []),
  S('company_info', '特定の企業の公開されている数値(離職率など)を知りたい', ['colloquial']),
  S('company_info', '前の会話で出た企業の拠点や本社について知りたい', ['context']),
  S('company_info', 'スカウトが来た企業の規模を知りたい', ['colloquial']),
  S('company_info', '特定の企業の社内制度(在宅勤務の制度など)について知りたい', ['boundary'], 'salary_benefits'),
  S('company_info', '特定の企業の公開データを知りたいが、評判にも触れる', ['boundary'], 'reviews'),
  S('company_info', '企業名に誤字があるが、その企業の公式情報を知りたい', ['typo']),
  // reviews 7
  S('reviews', '特定の企業で、子育てしながら働いている人のクチコミがあるか知りたい', ['colloquial']),
  S('reviews', '前の会話で出た企業のクチコミで、良い評価と悪い評価の割合を知りたい', ['context']),
  S('reviews', '特定の企業の上司や人間関係についてのクチコミを知りたい', []),
  S('reviews', '自分が以前投稿したクチコミを後から消したい', ['colloquial']),
  S('reviews', '特定の企業の残業の実態について、働いた人の感想を知りたい', ['boundary'], 'company_info'),
  S('reviews', '面接の前に、その会社の社員がどんな人たちかをクチコミで知っておきたい', ['boundary'], 'interview_prep'),
  S('reviews', 'クチコミの点数の見方を知りたい', []),
  // salary_benefits 9
  S('salary_benefits', '求人票の給与表記の意味を知りたい', []),
  S('salary_benefits', '賞与からも税金や保険料が引かれるのか知りたい', ['colloquial']),
  S('salary_benefits', '休日の表記の違いを知りたい', []),
  S('salary_benefits', '前の会話で表示した求人の手当について聞く', ['context', 'boundary'], 'base'),
  S('salary_benefits', '同じ職種で、正社員と派遣とで時給に直したときの差の目安を知りたい', ['colloquial']),
  S('salary_benefits', '試用期間中は給与が下がると書かれているのが一般的なことか知りたい', ['colloquial']),
  S('salary_benefits', '一般的な福利厚生の言葉の意味を知りたい(特定の企業ではない)', ['boundary'], 'company_info'),
  S('salary_benefits', '待遇の条件そのものを比べたい(面接での話し方ではない)', ['boundary'], 'interview_prep'),
  S('salary_benefits', '残業代の計算について知りたい', ['typo']),
  // career_advice 8
  S('career_advice', '管理職への昇進の話が来ていて、専門職を続けるか迷っている', ['colloquial']),
  S('career_advice', '人と話す仕事と数字を扱う仕事のどちらの道に進むか決められない', []),
  S('career_advice', '契約社員から正社員になりたいが、何を準備すればいいか', ['colloquial']),
  S('career_advice', '経験のない分野に挑戦したいが、何から考えればいいか', []),
  S('career_advice', '前の会話を受けて、強みの整理を手伝ってほしい', ['context']),
  S('career_advice', '残業が多くて辞めたいが、給料は良いので迷っている', ['boundary'], 'salary_benefits'),
  S('career_advice', '方向性に迷っていて、求人を見る前に自分の考えを整理したい', ['boundary', 'colloquial'], 'search_conditions'),
  S('career_advice', '地方へ移住しても今の職種で働き続けられるか迷っている', ['typo']),
  // application_docs 8
  S('application_docs', '履歴書の書き方の基本を知りたい', []),
  S('application_docs', '志望動機を応募先ごとに書き分けるコツを知りたい', []),
  S('application_docs', '派遣で働いていた期間を職務経歴書にどうまとめるか', ['colloquial']),
  S('application_docs', '前の会話を受けて、自己PRの書き直しを頼む', ['context']),
  S('application_docs', '退職理由の書き方', ['colloquial']),
  S('application_docs', '書類と面接の両方に関わるが、主に書類の書き方を知りたい', ['boundary'], 'interview_prep'),
  S('application_docs', '応募の操作ではなく、応募フォームの自由記述欄に書く内容を相談したい', ['boundary', 'context'], 'base'),
  S('application_docs', '資格欄の書き方', ['typo']),
  // interview_prep 8
  S('interview_prep', '面接の最後に「何か一言」と言われたときに何を話すか', ['colloquial']),
  S('interview_prep', '面接のあとにお礼のメールを送るべきか、送るなら何を書くか', []),
  S('interview_prep', 'オンライン面接の準備', ['colloquial']),
  S('interview_prep', '前の会話を受けて、面接での答えの練習を続ける', ['context']),
  S('interview_prep', '面接で希望の待遇を聞かれたときの答え方', ['boundary'], 'salary_benefits'),
  S('interview_prep', '書類に書いた内容を面接でどう話すか', ['boundary'], 'application_docs'),
  S('interview_prep', '前の会話で表示した求人の選考について、面接の準備として聞く', ['boundary', 'context'], 'base'),
  S('interview_prep', '面接の服装', ['typo', 'colloquial']),
  // account_terms 7
  S('account_terms', '登録情報の変更', []),
  S('account_terms', '通知を止めたい', ['colloquial']),
  S('account_terms', '退会したあと、同じメールアドレスでまた登録できるか', []),
  S('account_terms', 'サインインのたびに届く確認コードの仕組みを止めたい', ['colloquial']),
  S('account_terms', '応募を取り下げたら、送った情報は応募先で消してもらえるか', ['context']),
  S('account_terms', 'サインインに使うメールアドレスそのものを忘れてしまった', ['boundary'], 'error_handling'),
  S('account_terms', '利用規約の確認', ['typo']),
  // error_handling 7
  S('error_handling', '求人の写真が表示されず、灰色の四角のままになる', ['colloquial']),
  S('error_handling', '保存した求人の一覧を開くとエラーコードが表示される', []),
  S('error_handling', '前の会話でツールが失敗したことについて、何が起きたのか尋ねる', ['context']),
  S('error_handling', 'アプリが落ちる', ['colloquial']),
  S('error_handling', 'サインインはできるのに、マイページを開くと毎回サインアウトされる', ['boundary'], 'account_terms'),
  S('error_handling', '検索の画面自体が動かない(結果が0件なのではない)', ['boundary'], 'search_conditions'),
  S('error_handling', '表示が崩れる', ['typo']),
  // out_of_scope 9: 4 listed topics, 5 unlisted topics
  S('out_of_scope', '説明文に挙げた話題: 料理の相談', ['topic_listed', 'colloquial']),
  S('out_of_scope', '説明文に挙げた話題: プログラミングの質問', ['topic_listed']),
  S('out_of_scope', '説明文に挙げた話題: 天気の雑談だけ(求人の相談を含まない)', ['topic_listed']),
  S('out_of_scope', '説明文に挙げた話題: 規則を逃れる不適切な依頼(応募書類の経歴を偽る)', ['topic_listed', 'boundary'], 'application_docs'),
  S('out_of_scope', '挙げていない話題: 投資の相談', ['topic_unlisted', 'colloquial']),
  S('out_of_scope', '挙げていない話題: 恋愛相談', ['topic_unlisted']),
  S('out_of_scope', '挙げていない話題: 翻訳の依頼', ['topic_unlisted']),
  S('out_of_scope', '挙げていない話題: 旅行の計画', ['topic_unlisted', 'colloquial']),
  S('out_of_scope', '挙げていない話題: 家電の選び方', ['topic_unlisted', 'context']),
  // base 10: 5 listed topics, 5 unlisted topics
  S('base', '説明文に挙げた話題: あいさつ(仕事終わりに立ち寄った、など一言添える)', ['topic_listed']),
  S('base', '説明文に挙げた話題: 返事(前の会話でアシスタントが提案したことを、今はいらないと断る。お礼や理解を伝えるだけの返事にはしない)', ['topic_listed', 'context']),
  S('base', '説明文に挙げた話題: ツールの操作だけで済む依頼(保存の解除など)', ['topic_listed', 'context', 'colloquial']),
  S('base', '説明文に挙げた話題: 心身の不調の訴え', ['topic_listed']),
  S('base', '説明文に挙げた話題: ツールの操作だけで済む依頼(分野の相談を含まない、前の会話で表示した求人について)', ['topic_listed', 'context', 'boundary'], 'salary_benefits'),
  S('base', '挙げていない話題: アシスタント自身についての質問', ['topic_unlisted', 'colloquial', 'boundary'], 'out_of_scope'),
  S('base', '挙げていない話題: 相談を含まない近況の報告', ['topic_unlisted', 'colloquial']),
  S('base', '挙げていない話題: 少し待ってほしいと伝える', ['topic_unlisted', 'context']),
  S('base', '挙げていない話題: さっきの自分の発言の言い直し・訂正(内容は相談を含まない)', ['topic_unlisted', 'context']),
  S('base', '挙げていない話題: 話を区切って、また今度にすると伝える', ['topic_unlisted', 'typo']),
];

const slots: Slot[] = spec.map((s, i) => ({ slot: `t${String(i + 1).padStart(3, '0')}`, ...s }));
if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync('data/test-spec.v3.json', `${JSON.stringify({ slots }, null, 2)}\n`);
  const by = (f: (s: Slot) => boolean) => slots.filter(f).length;
  const classes = [...new Set(slots.map((s) => s.target))];
  console.log('total', slots.length);
  console.log(Object.fromEntries(classes.map((c) => [c, by((s) => s.target === c)])));
  for (const t of ['colloquial', 'context', 'boundary', 'typo', 'qn_purpose', 'topic_listed', 'topic_unlisted'] as Tag[]) console.log(t, by((s) => s.tags.includes(t)));
}
export { slots };
