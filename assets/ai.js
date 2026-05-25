/* ============================================================
   AILab — 무료 LLM API 기반 AI 분석 보조 (멀티 프로바이더)
   지원: Google Gemini · Groq
   사용처: reels-lab, carousel-lab
   ============================================================ */
(function () {
  const K_PROVIDER = 'ailab_provider';
  const K_KEY = (p) => `ailab_key_${p}`;
  const K_MODEL = (p) => `ailab_model_${p}`;
  // 레거시 호환
  const LEGACY_GEMINI_KEY = 'gemini_api_key';
  const LEGACY_GEMINI_MODEL = 'gemini_model';

  /* ---------- 프로바이더 정의 ---------- */
  const PROVIDERS = {
    groq: {
      label: 'Groq',
      tagline: '가장 빠름 · 한국에서 안정적 · 분당 30회',
      keyUrl: 'https://console.groq.com/keys',
      keyHint: '발급: console.groq.com/keys (구글/깃허브 로그인) · gsk_... 형식 · 카드 등록 불필요',
      keyPrefix: 'gsk_',
      defaultModel: 'llama-3.3-70b-versatile',
      models: [
        { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (권장 · 한국어 강함)' },
        { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (가장 빠름)' },
        { id: 'gemma2-9b-it', label: 'Gemma 2 9B (Google)' },
        { id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B (있다면)' }
      ],
      async call(model, key, prompt) {
        const url = 'https://api.groq.com/openai/v1/chat/completions';
        const sys = 'You MUST respond with ONLY a single valid JSON object. No markdown fences. No code blocks. No prose before or after. Output must start with { and end with }. All values must be strings. Use Korean inside string values.';
        const baseBody = {
          model,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7
        };

        async function send(useJsonMode) {
          const body = useJsonMode
            ? { ...baseBody, response_format: { type: 'json_object' } }
            : baseBody;
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${key}`
            },
            body: JSON.stringify(body)
          });
          if (!res.ok) {
            let msg = `HTTP ${res.status}`;
            try { const e = await res.json(); msg = e.error?.message || msg; } catch (_) {}
            const err = new Error(msg);
            err.status = res.status;
            throw err;
          }
          const data = await res.json();
          const text = data.choices?.[0]?.message?.content;
          if (!text) throw new Error('Groq 응답이 비어있어요');
          return parseJsonLoose(text);
        }

        // 1차: JSON 모드 시도
        try {
          return await send(true);
        } catch (err) {
          const m = String(err.message || '');
          // JSON 생성 실패면 모드 끄고 재시도 (프롬프트의 강한 지시로 JSON 받기)
          if (m.includes('Failed to generate JSON') || m.includes('json_object') || m.includes('JSON 파싱 실패')) {
            return await send(false);
          }
          throw err;
        }
      }
    },
    gemini: {
      label: 'Google Gemini',
      tagline: '무료 한도 큼 · 분당 15회 · 하루 1,500회',
      keyUrl: 'https://aistudio.google.com/apikey',
      keyHint: '발급: aistudio.google.com/apikey (구글 로그인) · AIza... 형식 · 카드 불필요',
      keyPrefix: 'AIza',
      defaultModel: 'gemini-2.0-flash',
      models: [
        { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (권장)' },
        { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite (가장 빠름)' },
        { id: 'gemini-1.5-flash-latest', label: 'Gemini 1.5 Flash (안정)' },
        { id: 'gemini-1.5-pro-latest', label: 'Gemini 1.5 Pro (정확)' }
      ],
      async call(model, key, prompt, schema) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
        const body = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.7
          }
        };
        if (schema) body.generationConfig.responseSchema = schema;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try { const e = await res.json(); msg = e.error?.message || msg; } catch (_) {}
          throw new Error(msg);
        }
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Gemini 응답이 비어있어요');
        return parseJsonLoose(text);
      }
    }
  };

  /* ---------- 헬퍼 ---------- */
  function parseJsonLoose(text) {
    if (!text) throw new Error('JSON 파싱 실패: 빈 응답');
    // 1) 그대로 파싱
    try { return JSON.parse(text); } catch (_) {}
    // 2) ```json ... ``` 또는 ``` ... ``` 코드블록 제거 후 파싱
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) {
      try { return JSON.parse(fence[1].trim()); } catch (_) {}
    }
    // 3) 첫 { 부터 마지막 } 까지 추출
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch (_) {}
      // 3-1) trailing comma 제거 시도
      try { return JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1')); } catch (_) {}
    }
    throw new Error('JSON 파싱 실패');
  }

  function getProvider() {
    let p = localStorage.getItem(K_PROVIDER);
    if (!p) {
      // 레거시: gemini_api_key 가 있으면 gemini를 기본
      if (localStorage.getItem(LEGACY_GEMINI_KEY)) p = 'gemini';
      else p = 'groq';
    }
    return PROVIDERS[p] ? p : 'groq';
  }
  function setProvider(p) { localStorage.setItem(K_PROVIDER, p); }

  function getApiKey(provider) {
    const p = provider || getProvider();
    let v = localStorage.getItem(K_KEY(p));
    if (!v && p === 'gemini') v = localStorage.getItem(LEGACY_GEMINI_KEY);
    return v || '';
  }
  function setApiKey(provider, v) { localStorage.setItem(K_KEY(provider), v); }
  function clearApiKey(provider) {
    localStorage.removeItem(K_KEY(provider));
    if (provider === 'gemini') localStorage.removeItem(LEGACY_GEMINI_KEY);
  }

  function getModel(provider) {
    const p = provider || getProvider();
    let v = localStorage.getItem(K_MODEL(p));
    if (!v && p === 'gemini') v = localStorage.getItem(LEGACY_GEMINI_MODEL);
    return v || PROVIDERS[p].defaultModel;
  }
  function setModel(provider, v) { localStorage.setItem(K_MODEL(provider), v); }

  /* ---------- 분석 호출 ---------- */
  async function analyze(prompt, schema) {
    const p = getProvider();
    const key = getApiKey(p);
    if (!key) throw new Error(`${PROVIDERS[p].label} API 키를 먼저 저장해주세요`);
    const model = getModel(p);
    return PROVIDERS[p].call(model, key, prompt, schema);
  }

  /* ---------- 프롬프트 + 스키마 ---------- */
  const SCHEMAS = {
    reels: {
      type: 'OBJECT',
      properties: {
        hook: { type: 'STRING' },
        script: { type: 'STRING' },
        captionStyle: { type: 'STRING' },
        bgm: { type: 'STRING' },
        editing: { type: 'STRING' },
        framing: { type: 'STRING' },
        commentSentiment: { type: 'STRING' },
        topComments: { type: 'STRING' },
        insight: { type: 'STRING' },
        action: { type: 'STRING' },
        tags: { type: 'STRING' }
      },
      required: ['hook', 'script', 'commentSentiment', 'topComments', 'insight', 'action', 'tags']
    },
    carousel: {
      type: 'OBJECT',
      properties: {
        hook: { type: 'STRING' },
        coverPattern: { type: 'STRING' },
        script: { type: 'STRING' },
        color: { type: 'STRING' },
        font: { type: 'STRING' },
        layout: { type: 'STRING' },
        graphic: { type: 'STRING' },
        commentSentiment: { type: 'STRING' },
        topComments: { type: 'STRING' },
        insight: { type: 'STRING' },
        action: { type: 'STRING' },
        tags: { type: 'STRING' }
      },
      required: ['hook', 'script', 'commentSentiment', 'topComments', 'insight', 'action', 'tags']
    }
  };

  function buildPrompt(type, meta) {
    const brandContext = `
[부상구 채널 컨텍스트 — action 항목에 반드시 반영]
· 운영자: 고졸 20대 인플루언서. 자수성가로 순자산 10억대. 인스타 재테크 교육 사업.
· 타겟: 2030 사회초년생·신혼부부·재테크 입문자 (월급 200~350만, 모은돈 1,000~5,000만)
· 포지셔닝: "전문가"가 아니라 "먼저 해본 동반자". "내가 가르쳐줄게" 톤 금지.
· 말투: 친구에게 설명하듯 편안하게. "같이 알아보자". 전문용어 나열 금지.
· 카피 원칙: 공포 마케팅 금지. 구체 시나리오 우선("월급 200만, ETF 첫 매수 따라하기" / "1도 모르는 사람이 내집마련 시작하기").
· 가치 사다리: 무료 교육 → 포트폴리오·가계부 점검 → 보험 컨설팅.
· 마스코트: 초록 새싹펭귄 (사용자 인스타 프로필 캐릭터).
`;

    const inputs = `
[기본 정보]
계정: ${meta.account || '미입력'}
카테고리: ${meta.category || '미입력'}
URL: ${meta.url || '미입력'}
${meta.views ? `조회수: ${meta.views}\n` : ''}${meta.likes ? `좋아요: ${meta.likes}\n` : ''}${meta.saves ? `저장수: ${meta.saves}\n` : ''}${meta.slides ? `슬라이드 수: ${meta.slides}장\n` : ''}${meta.duration ? `영상 길이: ${meta.duration}초\n` : ''}
[캡션 (게시물 본문)]
${meta.caption || '(미입력 — 댓글과 메타 정보로 추정)'}

[좋아요 많은 댓글 (사용자가 복사한 원문)]
${meta.comments || '(미입력 — 캡션으로 추정)'}
`;

    if (type === 'reels') {
      return `당신은 한국 인스타그램 릴스 분석 전문가이자 콘텐츠 전략가입니다.
당신의 분석은 부상구 채널의 다음 콘텐츠 기획에 직접 사용됩니다 — 두루뭉술 금지, 구체적이고 깊이 있게.
${brandContext}${inputs}
${meta.script ? `[영상 받아쓰기 스크립트 - 사용자 입력]\n${meta.script}\n` : ''}

[작업]
캡션·댓글·메타 정보를 종합 분석하여 다음 11개 항목을 한국어로 작성합니다.
캡션이나 댓글에 정보가 부족해도 "추정"하여 채우세요. 비워두지 마세요. 단순 반복·일반론 금지.

1. hook (15~25자 한 줄)
   - 첫 3초에 등장했을 것으로 추정되는 가장 강한 훅 문장
   - 캡션 첫 줄·자막 추정·댓글에서 자주 인용된 표현을 단서로
   - 숫자·반전·역질문·구체 시나리오 중 가장 강한 패턴 사용

2. script (영상 흐름 추정, 시간 표기 포함)
   - 사용자 입력 스크립트가 있으면 그것 기준, 없으면 캡션·댓글로 추정
   - "00:00 [장면 묘사 + 자막/대사]" 형식, 5~8개 구간으로 구분
   - 영상 길이가 ${meta.duration || '?'}초임을 고려
   - 마지막에 CTA 장면 반드시 포함

3. captionStyle (자막 스타일 추정, 한 줄)
   - 글자 크기·컬러·강조 패턴 (예: "큰 굵은 검정 + 노란 형광펜 키워드 강조")

4. bgm (BGM·사운드 분위기 추정, 한 줄)
   - 카테고리·톤에 맞춰 추정 (예: "트렌드 챌린지 사운드 / 잔잔한 로파이 피아노")

5. editing (편집 기법 추정, 한 줄)
   - 컷 패턴·B-roll·전환 효과 (예: "점프컷 다수 + 정보 슬라이드 인서트 2~3개")

6. framing (촬영 구도 추정, 한 줄)
   - 카메라 각도·인물 배치 (예: "토킹헤드 정면 + 화면 분할 자료")

7. commentSentiment (4~6줄, 구체적으로)
   - 감정 분포 % (공감/질문/감탄/반발 등) + 자주 등장한 단어 TOP 5 + 자주 나온 질문 3개
   - "공감 많음" 같은 일반론 금지 — 실제 댓글에서 단서를 인용

8. topComments (3~5개, 원문 그대로)
   - 입력 댓글 중 가장 임팩트 있는 것 그대로 옮기기 (창작 X)
   - 줄바꿈으로 구분, 각 댓글 끝에 "→ (왜 임팩트인지 한 줄 분석)" 추가

9. insight (왜 터졌는가 — 6~10줄, 가설 3개+)
   - 단순 "훅이 강함" 금지. 구체 메커니즘 분석:
     * 가설 1: 알고리즘 측면 (저장률·완시청률·댓글률 중 어디가 강했을지)
     * 가설 2: 페인포인트 측면 (타겟의 어떤 막힘을 정확히 짚었나)
     * 가설 3: 포맷·전달 측면 (스토리텔링·숫자·반전·구체성 중 무엇이 작동)
   - 각 가설마다 "왜 그렇게 추정하는지" 근거 (댓글·캡션 인용)

10. action (부상구 채널 적용 아이디어 — 시나리오 3개, 구체적으로)
    각 시나리오마다 다음 구조로:
    · 주제: (예) "월급 230만, ETF 첫 매수 따라하기"
    · 훅 (3초): (예) "월급 230만으로 ETF 시작해봤어"
    · 흐름: 3~5줄로 영상 구조 요약
    · CTA: 마지막 액션 (저장/댓글/DM/프로필링크 중 무엇)
    "비슷한 거 만들어보세요" 같은 일반론 절대 금지. 부상구 페르소나·말투·가치사다리 반영.

11. tags (4~6개, 쉼표 구분)
    콘텐츠 주제·포맷·타겟 단서를 짧게

[출력 형식 — 엄수]
아래 JSON 구조로만. 코드블록(\`\`\`) 금지. 설명 금지. 응답은 { 로 시작 } 로 끝.
모든 값은 문자열. 줄바꿈은 \\n 사용.

{
  "hook": "...",
  "script": "00:00 [장면+자막]\\n00:03 ...\\n00:08 ...",
  "captionStyle": "...",
  "bgm": "...",
  "editing": "...",
  "framing": "...",
  "commentSentiment": "감정 분포: 공감 X%·질문 Y%...\\n자주 등장 단어: ...\\n자주 나온 질문: ...",
  "topComments": "댓글1 원문 → 왜 임팩트인지\\n댓글2 원문 → ...\\n댓글3 원문 → ...",
  "insight": "가설 1 (알고리즘): ...\\n가설 2 (페인포인트): ...\\n가설 3 (포맷): ...",
  "action": "시나리오 1\\n· 주제: ...\\n· 훅: ...\\n· 흐름: ...\\n· CTA: ...\\n\\n시나리오 2\\n· 주제: ...\\n...",
  "tags": "태그1, 태그2, 태그3, 태그4"
}`;
    }

    if (type === 'carousel') {
      return `당신은 한국 인스타그램 캐러셀 분석 전문가이자 콘텐츠 전략가입니다.
당신의 분석은 부상구 채널의 다음 캐러셀 기획에 직접 사용됩니다 — 두루뭉술 금지, 구체적이고 깊이 있게.
${brandContext}${inputs}

[작업]
캡션·댓글·메타 정보를 종합 분석하여 다음 12개 항목을 한국어로 작성합니다.
정보가 부족해도 "추정"하여 채우세요. 비워두지 마세요. 일반론·반복 금지.

1. hook (15~30자 한 줄)
   - 표지(1슬라이드)에 등장했을 것으로 추정되는 핵심 문구
   - 캡션 첫 줄·댓글에서 자주 인용된 표현을 단서로
   - 저장을 유도하는 구체 시나리오·숫자·반전 패턴

2. coverPattern (표지 디자인 패턴 추정, 한 줄)
   - 배경·텍스트 배치·강조 방식 (예: "크림 배경 + 굵은 검정 큰 글씨 중앙 + 노란 형광펜 핵심어")

3. script (슬라이드별 구조 추정 ${meta.slides ? meta.slides : '10'}장)
   - 감정 아크 기준: 훅→리훅→공감→문제 심화→해결 제시→증거·데이터→디테일→실행 가이드→전환점→CTA
   - "01. (역할) 슬라이드 카피 내용" 형식으로 한 줄씩, 줄바꿈 구분
   - 각 슬라이드 카피는 실제로 들어갈 만한 15~25자로 작성 (역할 설명만 X)

4. color (컬러 팔레트 추정, 한 줄)
   - 배경·텍스트·강조 컬러 (예: "크림 #FAF7F0 + 다크 #1A1A1A + 옐로우 형광 #FFEB3B")

5. font (폰트 스타일 추정, 한 줄)
   - 자체·굵기·자간 (예: "산세리프 굵게 -3% 자간, 헤드는 90% 본문은 65% 굵기")

6. layout (레이아웃 패턴, 한 줄)
   - 텍스트 배치·페이지 인디케이터 (예: "상단 카테고리 라벨 + 중앙 텍스트 + 하단 → 다음 페이지 인디케이터")

7. graphic (그래픽 요소, 한 줄)
   - 일러스트·아이콘·도형 (예: "손그림 화살표·동그라미 강조·계산기 이모지 산발")

8. commentSentiment (4~6줄, 구체적으로)
   - 감정 분포 % + 자주 등장한 단어 TOP 5 + 자주 나온 질문 3개
   - 캐러셀은 "저장했어요" "공유했어요" 같은 행동 신호가 핵심
   - 실제 댓글에서 단서 인용

9. topComments (3~5개)
   - 입력 댓글 중 임팩트 있는 것 원문 그대로
   - 줄바꿈 구분, 각 댓글 끝에 "→ (왜 임팩트인지 한 줄)"

10. insight (왜 저장됐는가 — 6~10줄, 가설 3개+)
    · 가설 1: 표지 훅이 어떤 페인을 정확히 짚었나
    · 가설 2: 슬라이드 흐름의 어느 지점이 "저장해두고 다시 봐야겠다"를 유도했나
    · 가설 3: 디자인·정보 밀도가 저장을 강화했나
    각 가설마다 댓글·캡션 인용으로 근거

11. action (부상구 채널 적용 시나리오 3개, 구체적으로)
    각 시나리오마다:
    · 주제: 부상구 카테고리 안에서 구체적으로
    · 표지 훅: 부상구 톤으로 15~25자
    · 10슬라이드 구조: 핵심 3~5개 슬라이드만 카피 예시
    · CTA: 저장/공유/DM/링크 중 무엇으로 무엇을 유도
    일반론 절대 금지. 부상구 페르소나·말투·가치사다리 반영.

12. tags (4~6개, 쉼표 구분)

[출력 형식 — 엄수]
아래 JSON 구조로만. 코드블록(\`\`\`) 금지. 설명 금지. 응답은 { 로 시작 } 로 끝.
모든 값은 문자열. 줄바꿈은 \\n 사용.

{
  "hook": "...",
  "coverPattern": "...",
  "script": "01. (훅) ...\\n02. (리훅) ...\\n03. (공감) ...\\n...\\n10. (CTA) ...",
  "color": "...",
  "font": "...",
  "layout": "...",
  "graphic": "...",
  "commentSentiment": "감정 분포: ...\\n자주 등장 단어: ...\\n자주 나온 질문: ...",
  "topComments": "댓글1 → 왜 임팩트\\n댓글2 → ...\\n댓글3 → ...",
  "insight": "가설 1: ...\\n가설 2: ...\\n가설 3: ...",
  "action": "시나리오 1\\n· 주제: ...\\n· 표지 훅: ...\\n· 슬라이드: ...\\n· CTA: ...\\n\\n시나리오 2\\n...",
  "tags": "태그1, 태그2, 태그3, 태그4"
}`;
    }
  }

  /* ---------- 스타일 ---------- */
  function injectStyles() {
    if (document.getElementById('ailab-styles')) return;
    const css = `
.ailab-btn{background:linear-gradient(135deg,#5BD66B 0%,#2E9B3F 100%);color:#0A0A0A;border:none;padding:11px 16px;font-family:"Pretendard Variable",Pretendard,sans-serif;font-size:12px;font-weight:800;letter-spacing:-0.01em;cursor:pointer;outline:none;transition:all .15s;display:inline-flex;align-items:center;gap:6px;}
.ailab-btn:hover{filter:brightness(1.08);transform:translateY(-1px);}
.ailab-btn:disabled{opacity:.6;cursor:not-allowed;}
.ailab-modal-bg{display:none;position:fixed;inset:0;background:rgba(10,10,10,0.65);backdrop-filter:blur(4px);z-index:300;justify-content:center;align-items:flex-start;padding:40px 20px;overflow-y:auto;}
.ailab-modal-bg.show{display:flex;}
.ailab-modal{background:#FFF;max-width:720px;width:100%;padding:44px 52px;position:relative;box-shadow:0 24px 80px rgba(0,0,0,0.22);border:1px solid #E5E5E5;}
.ailab-close{position:absolute;top:18px;right:22px;background:none;border:none;font-size:24px;cursor:pointer;color:#888;line-height:1;}
.ailab-close:hover{color:#0A0A0A;}
.ailab-kicker{font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.2em;color:#2E9B3F;text-transform:uppercase;margin-bottom:14px;}
.ailab-modal h2{font-family:"Pretendard Variable",Pretendard,sans-serif;font-size:26px;font-weight:900;line-height:1.1;letter-spacing:-0.03em;margin-bottom:26px;color:#0A0A0A;}
.ailab-modal h2 em{font-style:normal;color:#2E9B3F;font-weight:900;}
.ailab-section{margin-bottom:22px;padding-bottom:22px;border-bottom:1px solid #E5E5E5;}
.ailab-section:last-of-type{border-bottom:0;}
.ailab-label{font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:0.2em;color:#2E9B3F;text-transform:uppercase;margin-bottom:14px;display:flex;align-items:center;gap:10px;}
.ailab-label::before{content:'';width:24px;height:1px;background:#2E9B3F;}
.ailab-tabs{display:flex;gap:0;margin-bottom:14px;border:1px solid #E5E5E5;}
.ailab-tab{flex:1;background:#FFF;border:none;border-right:1px solid #E5E5E5;padding:12px 14px;font-family:ui-monospace,Menlo,monospace;font-size:11px;font-weight:700;letter-spacing:0.06em;color:#888;cursor:pointer;transition:all .15s;text-align:left;}
.ailab-tab:last-child{border-right:0;}
.ailab-tab:hover{color:#0A0A0A;background:#F4F4F4;}
.ailab-tab.active{background:#0A0A0A;color:#FFF;}
.ailab-tab .tab-name{display:block;font-size:12px;margin-bottom:3px;letter-spacing:-0.01em;font-family:"Pretendard Variable",Pretendard,sans-serif;}
.ailab-tab .tab-sub{font-size:9px;letter-spacing:0.05em;opacity:0.7;}
.ailab-field{display:flex;flex-direction:column;margin-bottom:12px;}
.ailab-field:last-child{margin-bottom:0;}
.ailab-field label{font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:0.12em;color:#888;text-transform:uppercase;margin-bottom:6px;}
.ailab-field input,.ailab-field textarea,.ailab-field select{background:#FFF;border:1px solid #E5E5E5;padding:10px 14px;font-family:"Pretendard Variable",Pretendard,sans-serif;font-size:13.5px;color:#0A0A0A;outline:none;border-radius:0;transition:border-color .15s;width:100%;}
.ailab-field input:focus,.ailab-field textarea:focus,.ailab-field select:focus{border-color:#0A0A0A;}
.ailab-field textarea{resize:vertical;min-height:90px;line-height:1.6;}
.ailab-field textarea.big{min-height:160px;}
.ailab-row{display:grid;gap:12px;margin-bottom:12px;grid-template-columns:1fr 1fr;}
.ailab-row.cols-3{grid-template-columns:1fr 1fr 1fr;}
.ailab-hint{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:#888;margin-top:6px;letter-spacing:0.04em;line-height:1.6;}
.ailab-hint a{color:#2E9B3F;text-decoration:underline;}
.ailab-keybox{display:flex;gap:8px;align-items:center;background:#F4F4F4;padding:10px 12px;border:1px solid #E5E5E5;font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#0A0A0A;flex-wrap:wrap;}
.ailab-keybox.ok{background:#E8F8E4;border-color:#5BD66B;color:#2E9B3F;font-weight:700;}
.ailab-keybox button{background:transparent;border:1px solid #888;padding:4px 8px;font-family:ui-monospace,Menlo,monospace;font-size:10px;cursor:pointer;color:#0A0A0A;}
.ailab-keybox button:hover{border-color:#0A0A0A;}
.ailab-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:24px;padding-top:24px;border-top:1px solid #E5E5E5;}
.ailab-actions button{background:#FFF;border:1px solid #E5E5E5;padding:11px 18px;font-family:"Pretendard Variable",Pretendard,sans-serif;font-size:12px;font-weight:700;cursor:pointer;color:#0A0A0A;transition:all .15s;}
.ailab-actions button:hover{border-color:#0A0A0A;}
.ailab-actions .primary{background:#0A0A0A;color:#FFF;border-color:#0A0A0A;font-weight:800;}
.ailab-actions .primary:hover{background:#2E9B3F;border-color:#2E9B3F;}
.ailab-actions .primary:disabled{background:#888;border-color:#888;cursor:not-allowed;}
.ailab-status{font-family:ui-monospace,Menlo,monospace;font-size:11px;padding:10px 14px;margin-top:14px;letter-spacing:0.04em;line-height:1.6;}
.ailab-status.loading{background:#F4F4F4;color:#0A0A0A;}
.ailab-status.error{background:#FFE8E5;color:#C0392B;}
.ailab-status.success{background:#E8F8E4;color:#2E9B3F;font-weight:700;}
.ailab-spinner{display:inline-block;width:10px;height:10px;border:2px solid #888;border-top-color:#0A0A0A;border-radius:50%;animation:ailab-spin .8s linear infinite;margin-right:8px;vertical-align:-1px;}
@keyframes ailab-spin{to{transform:rotate(360deg);}}
.ailab-toast{position:fixed;bottom:28px;right:28px;background:#0A0A0A;color:#FFF;padding:12px 18px;font-family:ui-monospace,Menlo,monospace;font-size:11px;font-weight:700;letter-spacing:0.04em;z-index:500;transform:translateY(80px);opacity:0;transition:all .25s;}
.ailab-toast.show{transform:translateY(0);opacity:1;}
.ailab-toast.success{background:#2E9B3F;}
.ailab-toast.danger{background:#C0392B;}
`;
    const style = document.createElement('style');
    style.id = 'ailab-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function ensureToast() {
    let t = document.getElementById('ailab-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'ailab-toast';
      t.className = 'ailab-toast';
      document.body.appendChild(t);
    }
    return t;
  }
  function showToast(msg, type = '') {
    const t = ensureToast();
    t.textContent = msg;
    t.className = 'ailab-toast show ' + type;
    setTimeout(() => t.classList.remove('show'), 2400);
  }

  /* ---------- 모달 ---------- */
  function buildModal(type, onAnalyzed) {
    const id = 'ailab-modal-' + type;
    let modal = document.getElementById(id);
    if (modal) return modal;

    const isReels = type === 'reels';
    const titleLabel = isReels ? '릴스' : '캐러셀';
    const captionPh = '게시물 캡션 전문을 그대로 복사 — 본문이 짧으면 비워둬도 됨';
    const commentsPh = '좋아요/답글 많은 댓글들을 한 번에 복사 (한 줄 또는 여러 줄, 형식 자유)';

    modal = document.createElement('div');
    modal.id = id;
    modal.className = 'ailab-modal-bg';
    modal.innerHTML = `
      <div class="ailab-modal" role="dialog" aria-modal="true">
        <button class="ailab-close" data-ailab-close>×</button>
        <div class="ailab-kicker">__ AI ANALYSIS</div>
        <h2>${titleLabel} <em>자동 분석</em></h2>

        <div class="ailab-section">
          <div class="ailab-label">01 — AI 프로바이더 선택</div>
          <div class="ailab-tabs" data-tabs>
            ${Object.entries(PROVIDERS).map(([id, p]) => `
              <button type="button" class="ailab-tab" data-provider="${id}">
                <span class="tab-name">${p.label}</span>
                <span class="tab-sub">${p.tagline}</span>
              </button>
            `).join('')}
          </div>
          <div data-key-area></div>
          <div class="ailab-hint" data-key-hint></div>
        </div>

        <div class="ailab-section">
          <div class="ailab-label">02 — 기본 정보 (선택)</div>
          <div class="ailab-row">
            <div class="ailab-field">
              <label>계정명 (@제외)</label>
              <input type="text" data-field="account" placeholder="user_name" />
            </div>
            <div class="ailab-field">
              <label>카테고리</label>
              <select data-field="category">
                <option value="재테크">재테크</option>
                <option value="부동산">부동산</option>
                <option value="주식">주식</option>
                <option value="연금/노후">연금/노후</option>
                <option value="마인드셋">마인드셋</option>
                <option value="라이프스타일">라이프스타일</option>
                <option value="기타">기타</option>
              </select>
            </div>
          </div>
          <div class="ailab-field">
            <label>${titleLabel} URL</label>
            <input type="url" data-field="url" placeholder="https://instagram.com/..." />
          </div>
          ${isReels ? `
          <div class="ailab-row cols-3">
            <div class="ailab-field"><label>조회수</label><input type="text" data-field="views" placeholder="120만" /></div>
            <div class="ailab-field"><label>좋아요</label><input type="text" data-field="likes" placeholder="4.5만" /></div>
            <div class="ailab-field"><label>영상 길이(초)</label><input type="text" data-field="duration" placeholder="25" /></div>
          </div>` : `
          <div class="ailab-row cols-3">
            <div class="ailab-field"><label>조회수</label><input type="text" data-field="views" placeholder="120만" /></div>
            <div class="ailab-field"><label>저장수</label><input type="text" data-field="saves" placeholder="3500" /></div>
            <div class="ailab-field"><label>슬라이드 수</label><input type="text" data-field="slides" placeholder="10" /></div>
          </div>`}
        </div>

        <div class="ailab-section">
          <div class="ailab-label">03 — 인스타에서 복사해서 붙여넣기 (필수)</div>
          <div class="ailab-field">
            <label>캡션 (게시물 본문)</label>
            <textarea data-field="caption" class="big" placeholder="${captionPh}"></textarea>
          </div>
          <div class="ailab-field">
            <label>좋아요 많은 댓글 (모아 붙여넣기)</label>
            <textarea data-field="comments" class="big" placeholder="${commentsPh}"></textarea>
          </div>
          ${isReels ? `
          <div class="ailab-field">
            <label>영상 받아쓰기 스크립트 (선택)</label>
            <textarea data-field="script" placeholder="영상 자막·내레이션을 받아쓴 텍스트가 있으면 붙여넣기"></textarea>
          </div>` : ''}
          <div class="ailab-hint">
            모바일 인스타에서 게시물 → 우측 상단 ⋯ → "캡션 복사" / 댓글은 길게 눌러 복사
          </div>
        </div>

        <div data-status></div>

        <div class="ailab-actions">
          <button data-ailab-close>취소</button>
          <button class="primary" data-analyze>✨ AI 분석 → 폼 채우기</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    /* ---- 탭 ---- */
    let currentProvider = getProvider();
    const tabBtns = modal.querySelectorAll('[data-provider]');

    function syncTabs() {
      tabBtns.forEach(b => b.classList.toggle('active', b.dataset.provider === currentProvider));
      renderKeyArea();
    }
    tabBtns.forEach(b => {
      b.addEventListener('click', () => {
        currentProvider = b.dataset.provider;
        setProvider(currentProvider);
        syncTabs();
      });
    });

    /* ---- 키 영역 ---- */
    const keyArea = modal.querySelector('[data-key-area]');
    const keyHint = modal.querySelector('[data-key-hint]');

    function renderKeyArea() {
      const p = PROVIDERS[currentProvider];
      const key = getApiKey(currentProvider);
      const model = getModel(currentProvider);
      keyHint.innerHTML = p.keyHint + ` · <a href="${p.keyUrl}" target="_blank">키 발급/관리 →</a>`;

      if (key) {
        const masked = key.length > 12 ? key.slice(0, 6) + '••••' + key.slice(-4) : '••••';
        keyArea.innerHTML = `
          <div class="ailab-keybox ok">
            <span>✓ ${p.label} 키 저장됨 · ${masked}</span>
            <span style="flex:1;min-width:8px;"></span>
            <select data-model style="background:#FFF;border:1px solid #5BD66B;padding:4px 8px;font-family:ui-monospace,Menlo,monospace;font-size:10px;">
              ${p.models.map(m => `<option value="${m.id}" ${m.id === model ? 'selected' : ''}>${m.label}</option>`).join('')}
            </select>
            <button data-key-edit>변경</button>
            <button data-key-clear>제거</button>
          </div>
        `;
        keyArea.querySelector('[data-key-edit]').onclick = renderKeyForm;
        keyArea.querySelector('[data-key-clear]').onclick = () => {
          if (confirm(`${p.label} API 키를 삭제할까요?`)) {
            clearApiKey(currentProvider);
            renderKeyArea();
            showToast('API 키 삭제됨', 'danger');
          }
        };
        keyArea.querySelector('[data-model]').onchange = (e) => {
          setModel(currentProvider, e.target.value);
          showToast('모델 변경: ' + e.target.value, 'success');
        };
      } else {
        renderKeyForm();
      }
    }
    function renderKeyForm() {
      const p = PROVIDERS[currentProvider];
      keyArea.innerHTML = `
        <div class="ailab-field" style="margin-bottom:8px;">
          <label>${p.label} API Key</label>
          <input type="password" data-key-input placeholder="${p.keyPrefix}... 형식의 키를 붙여넣기" />
        </div>
        <div style="display:flex;gap:8px;">
          <button data-key-save style="background:#0A0A0A;color:#FFF;border:1px solid #0A0A0A;padding:8px 16px;font-family:'Pretendard Variable',Pretendard,sans-serif;font-size:12px;font-weight:700;cursor:pointer;">저장</button>
          ${getApiKey(currentProvider) ? '<button data-key-cancel style="background:transparent;border:1px solid #E5E5E5;padding:8px 14px;font-family:ui-monospace,Menlo,monospace;font-size:11px;cursor:pointer;">취소</button>' : ''}
        </div>
      `;
      keyArea.querySelector('[data-key-save]').onclick = () => {
        const v = keyArea.querySelector('[data-key-input]').value.trim();
        if (!v) { showToast('키를 입력해주세요', 'danger'); return; }
        setApiKey(currentProvider, v);
        renderKeyArea();
        showToast('API 키 저장됨', 'success');
      };
      const cancel = keyArea.querySelector('[data-key-cancel]');
      if (cancel) cancel.onclick = renderKeyArea;
    }

    syncTabs();

    /* ---- 닫기 ---- */
    modal.querySelectorAll('[data-ailab-close]').forEach(b => b.onclick = () => modal.classList.remove('show'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });

    /* ---- 분석 실행 ---- */
    const analyzeBtn = modal.querySelector('[data-analyze]');
    const statusEl = modal.querySelector('[data-status]');

    analyzeBtn.onclick = async () => {
      if (!getApiKey(currentProvider)) {
        statusEl.innerHTML = '<div class="ailab-status error">API 키를 먼저 저장해주세요</div>';
        return;
      }
      const get = (k) => modal.querySelector(`[data-field="${k}"]`).value.trim();
      const meta = {
        account: get('account'),
        category: get('category'),
        url: get('url'),
        views: get('views'),
        likes: isReels ? get('likes') : '',
        duration: isReels ? get('duration') : '',
        saves: !isReels ? get('saves') : '',
        slides: !isReels ? get('slides') : '',
        caption: get('caption'),
        comments: get('comments'),
        script: isReels ? get('script') : ''
      };

      if (!meta.caption && !meta.comments && !meta.script) {
        statusEl.innerHTML = '<div class="ailab-status error">캡션 또는 댓글을 최소 하나 입력해주세요</div>';
        return;
      }

      analyzeBtn.disabled = true;
      const providerLabel = PROVIDERS[currentProvider].label;
      statusEl.innerHTML = `<div class="ailab-status loading"><span class="ailab-spinner"></span>${providerLabel}가 분석 중… (3~15초)</div>`;

      try {
        const prompt = buildPrompt(type, meta);
        const analysis = await analyze(prompt, SCHEMAS[type]);
        statusEl.innerHTML = '<div class="ailab-status success">✓ 분석 완료 — 폼에 채워넣는 중...</div>';
        setTimeout(() => {
          modal.classList.remove('show');
          onAnalyzed({ meta, analysis });
          statusEl.innerHTML = '';
          analyzeBtn.disabled = false;
        }, 400);
      } catch (err) {
        console.error(err);
        let hint = '';
        const msg = String(err.message || '');
        if (msg.includes('quota') || msg.includes('Quota') || msg.includes('limit: 0')) {
          hint = `<br>→ 한도/지역 이슈입니다. 다른 프로바이더(${currentProvider === 'gemini' ? 'Groq' : 'Gemini'}) 탭으로 전환하거나, 새 프로젝트로 키를 재발급해보세요.`;
        } else if (msg.includes('401') || msg.includes('403') || msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('api key')) {
          hint = '<br>→ API 키가 잘못됐거나 권한이 없어요. 키를 다시 확인해주세요.';
        } else if (msg.includes('429')) {
          hint = '<br>→ 분당 호출 한도를 초과했어요. 10~30초 후 다시 시도.';
        }
        statusEl.innerHTML = `<div class="ailab-status error">분석 실패: ${msg}${hint}</div>`;
        analyzeBtn.disabled = false;
      }
    };

    return modal;
  }

  /* ---------- 공개 API ---------- */
  function init({ type, buttonContainer, insertBefore, buttonLabel, onAnalyzed }) {
    injectStyles();

    const modal = buildModal(type, onAnalyzed);

    const btn = document.createElement('button');
    btn.className = 'ailab-btn';
    btn.innerHTML = '✨ ' + (buttonLabel || 'AI 분석');
    btn.title = 'AI(Groq·Gemini)로 캡션·댓글 자동 분석';
    btn.onclick = () => modal.classList.add('show');

    if (insertBefore) {
      const target = document.querySelector(insertBefore);
      if (target && target.parentNode) {
        target.parentNode.insertBefore(btn, target);
        return;
      }
    }
    const container = typeof buttonContainer === 'string'
      ? document.querySelector(buttonContainer)
      : buttonContainer;
    if (!container) {
      console.warn('AILab.init: target not found', { buttonContainer, insertBefore });
      return;
    }
    container.appendChild(btn);
  }

  window.AILab = {
    init,
    getProvider, setProvider,
    getApiKey, setApiKey, clearApiKey,
    getModel, setModel,
    analyze,
    PROVIDERS
  };
})();
