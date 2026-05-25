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
        commentSentiment: { type: 'STRING' },
        topComments: { type: 'STRING' },
        insight: { type: 'STRING' },
        action: { type: 'STRING' },
        tags: { type: 'STRING' }
      },
      required: ['hook', 'commentSentiment', 'topComments', 'insight', 'action', 'tags']
    },
    carousel: {
      type: 'OBJECT',
      properties: {
        hook: { type: 'STRING' },
        coverPattern: { type: 'STRING' },
        script: { type: 'STRING' },
        commentSentiment: { type: 'STRING' },
        topComments: { type: 'STRING' },
        insight: { type: 'STRING' },
        action: { type: 'STRING' },
        tags: { type: 'STRING' }
      },
      required: ['hook', 'commentSentiment', 'topComments', 'insight', 'action', 'tags']
    }
  };

  function buildPrompt(type, meta) {
    const common = `
[기본 정보]
계정: ${meta.account || '미입력'}
카테고리: ${meta.category || '미입력'}
URL: ${meta.url || '미입력'}

[캡션 (게시물 본문)]
${meta.caption || '(미입력)'}

[좋아요 많은 댓글 (사용자가 복사한 원문)]
${meta.comments || '(미입력)'}
`;

    if (type === 'reels') {
      return `당신은 한국 인스타그램 릴스 분석 전문가입니다.
분석 대상은 부상구 채널(2030 재테크 입문자, "먼저 해본 동반자" 포지셔닝)의 컨텐츠 영감용입니다.
${common}
${meta.script ? `[영상 받아쓰기 스크립트 - 있을 경우]\n${meta.script}\n` : ''}

[작업]
다음 6개 항목을 한국어로 분석합니다.

1. hook: 첫 3초에 등장했을 것으로 추정되는 훅 문장 한 줄 (15~25자, 후크가 강한 단어 사용)
2. commentSentiment: 댓글의 감정 분포 (예: "공감 60%·질문 25%·반발 15%")와 자주 등장한 단어·질문 (3~4줄)
3. topComments: 가장 임팩트 있는 댓글 3~5개를 한 줄씩 (원문 그대로, 줄바꿈으로 구분)
4. insight: 왜 이 릴스가 터졌는지 가설 (3~5줄). 훅 강도·시의성·페인포인트 적중도·알고리즘 트리거·정보 가치 중 핵심 요인 분석
5. action: 부상구 채널(2030 재테크 입문자, "같이 알아보자" 톤)에 어떻게 변주·적용할지 구체적 아이디어 2~3개
6. tags: 콘텐츠를 분류할 자유 태그 4~6개 (쉼표로 구분, 짧게)

[출력 형식]
정확히 아래 JSON 구조로만 응답하세요. 모든 값은 문자열입니다.
설명·코드블록(\`\`\`)·전후 텍스트 일절 금지. 응답은 { 로 시작해서 } 로 끝나야 합니다.

{
  "hook": "여기에 훅 문장",
  "commentSentiment": "여기에 감정 분포와 주요 단어",
  "topComments": "댓글1\\n댓글2\\n댓글3",
  "insight": "여기에 왜 터졌는지 분석",
  "action": "여기에 적용 아이디어",
  "tags": "태그1, 태그2, 태그3, 태그4"
}`;
    }

    if (type === 'carousel') {
      return `당신은 한국 인스타그램 캐러셀 분석 전문가입니다.
분석 대상은 부상구 채널(2030 재테크 입문자, "먼저 해본 동반자" 포지셔닝)의 컨텐츠 영감용입니다.
${common}
${meta.slides ? `[슬라이드 수]\n${meta.slides}장\n` : ''}

[작업]
다음 8개 항목을 한국어로 분석합니다.

1. hook: 표지(첫 슬라이드)에 등장했을 것으로 추정되는 핵심 문구 (15~30자)
2. coverPattern: 표지 디자인 패턴 추정 한 줄 (예: "화이트 배경 + 굵은 검정 글씨 + 노란 형광펜")
3. script: 10장 안팎의 슬라이드 구조 추정 (감정 아크: 훅→공감→문제→해결→증거→CTA 기준). "01. (역할) 내용" 형식으로 한 줄씩, 줄바꿈으로 구분
4. commentSentiment: 댓글 감정 분포 + 자주 등장한 단어·질문 (3~4줄)
5. topComments: 가장 임팩트 있는 댓글 3~5개 한 줄씩 (원문, 줄바꿈 구분)
6. insight: 왜 이 캐러셀이 저장됐는지 분석 (3~5줄). 표지 훅·슬라이드 흐름·정보 가치·시각적 임팩트 중 핵심 요인
7. action: 부상구 채널에 어떻게 변주할지 구체 아이디어 2~3개
8. tags: 자유 태그 4~6개 (쉼표 구분)

[출력 형식]
정확히 아래 JSON 구조로만 응답하세요. 모든 값은 문자열입니다.
설명·코드블록(\`\`\`)·전후 텍스트 일절 금지. 응답은 { 로 시작해서 } 로 끝나야 합니다.

{
  "hook": "여기에 표지 핵심 문구",
  "coverPattern": "여기에 디자인 패턴",
  "script": "01. (훅) ...\\n02. (공감) ...\\n03. (문제) ...",
  "commentSentiment": "여기에 감정 분포와 주요 단어",
  "topComments": "댓글1\\n댓글2\\n댓글3",
  "insight": "여기에 왜 저장됐는지 분석",
  "action": "여기에 적용 아이디어",
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
