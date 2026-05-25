/* ============================================================
   AILab — Gemini 무료 API 기반 AI 분석 보조
   사용처: reels-lab, carousel-lab
   ============================================================ */
(function () {
  const KEY_API = 'gemini_api_key';
  const KEY_MODEL = 'gemini_model';
  const DEFAULT_MODEL = 'gemini-2.0-flash';
  const MODEL_OPTIONS = [
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (권장 · 무료)' },
    { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite (더 빠름 · 무료)' },
    { id: 'gemini-1.5-flash-latest', label: 'Gemini 1.5 Flash (안정 · 무료)' },
    { id: 'gemini-1.5-pro-latest', label: 'Gemini 1.5 Pro (정확 · 무료 한도 적음)' }
  ];

  /* ---------- 키/모델 ---------- */
  function getApiKey() { return localStorage.getItem(KEY_API) || ''; }
  function setApiKey(v) { localStorage.setItem(KEY_API, v); }
  function clearApiKey() { localStorage.removeItem(KEY_API); }
  function getModel() { return localStorage.getItem(KEY_MODEL) || DEFAULT_MODEL; }
  function setModel(v) { localStorage.setItem(KEY_MODEL, v); }

  /* ---------- Gemini 호출 ---------- */
  async function callGemini(prompt, schema) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('Gemini API 키를 먼저 설정해주세요');
    const model = getModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

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

    try { return JSON.parse(text); }
    catch (e) {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error('Gemini 응답을 JSON으로 파싱할 수 없어요');
    }
  }

  /* ---------- 프롬프트 빌더 ---------- */
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
다음 6개 항목을 한국어로 분석하여 JSON으로만 출력하세요:

1. hook: 첫 3초에 등장했을 것으로 추정되는 훅 문장 한 줄 (15~25자, 후크가 강한 단어 사용)
2. commentSentiment: 댓글의 감정 분포 (예: "공감 60%·질문 25%·반발 15%")와 자주 등장한 단어·질문 (3~4줄)
3. topComments: 가장 임팩트 있는 댓글 3~5개를 한 줄씩 (원문 그대로, 줄바꿈으로 구분)
4. insight: 왜 이 릴스가 터졌는지 가설 (3~5줄). 훅 강도·시의성·페인포인트 적중도·알고리즘 트리거·정보 가치 중 핵심 요인 분석
5. action: 부상구 채널(2030 재테크 입문자, "같이 알아보자" 톤)에 어떻게 변주·적용할지 구체적 아이디어 2~3개
6. tags: 콘텐츠를 분류할 자유 태그 4~6개 (쉼표로 구분, 짧게)

반드시 위 6개 필드를 모두 포함한 JSON 객체로만 응답. 다른 텍스트 없이.`;
    }

    if (type === 'carousel') {
      return `당신은 한국 인스타그램 캐러셀 분석 전문가입니다.
분석 대상은 부상구 채널(2030 재테크 입문자, "먼저 해본 동반자" 포지셔닝)의 컨텐츠 영감용입니다.
${common}
${meta.slides ? `[슬라이드 수]\n${meta.slides}장\n` : ''}
다음 8개 항목을 한국어로 분석하여 JSON으로만 출력하세요:

1. hook: 표지(첫 슬라이드)에 등장했을 것으로 추정되는 핵심 문구 (15~30자)
2. coverPattern: 표지 디자인 패턴 추정 한 줄 (예: "화이트 배경 + 굵은 검정 글씨 + 노란 형광펜")
3. script: 10장 안팎의 슬라이드 구조 추정 (감정 아크: 훅→공감→문제→해결→증거→CTA 기준). "01. (역할) 내용" 형식으로 한 줄씩
4. commentSentiment: 댓글 감정 분포 + 자주 등장한 단어·질문 (3~4줄)
5. topComments: 가장 임팩트 있는 댓글 3~5개 한 줄씩 (원문, 줄바꿈 구분)
6. insight: 왜 이 캐러셀이 저장됐는지 분석 (3~5줄). 표지 훅·슬라이드 흐름·정보 가치·시각적 임팩트 중 핵심 요인
7. action: 부상구 채널에 어떻게 변주할지 구체 아이디어 2~3개
8. tags: 자유 태그 4~6개 (쉼표 구분)

반드시 위 8개 필드를 모두 포함한 JSON 객체로만 응답. 다른 텍스트 없이.`;
    }
  }

  /* ---------- 스타일 주입 ---------- */
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
.ailab-field{display:flex;flex-direction:column;margin-bottom:12px;}
.ailab-field:last-child{margin-bottom:0;}
.ailab-field label{font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:0.12em;color:#888;text-transform:uppercase;margin-bottom:6px;}
.ailab-field input,.ailab-field textarea,.ailab-field select{background:#FFF;border:1px solid #E5E5E5;padding:10px 14px;font-family:"Pretendard Variable",Pretendard,sans-serif;font-size:13.5px;color:#0A0A0A;outline:none;border-radius:0;transition:border-color .15s;width:100%;}
.ailab-field input:focus,.ailab-field textarea:focus,.ailab-field select:focus{border-color:#0A0A0A;}
.ailab-field textarea{resize:vertical;min-height:90px;line-height:1.6;}
.ailab-field textarea.big{min-height:160px;}
.ailab-row{display:grid;gap:12px;margin-bottom:12px;grid-template-columns:1fr 1fr;}
.ailab-row.cols-3{grid-template-columns:1fr 1fr 1fr;}
.ailab-hint{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:#888;margin-top:6px;letter-spacing:0.04em;line-height:1.5;}
.ailab-hint a{color:#2E9B3F;text-decoration:underline;}
.ailab-keybox{display:flex;gap:8px;align-items:center;background:#F4F4F4;padding:10px 12px;border:1px solid #E5E5E5;font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#0A0A0A;}
.ailab-keybox.ok{background:#E8F8E4;border-color:#5BD66B;color:#2E9B3F;font-weight:700;}
.ailab-keybox button{background:transparent;border:1px solid #888;padding:4px 8px;font-family:ui-monospace,Menlo,monospace;font-size:10px;cursor:pointer;color:#0A0A0A;}
.ailab-keybox button:hover{border-color:#0A0A0A;}
.ailab-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:24px;padding-top:24px;border-top:1px solid #E5E5E5;}
.ailab-actions button{background:#FFF;border:1px solid #E5E5E5;padding:11px 18px;font-family:"Pretendard Variable",Pretendard,sans-serif;font-size:12px;font-weight:700;cursor:pointer;color:#0A0A0A;transition:all .15s;}
.ailab-actions button:hover{border-color:#0A0A0A;}
.ailab-actions .primary{background:#0A0A0A;color:#FFF;border-color:#0A0A0A;font-weight:800;}
.ailab-actions .primary:hover{background:#2E9B3F;border-color:#2E9B3F;}
.ailab-actions .primary:disabled{background:#888;border-color:#888;cursor:not-allowed;}
.ailab-status{font-family:ui-monospace,Menlo,monospace;font-size:11px;padding:10px 14px;margin-top:14px;letter-spacing:0.04em;}
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

  /* ---------- 토스트 ---------- */
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

  /* ---------- 모달 빌더 ---------- */
  function buildModal(type, onAnalyzed) {
    const id = 'ailab-modal-' + type;
    let modal = document.getElementById(id);
    if (modal) return modal;

    const isReels = type === 'reels';
    const titleLabel = isReels ? '릴스' : '캐러셀';
    const captionPh = isReels
      ? '릴스 게시물 캡션 전문을 그대로 복사 — 본문이 짧으면 비워둬도 됩니다'
      : '캐러셀 게시물 캡션 전문을 그대로 복사';
    const commentsPh = '좋아요/답글 많은 댓글들을 한 번에 복사 (한 줄 또는 여러 줄, 형식 자유)';

    modal = document.createElement('div');
    modal.id = id;
    modal.className = 'ailab-modal-bg';
    modal.innerHTML = `
      <div class="ailab-modal" role="dialog" aria-modal="true">
        <button class="ailab-close" data-ailab-close>×</button>
        <div class="ailab-kicker">__ AI ANALYSIS · GEMINI</div>
        <h2>${titleLabel} <em>자동 분석</em></h2>

        <div class="ailab-section" data-key-section>
          <div class="ailab-label">01 — API 키 (Google AI Studio · 무료)</div>
          <div data-key-area></div>
          <div class="ailab-hint">
            · 키 발급: <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a> (구글 로그인만, 카드 불필요)<br>
            · 무료 한도: gemini-2.0-flash 기준 분당 15회, 하루 1,500회<br>
            · 키는 본인 브라우저(localStorage)에만 저장 — 외부 전송 없음
          </div>
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
            <textarea data-field="script" placeholder="영상 자막·내레이션을 받아쓴 텍스트가 있으면 붙여넣기 — 없으면 비워둬도 됩니다"></textarea>
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

    /* 키 영역 렌더 */
    function renderKeyArea() {
      const area = modal.querySelector('[data-key-area]');
      const key = getApiKey();
      const model = getModel();
      if (key) {
        const masked = key.slice(0, 6) + '••••' + key.slice(-4);
        area.innerHTML = `
          <div class="ailab-keybox ok">
            <span>✓ API 키 저장됨 · ${masked}</span>
            <span style="flex:1"></span>
            <select data-model style="background:#FFF;border:1px solid #5BD66B;padding:4px 8px;font-family:ui-monospace,Menlo,monospace;font-size:10px;">
              ${MODEL_OPTIONS.map(m => `<option value="${m.id}" ${m.id === model ? 'selected' : ''}>${m.label}</option>`).join('')}
            </select>
            <button data-key-edit>변경</button>
            <button data-key-clear>제거</button>
          </div>
        `;
        area.querySelector('[data-key-edit]').onclick = renderKeyForm;
        area.querySelector('[data-key-clear]').onclick = () => {
          if (confirm('저장된 Gemini API 키를 삭제할까요?')) {
            clearApiKey();
            renderKeyArea();
            showToast('API 키 삭제됨', 'danger');
          }
        };
        area.querySelector('[data-model]').onchange = (e) => {
          setModel(e.target.value);
          showToast('모델 변경: ' + e.target.value, 'success');
        };
      } else {
        renderKeyForm();
      }
    }
    function renderKeyForm() {
      const area = modal.querySelector('[data-key-area]');
      area.innerHTML = `
        <div class="ailab-field" style="margin-bottom:8px;">
          <label>Gemini API Key</label>
          <input type="password" data-key-input placeholder="AIza... 로 시작하는 키를 붙여넣기" />
        </div>
        <div style="display:flex;gap:8px;">
          <button class="primary" data-key-save style="background:#0A0A0A;color:#FFF;border:1px solid #0A0A0A;padding:8px 16px;font-family:'Pretendard Variable',Pretendard,sans-serif;font-size:12px;font-weight:700;cursor:pointer;">저장</button>
          ${getApiKey() ? '<button data-key-cancel style="background:transparent;border:1px solid #E5E5E5;padding:8px 14px;font-family:ui-monospace,Menlo,monospace;font-size:11px;cursor:pointer;">취소</button>' : ''}
        </div>
      `;
      area.querySelector('[data-key-save]').onclick = () => {
        const v = area.querySelector('[data-key-input]').value.trim();
        if (!v) { showToast('키를 입력해주세요', 'danger'); return; }
        setApiKey(v);
        renderKeyArea();
        showToast('API 키 저장됨', 'success');
      };
      const cancel = area.querySelector('[data-key-cancel]');
      if (cancel) cancel.onclick = renderKeyArea;
    }
    renderKeyArea();

    /* 닫기 */
    modal.querySelectorAll('[data-ailab-close]').forEach(b => b.onclick = () => {
      modal.classList.remove('show');
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('show');
    });

    /* 분석 실행 */
    const analyzeBtn = modal.querySelector('[data-analyze]');
    const statusEl = modal.querySelector('[data-status]');

    analyzeBtn.onclick = async () => {
      if (!getApiKey()) {
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
      statusEl.innerHTML = '<div class="ailab-status loading"><span class="ailab-spinner"></span>Gemini가 분석 중… (5~15초)</div>';

      try {
        const prompt = buildPrompt(type, meta);
        const analysis = await callGemini(prompt, SCHEMAS[type]);
        statusEl.innerHTML = '<div class="ailab-status success">✓ 분석 완료 — 폼에 채워넣는 중...</div>';
        setTimeout(() => {
          modal.classList.remove('show');
          onAnalyzed({ meta, analysis });
          statusEl.innerHTML = '';
          analyzeBtn.disabled = false;
        }, 400);
      } catch (err) {
        console.error(err);
        statusEl.innerHTML = `<div class="ailab-status error">분석 실패: ${err.message}</div>`;
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
    btn.title = 'Gemini AI로 캡션·댓글 자동 분석';
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

  window.AILab = { init, getApiKey, setApiKey, clearApiKey, getModel, setModel, callGemini };
})();
