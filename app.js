(function(){
  "use strict";

  // ==========================================================
  // 匿名アクセス解析(任意設定)
  // 未設定のままでも診断は通常通り動作します(ログ送信だけ無効になります)。
  // group-app.js と同じSupabaseプロジェクトの情報を設定してください。
  // ==========================================================
  const ANALYTICS_SUPABASE_URL = "YOUR_SUPABASE_PROJECT_URL";
  const ANALYTICS_SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

  let analyticsClientPromise = null;
  function getAnalyticsClient(){
    if(ANALYTICS_SUPABASE_URL.startsWith("YOUR_") || ANALYTICS_SUPABASE_ANON_KEY.startsWith("YOUR_")) return null;
    if(!analyticsClientPromise){
      analyticsClientPromise = import("https://esm.sh/@supabase/supabase-js@2")
        .then(mod => mod.createClient(ANALYTICS_SUPABASE_URL, ANALYTICS_SUPABASE_ANON_KEY))
        .catch(() => null);
    }
    return analyticsClientPromise;
  }

  // 匿名イベントを記録する(個人を特定する情報は一切送らない)。
  // 失敗しても診断の利用には一切影響しないよう、常に静かに失敗する。
  function logEvent(eventType, typeCode){
    const clientPromise = getAnalyticsClient();
    if(!clientPromise) return;
    clientPromise.then(sb => {
      if(!sb) return;
      sb.from("analytics_events").insert({ event_type: eventType, type_code: typeCode || null }).then(() => {}, () => {});
    }).catch(() => {});
  }

  const state = {
    current: 0,
    answers: new Array(QUESTIONS.length).fill(null),
    incomingRef: null, // 友達のシェアリンクから受け取った診断結果
  };

  const STORAGE_KEY = "frenemy_my_result_v1";

  function saveMyResult(result){
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ code: result.code, scores: result.scores }));
    } catch(e){ /* ストレージ利用不可の場合は何もしない */ }
  }

  function loadMyResult(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return null;
      const parsed = JSON.parse(raw);
      if(!parsed || !parsed.code || !Object.prototype.hasOwnProperty.call(TYPES, parsed.code) || !parsed.scores) return null;
      return parsed;
    } catch(e){ return null; }
  }

  function parseIncomingRef(){
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    // 型コードの文字パターン(表裏/攻守/理情/単群の4文字)を厳密にチェックし、
    // "__proto__" や "constructor" のような不正な値がプロトタイプ経由で
    // 誤って「存在する」と判定されるのを防ぐ
    if(!code || !/^[SU][AD][LE][IG]$/.test(code)) return null;
    if(!Object.prototype.hasOwnProperty.call(TYPES, code)) return null;

    const clampScore = (v) => Math.max(-15, Math.min(15, v));
    const su = Number(params.get("su"));
    const ad = Number(params.get("ad"));
    const le = Number(params.get("le"));
    const ig = Number(params.get("ig"));
    if([su, ad, le, ig].some(v => Number.isNaN(v))) return null;
    return { code, scores:{SU:clampScore(su), AD:clampScore(ad), LE:clampScore(le), IG:clampScore(ig)} };
  }

  state.incomingRef = parseIncomingRef();
  const savedResult = loadMyResult();

  const screens = {
    intro: document.getElementById("screen-intro"),
    quiz: document.getElementById("screen-quiz"),
    loading: document.getElementById("screen-loading"),
    result: document.getElementById("screen-result"),
  };

  function showScreen(name){
    Object.values(screens).forEach(s => s.classList.remove("active"));
    screens[name].classList.add("active");
    window.scrollTo({top:0, behavior:"smooth"});
  }

  if(state.incomingRef && savedResult){
    // 友達のリンク + 保存済みの自分の結果がある → 再診断なしで即座に共存確率を表示
    renderResult(savedResult, true);
    showScreen("result");
  } else if(state.incomingRef){
    // 友達からのリンクで開かれたが、自分はまだ未診断 → introにバナーを出す
    const banner = document.getElementById("refBanner");
    const bannerText = document.getElementById("refBannerText");
    const friendType = TYPES[state.incomingRef.code];
    bannerText.textContent = `友達は「${friendType.name}」タイプでした。あなたも診断すると共存確率が分かります`;
    banner.style.display = "flex";
  } else if(savedResult){
    // 通常アクセスだが保存済みの結果がある → introに「前回の結果を見る」リンクを出す
    const viewBtn = document.getElementById("btnViewSaved");
    viewBtn.textContent = `前回の結果(${TYPES[savedResult.code].name})を見る →`;
    viewBtn.style.display = "inline-block";
    viewBtn.addEventListener("click", () => {
      renderResult(savedResult, true);
      showScreen("result");
    });
  }

  const SCALE_LABELS = [
    {v: 3, label:"とても当てはまる",     cls:"lv6"},
    {v: 2, label:"当てはまる",           cls:"lv5"},
    {v: 1, label:"やや当てはまる",       cls:"lv4"},
    {v:-1, label:"やや当てはまらない",   cls:"lv3"},
    {v:-2, label:"当てはまらない",       cls:"lv2"},
    {v:-3, label:"全く当てはまらない",   cls:"lv1"},
  ];

  function renderQuestion(){
    if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const idx = state.current;
    const q = QUESTIONS[idx];
    const axis = AXES.find(a => a.key === q.axis);

    document.getElementById("qNum").textContent = idx + 1;
    document.getElementById("qAxisLabel").textContent = `AXIS ${axis.tag}`;
    document.getElementById("qAxisTag").textContent = `軸 ${Math.floor(idx/5)+1} / 4　―　${axis.tag}`;
    document.getElementById("qText").textContent = q.text;
    document.getElementById("progressFill").style.width = ((idx) / QUESTIONS.length * 100) + "%";

    const scaleWrap = document.getElementById("qScale");
    scaleWrap.innerHTML = "";
    SCALE_LABELS.forEach(opt => {
      const btn = document.createElement("button");
      btn.className = "scale-btn " + opt.cls;
      const numText = opt.v > 0 ? "+" + opt.v : String(opt.v);
      btn.innerHTML = `<span class="num-badge">${numText}</span><span class="label">${opt.label}</span>`;
      btn.addEventListener("click", (e) => {
        e.currentTarget.blur();
        selectAnswer(opt.v);
      });
      scaleWrap.appendChild(btn);
    });

    document.getElementById("btnBack").disabled = idx === 0;
  }

  function selectAnswer(value){
    state.answers[state.current] = value;
    if(state.current < QUESTIONS.length - 1){
      state.current++;
      renderQuestion();
    } else {
      finishQuiz();
    }
  }

  function goBack(){
    if(state.current > 0){
      state.current--;
      renderQuestion();
    }
  }

  function finishQuiz(){
    showScreen("loading");
    setTimeout(() => {
      const result = computeResult();
      logEvent("quiz_complete", result.code);
      renderResult(result);
      showScreen("result");
    }, 1100);
  }

  function computeResult(){
    const scores = {SU:0, AD:0, LE:0, IG:0};
    QUESTIONS.forEach((q, i) => {
      const signed = state.answers[i]; // -3..+3, positive favors q.dir === "left" letter
      scores[q.axis] += (q.dir === "left") ? signed : -signed;
    });

    let code = "";
    AXES.forEach(axis => {
      const s = scores[axis.key];
      code += (s >= 0) ? axis.left : axis.right;
    });

    return { code, scores };
  }

  function pct(scoreForAxis){
    // score range -15..+15 (5 questions x max ±3) -> map to 0..100 (100 = full "left" letter)
    const clamped = Math.max(-15, Math.min(15, scoreForAxis));
    return ((clamped + 15) / 30) * 100;
  }

  const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 68; // r=68

  function gaugeComment(score){
    if(score >= 85) return "もはや隠す気もない、生粋のフレネミー気質。";
    if(score >= 65) return "笑顔の裏に、しっかり牙を隠しているタイプ。";
    if(score >= 40) return "状況によって顔を使い分ける、標準的なバランス型。";
    if(score >= 20) return "わりと素直。フレネミー度は控えめ。";
    return "裏表のない、ほぼピュアな正直者。";
  }

  // 2人のスコアから共存確率%を計算。
  // SU/LE/IG軸は「似ているほど気が合う」、AD軸だけは「攻めと守りが逆の方が噛み合う」と定義。
  const COMPAT_INVERT_AXIS = "AD";
  function computeCompatibility(myScores, otherScores){
    let total = 0;
    AXES.forEach(axis => {
      const diff = Math.abs(myScores[axis.key] - otherScores[axis.key]); // 0..30
      const closeness = 100 - (diff / 30) * 100; // 0..100、高いほど似ている
      total += (axis.key === COMPAT_INVERT_AXIS) ? (100 - closeness) : closeness;
    });
    return Math.round(total / AXES.length);
  }

  function compatComment(score){
    if(score >= 85) return "ここまで共存できる相手は珍しい。裏切る理由が見当たらないタイプ。";
    if(score >= 65) return "うまく共存できる組み合わせ。ただし完全に気を抜くのはまだ早い。";
    if(score >= 45) return "五分五分の共存。距離感を間違えると一気に崩れるので注意。";
    if(score >= 25) return "噛み合わない場面が多い組み合わせ。どちらかが先に折れることになりそう。";
    return "どちらかが確実に消耗する組み合わせ。無理に共存させない方がいいかもしれない。";
  }

  function renderFriendCompat(myResult){
    const panel = document.getElementById("friendCompatPanel");
    if(!state.incomingRef){
      panel.style.display = "none";
      window.__lastCompat = null;
      return;
    }
    const friendType = TYPES[state.incomingRef.code];
    const myType = TYPES[myResult.code];
    const score = computeCompatibility(myResult.scores, state.incomingRef.scores);
    const comment = compatComment(score);

    document.getElementById("friendCompatScore").innerHTML = score + "<span>%</span>";
    document.getElementById("friendCompatNames").textContent =
      `あなた「${myType.name}」 × 友達「${friendType.name}」`;
    document.getElementById("friendCompatComment").textContent = comment;
    panel.style.display = "block";

    window.__lastCompat = {
      myName: myType.name, friendName: friendType.name, score, comment,
    };
  }

  function renderGauge(score){
    const clamped = Math.max(0, Math.min(100, score));
    const numEl = document.getElementById("gaugeNum");
    const fillEl = document.getElementById("gaugeFill");
    const descEl = document.getElementById("gaugeDesc");

    descEl.textContent = gaugeComment(clamped);

    // 円グラフをリセットしてからアニメーションで塗る
    fillEl.style.transition = "none";
    fillEl.style.strokeDasharray = GAUGE_CIRCUMFERENCE;
    fillEl.style.strokeDashoffset = GAUGE_CIRCUMFERENCE;

    // カウントアップ + 円グラフのアニメーション
    let startTime = null;
    const duration = 1100;
    function tick(ts){
      if(startTime === null) startTime = ts;
      const elapsed = ts - startTime;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      numEl.textContent = Math.round(clamped * eased);
      if(t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(() => {
      fillEl.style.transition = `stroke-dashoffset ${duration}ms cubic-bezier(.65,0,.35,1)`;
      fillEl.style.strokeDashoffset = GAUGE_CIRCUMFERENCE * (1 - clamped / 100);
      requestAnimationFrame(tick);
    });
  }

  function renderResult(result, fromSaved){
    document.getElementById("savedNote").style.display = fromSaved ? "block" : "none";
    const type = TYPES[result.code];
    document.getElementById("resCode").textContent = "TYPE — " + result.code;
    document.getElementById("resTitle").innerHTML = type.name;
    document.getElementById("resSub").textContent = type.sub;
    document.getElementById("resDesc").textContent = type.desc;

    const ul = document.getElementById("resAlaruns");
    ul.innerHTML = "";
    type.alarms.forEach(a => {
      const li = document.createElement("li");
      li.textContent = a;
      ul.appendChild(li);
    });

    document.getElementById("compatGoodName").textContent = type.good.name;
    document.getElementById("compatGoodWhy").textContent = type.good.why;
    document.getElementById("compatBadName").textContent = type.bad.name;
    document.getElementById("compatBadWhy").textContent = type.bad.why;

    // フレネミー度: 表(S)側の強さ + 攻(A)側の強さ の平均。
    // 「表面上は友好的だが攻撃的」なほどフレネミー的、と定義。
    const surfaceScore = pct(result.scores.SU); // 高いほど表(S)寄り
    const attackScore = pct(result.scores.AD);  // 高いほど攻(A)寄り
    const frenemyDegree = Math.round((surfaceScore + attackScore) / 2);
    renderGauge(frenemyDegree);

    const barsWrap = document.getElementById("axisBars");
    barsWrap.innerHTML = "";
    AXES.forEach(axis => {
      const p = pct(result.scores[axis.key]);
      const row = document.createElement("div");
      row.className = "axis-bar-row";
      row.innerHTML = `
        <span class="lbl">${axis.leftLabel}</span>
        <span class="axis-bar-track">
          <span class="axis-bar-fill" style="width:${p}%;"></span>
          <span class="axis-bar-marker" style="left:${p}%;"></span>
        </span>
        <span class="lbl right">${axis.rightLabel}</span>
      `;
      barsWrap.appendChild(row);
    });

    renderFriendCompat(result);
    saveMyResult(result);

    window.__lastResult = { code: result.code, name: type.name, degree: frenemyDegree, scores: result.scores };
  }

  function shareText(){
    const r = window.__lastResult;
    if(!r) return "";
    return `【フレネミー診断】私は「${r.name}」タイプ(TYPE-${r.code})、フレネミー度${r.degree}でした。あなたはどのタイプ?`;
  }

  function compatShareText(){
    const c = window.__lastCompat;
    if(!c) return "";
    return `【フレネミー診断】「${c.myName}」×「${c.friendName}」の共存確率は${c.score}%でした!`;
  }

  // 自分のスコアを埋め込んだシェアURLを生成。
  // 友達がこのURLを開いて診断すると、2人の共存確率が自動で分かる。
  function buildShareUrl(){
    const r = window.__lastResult;
    if(!r) return location.href.split("?")[0];
    const base = location.href.split("?")[0];
    const params = new URLSearchParams({
      code: r.code,
      su: r.scores.SU, ad: r.scores.AD, le: r.scores.LE, ig: r.scores.IG,
    });
    return base + "?" + params.toString();
  }

  function copyResult(){
    logEvent("copy_text");
    const text = shareText() + "\n" + buildShareUrl();
    navigator.clipboard?.writeText(text).then(() => {
      const btn = document.getElementById("btnCopy");
      const original = btn.textContent;
      btn.textContent = "コピーしました ✓";
      setTimeout(() => btn.textContent = original, 1800);
    }).catch(() => {
      alert(text);
    });
  }

  function shareToX(){
    logEvent("share_x");
    const url = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(shareText()) + "&url=" + encodeURIComponent(buildShareUrl());
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function shareToLine(){
    logEvent("share_line");
    // LINEはURLスキームでテキスト+リンクの共有に対応(スマホでLINEアプリが開く)
    const text = shareText() + "\n" + buildShareUrl();
    const url = "https://line.me/R/msg/text/?" + encodeURIComponent(text);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function shareCompatToLine(){
    logEvent("share_compat_line");
    const text = compatShareText() + "\n" + buildShareUrl();
    const url = "https://line.me/R/msg/text/?" + encodeURIComponent(text);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // 結果カード画像をCanvasで生成してBlobを返す
  function buildResultCardBlob(){
    return new Promise((resolve) => {
      const r = window.__lastResult;
      if(!r){ resolve(null); return; }

      const W = 1080, H = 1350;
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");

      // 背景
      const bgGrad = ctx.createLinearGradient(0, 0, W, H);
      bgGrad.addColorStop(0, "#2c1830");
      bgGrad.addColorStop(1, "#211226");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      const radial1 = ctx.createRadialGradient(W*0.1, 0, 0, W*0.1, 0, W*0.7);
      radial1.addColorStop(0, "rgba(232,163,61,0.18)");
      radial1.addColorStop(1, "rgba(232,163,61,0)");
      ctx.fillStyle = radial1;
      ctx.fillRect(0, 0, W, H);

      const radial2 = ctx.createRadialGradient(W*0.9, H, 0, W*0.9, H, W*0.7);
      radial2.addColorStop(0, "rgba(58,169,160,0.2)");
      radial2.addColorStop(1, "rgba(58,169,160,0)");
      ctx.fillStyle = radial2;
      ctx.fillRect(0, 0, W, H);

      ctx.textAlign = "center";

      // eyebrow
      ctx.fillStyle = "#f0c47a";
      ctx.font = "600 28px sans-serif";
      ctx.fillText("FRENEMY TYPE TEST", W/2, 150);

      // 円グラフ(フレネミー度)
      const cx = W/2, cy = 430, radius = 190;
      ctx.lineWidth = 34;
      ctx.strokeStyle = "rgba(244,236,223,0.12)";
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI*2);
      ctx.stroke();

      const gaugeGrad = ctx.createLinearGradient(cx-radius, cy-radius, cx+radius, cy+radius);
      gaugeGrad.addColorStop(0, "#3aa9a0");
      gaugeGrad.addColorStop(1, "#e8a33d");
      ctx.strokeStyle = gaugeGrad;
      ctx.lineCap = "round";
      const startAngle = -Math.PI/2;
      const endAngle = startAngle + (Math.PI*2) * (r.degree/100);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.stroke();

      ctx.fillStyle = "#f4ecdf";
      ctx.font = "800 120px serif";
      ctx.fillText(String(r.degree), cx, cy + 40);
      ctx.font = "600 26px sans-serif";
      ctx.fillStyle = "rgba(244,236,223,0.6)";
      ctx.fillText("フレネミー度", cx, cy + 100);

      // タイプ名
      ctx.fillStyle = "rgba(244,236,223,0.5)";
      ctx.font = "700 26px sans-serif";
      ctx.fillText("TYPE — " + r.code, W/2, 730);

      ctx.fillStyle = "#f4ecdf";
      ctx.font = "800 68px serif";
      wrapCanvasText(ctx, r.name, W/2, 810, W-160, 78);

      // フッター
      ctx.fillStyle = "rgba(244,236,223,0.55)";
      ctx.font = "500 28px sans-serif";
      ctx.fillText("あなたのタイプは？ フレネミー診断", W/2, H-140);

      ctx.fillStyle = "rgba(244,236,223,0.4)";
      ctx.font = "400 24px sans-serif";
      ctx.fillText(buildShareUrl().replace(/^https?:\/\//, ""), W/2, H-90);

      canvas.toBlob((blob) => resolve(blob), "image/png", 0.95);
    });
  }

  // 共存確率カード画像をCanvasで生成してBlobを返す
  function buildCompatCardBlob(){
    return new Promise((resolve) => {
      const c = window.__lastCompat;
      if(!c){ resolve(null); return; }

      const W = 1080, H = 1350;
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");

      const bgGrad = ctx.createLinearGradient(0, 0, W, H);
      bgGrad.addColorStop(0, "#2c1830");
      bgGrad.addColorStop(1, "#211226");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      const radial1 = ctx.createRadialGradient(W*0.1, 0, 0, W*0.1, 0, W*0.7);
      radial1.addColorStop(0, "rgba(232,163,61,0.18)");
      radial1.addColorStop(1, "rgba(232,163,61,0)");
      ctx.fillStyle = radial1;
      ctx.fillRect(0, 0, W, H);

      const radial2 = ctx.createRadialGradient(W*0.9, H, 0, W*0.9, H, W*0.7);
      radial2.addColorStop(0, "rgba(58,169,160,0.2)");
      radial2.addColorStop(1, "rgba(58,169,160,0)");
      ctx.fillStyle = radial2;
      ctx.fillRect(0, 0, W, H);

      ctx.textAlign = "center";

      ctx.fillStyle = "#7fd4cb";
      ctx.font = "600 28px sans-serif";
      ctx.fillText("FRENEMY COEXISTENCE RATE", W/2, 150);

      // 二人の名前
      ctx.fillStyle = "#f4ecdf";
      ctx.font = "700 44px serif";
      wrapCanvasText(ctx, `「${c.myName}」`, W/2, 260, W-160, 56);
      ctx.fillStyle = "rgba(244,236,223,0.4)";
      ctx.font = "600 34px sans-serif";
      ctx.fillText("×", W/2, 330);
      ctx.fillStyle = "#f4ecdf";
      ctx.font = "700 44px serif";
      wrapCanvasText(ctx, `「${c.friendName}」`, W/2, 400, W-160, 56);

      // 共存確率の円グラフ
      const cx = W/2, cy = 720, radius = 190;
      ctx.lineWidth = 34;
      ctx.strokeStyle = "rgba(244,236,223,0.12)";
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI*2);
      ctx.stroke();

      const gaugeGrad = ctx.createLinearGradient(cx-radius, cy-radius, cx+radius, cy+radius);
      gaugeGrad.addColorStop(0, "#3aa9a0");
      gaugeGrad.addColorStop(1, "#e8a33d");
      ctx.strokeStyle = gaugeGrad;
      ctx.lineCap = "round";
      const startAngle = -Math.PI/2;
      const endAngle = startAngle + (Math.PI*2) * (c.score/100);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.stroke();

      ctx.fillStyle = "#f4ecdf";
      ctx.font = "800 130px serif";
      ctx.fillText(String(c.score) + "%", cx, cy + 45);
      ctx.font = "600 26px sans-serif";
      ctx.fillStyle = "rgba(244,236,223,0.6)";
      ctx.fillText("共存確率", cx, cy + 110);

      // コメント
      ctx.fillStyle = "rgba(244,236,223,0.85)";
      ctx.font = "500 32px sans-serif";
      wrapCanvasText(ctx, c.comment, W/2, 1040, W-200, 46);

      // フッター
      ctx.fillStyle = "rgba(244,236,223,0.55)";
      ctx.font = "500 28px sans-serif";
      ctx.fillText("あなたとの共存確率は？ フレネミー診断", W/2, H-140);

      ctx.fillStyle = "rgba(244,236,223,0.4)";
      ctx.font = "400 24px sans-serif";
      ctx.fillText(buildShareUrl().replace(/^https?:\/\//, ""), W/2, H-90);

      canvas.toBlob((blob) => resolve(blob), "image/png", 0.95);
    });
  }

  function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight){
    const chars = text.split("");
    let line = "";
    const lines = [];
    chars.forEach(ch => {
      const test = line + ch;
      if(ctx.measureText(test).width > maxWidth && line !== ""){
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    });
    if(line) lines.push(line);
    const totalHeight = lineHeight * (lines.length - 1);
    const startY = y - totalHeight/2;
    lines.forEach((l, i) => ctx.fillText(l, x, startY + i*lineHeight));
  }

  function downloadBlob(blob, filename){
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function shareImageGeneric(btnId, buildBlobFn, shareTextFn, filename, statusElId){
    const btn = document.getElementById(btnId);
    const original = btn.textContent;
    btn.textContent = "画像を作成中…";
    btn.disabled = true;

    try {
      const blob = await buildBlobFn();
      if(!blob) throw new Error("no result");
      const file = new File([blob], filename, { type: "image/png" });

      if(navigator.canShare && navigator.canShare({ files:[file] })){
        await navigator.share({
          files: [file],
          title: "フレネミー診断",
          text: shareTextFn(),
        });
      } else {
        // Web Share非対応環境: 画像をダウンロードしてもらう
        downloadBlob(blob, filename);
        document.getElementById(statusElId).textContent =
          "画像を保存しました。InstagramやLINEでシェアしてください。";
      }
    } catch(err){
      if(err && err.name !== "AbortError"){
        document.getElementById(statusElId).textContent =
          "画像の作成に失敗しました。テキストでのシェアをお試しください。";
      }
    } finally {
      btn.textContent = original;
      btn.disabled = false;
    }
  }

  async function downloadImageGeneric(btnId, buildBlobFn, filename, statusElId){
    const btn = document.getElementById(btnId);
    const original = btn.textContent;
    btn.textContent = "画像を作成中…";
    btn.disabled = true;
    try {
      const blob = await buildBlobFn();
      if(!blob) throw new Error("no result");
      downloadBlob(blob, filename);
      document.getElementById(statusElId).textContent =
        "画像を保存しました。InstagramやLINEでシェアしてください。";
    } catch(err){
      document.getElementById(statusElId).textContent =
        "画像の作成に失敗しました。テキストでのシェアをお試しください。";
    } finally {
      btn.textContent = original;
      btn.disabled = false;
    }
  }

  function shareImage(){
    logEvent("share_image");
    return shareImageGeneric("btnShareImage", buildResultCardBlob, shareText, "frenemy-result.png", "shareCopyText");
  }

  function downloadResultImage(){
    logEvent("download_image");
    return downloadImageGeneric("btnDownloadImage", buildResultCardBlob, "frenemy-result.png", "shareCopyText");
  }

  function shareCompatImage(){
    logEvent("share_compat_image");
    return shareImageGeneric("btnShareCompatImage", buildCompatCardBlob, compatShareText, "frenemy-compat.png", "shareCopyText");
  }

  function downloadCompatImage(){
    logEvent("download_compat_image");
    return downloadImageGeneric("btnDownloadCompatImage", buildCompatCardBlob, "frenemy-compat.png", "shareCopyText");
  }

  function retake(){
    state.current = 0;
    state.answers = new Array(QUESTIONS.length).fill(null);
    showScreen("intro");
  }

  document.getElementById("btnStart").addEventListener("click", () => {
    logEvent("quiz_start");
    state.current = 0;
    renderQuestion();
    showScreen("quiz");
  });
  document.getElementById("btnBack").addEventListener("click", goBack);
  document.getElementById("btnCopy").addEventListener("click", copyResult);
  document.getElementById("btnShareX").addEventListener("click", shareToX);
  document.getElementById("btnShareLine").addEventListener("click", shareToLine);
  document.getElementById("btnShareImage").addEventListener("click", shareImage);
  document.getElementById("btnDownloadImage").addEventListener("click", downloadResultImage);
  document.getElementById("btnShareCompatImage").addEventListener("click", shareCompatImage);
  document.getElementById("btnShareCompatLine").addEventListener("click", shareCompatToLine);
  document.getElementById("btnDownloadCompatImage").addEventListener("click", downloadCompatImage);
  document.getElementById("btnRetake").addEventListener("click", retake);

})();
