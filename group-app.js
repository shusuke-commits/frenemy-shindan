// ==========================================================
// フレネミー診断 グループ版 — メインロジック
//
// ★★★ 使用前に必ず設定してください ★★★
// Supabaseのプロジェクトを作成し、group-schema.sql の内容を
// SQL Editorで実行した後、以下の2つの値を書き換えてください。
// (Supabaseダッシュボード → Project Settings → API から取得できます)
// ==========================================================
const SUPABASE_URL = "https://rxstatkbpelbxkbgidta.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Wo6ELR2G2yoJhNKTkoeJnA_ae9j-fhz";

(function(){
  "use strict";

  const POLL_INTERVAL_MS = 2500;

  const state = {
    supabase: null,
    room: null,          // {id, code, mode, started_at}
    me: null,            // {id, nickname}
    participants: [],    // 部屋の全参加者
    lobbyPollTimer: null,
    waitPollTimer: null,
    selfAnswers: new Array(QUESTIONS.length).fill(null),
    selfCurrent: 0,
    voteAnswers: new Array(VOTE_QUESTIONS.length).fill(null), // target_participant_id
    voteCurrent: 0,
  };

  const screens = {};
  ["g-landing","g-create","g-join","g-lobby","g-quiz-self","g-quiz-vote","g-waiting","g-results"]
    .forEach(id => screens[id] = document.getElementById(id));

  function showScreen(id){
    Object.values(screens).forEach(s => s.classList.remove("active"));
    screens[id].classList.add("active");
    window.scrollTo({top:0, behavior:"smooth"});
  }

  function showError(elId, msg){
    const el = document.getElementById(elId);
    el.textContent = msg;
    el.style.display = "block";
  }
  function clearError(elId){
    const el = document.getElementById(elId);
    el.style.display = "none";
  }

  // -------------------- 初期化(Supabase接続) --------------------
  let supabaseReady = null;
  async function getSupabase(){
    if(state.supabase) return state.supabase;
    if(!supabaseReady){
      supabaseReady = import("https://esm.sh/@supabase/supabase-js@2").then(mod => {
        state.supabase = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        return state.supabase;
      });
    }
    return supabaseReady;
  }

    function logEvent(eventType, typeCode){
          getSupabase().then(sb => {
                  sb.from("analytics_events").insert({ event_type: eventType, type_code: typeCode || null }).then(() => {}, () => {});
          }).catch(() => {});
    }

  function generateRoomCode(){
    // 紛らわしい文字(0/O, 1/I)を避けた6文字コード
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for(let i=0; i<6; i++) code += chars[Math.floor(Math.random()*chars.length)];
    return code;
  }

  // -------------------- スコア計算(個人版と同じロジック) --------------------
  function pct(scoreForAxis){
    const c = Math.max(-15, Math.min(15, scoreForAxis));
    return ((c + 15) / 30) * 100;
  }
  function computeCode(scores){
    let code = "";
    AXES.forEach(axis => { code += (scores[axis.key] >= 0) ? axis.left : axis.right; });
    return code;
  }
  function frenemyDegree(scores){
    return Math.round((pct(scores.SU) + pct(scores.AD)) / 2);
  }
  function averageScores(scoresList){
    const sum = {SU:0, AD:0, LE:0, IG:0};
    scoresList.forEach(s => { AXES.forEach(a => sum[a.key] += s[a.key]); });
    const avg = {};
    AXES.forEach(a => avg[a.key] = sum[a.key] / scoresList.length);
    return avg;
  }

  // -------------------- 参加者アイデンティティの保存/復元 --------------------
  function saveIdentity(roomCode, participantId, nickname){
    try {
      localStorage.setItem("frenemy_group_" + roomCode, JSON.stringify({ id: participantId, nickname }));
    } catch(e){}
  }
  function loadIdentity(roomCode){
    try {
      const raw = localStorage.getItem("frenemy_group_" + roomCode);
      return raw ? JSON.parse(raw) : null;
    } catch(e){ return null; }
  }

  // -------------------- URLパラメータ(招待リンク)の処理 --------------------
  function getUrlRoomCode(){
    const params = new URLSearchParams(location.search);
    const code = params.get("room");
    return code ? code.toUpperCase() : null;
  }

  // ==========================================================
  // 画面: LANDING
  // ==========================================================
  document.getElementById("btnGoCreate").addEventListener("click", () => {
    showScreen("g-create");
  });

  document.getElementById("btnGoJoin").addEventListener("click", async () => {
    const code = document.getElementById("joinCodeInput").value.trim().toUpperCase();
    clearError("joinCodeError");
    if(!code){ showError("joinCodeError", "部屋コードを入力してください"); return; }
    await enterJoinScreen(code);
  });

  async function enterJoinScreen(code){
    const btn = document.getElementById("btnGoJoin");
    const original = btn.textContent;
    btn.textContent = "確認中…";
    btn.disabled = true;
    try {
      const sb = await getSupabase();
      const { data, error } = await sb.from("rooms").select("*").eq("code", code).single();
      if(error || !data){
        showError("joinCodeError", "その部屋コードは見つかりませんでした");
        return;
      }
      state.room = data;
      document.getElementById("joinRoomInfo").textContent =
        `部屋コード「${data.code}」(${data.mode === "self" ? "自己診断モード" : "匿名投票モード"})に参加します`;
      showScreen("g-join");
    } catch(e){
      showError("joinCodeError", "通信エラーが発生しました。もう一度お試しください");
    } finally {
      btn.textContent = original;
      btn.disabled = false;
    }
  }

  // ==========================================================
  // 画面: CREATE ROOM
  // ==========================================================
  let selectedMode = "self";
  document.getElementById("modeSelfBtn").addEventListener("click", () => {
    selectedMode = "self";
    document.getElementById("modeSelfBtn").classList.add("selected");
    document.getElementById("modeVoteBtn").classList.remove("selected");
  });
  document.getElementById("modeVoteBtn").addEventListener("click", () => {
    selectedMode = "vote";
    document.getElementById("modeVoteBtn").classList.add("selected");
    document.getElementById("modeSelfBtn").classList.remove("selected");
  });
  document.getElementById("backFromCreate").addEventListener("click", (e) => {
    e.preventDefault();
    showScreen("g-landing");
  });

  document.getElementById("btnCreateRoom").addEventListener("click", async () => {
    const nickname = document.getElementById("createNicknameInput").value.trim();
    clearError("createError");
    if(!nickname){ showError("createError", "ニックネームを入力してください"); return; }

    const btn = document.getElementById("btnCreateRoom");
    const original = btn.textContent;
    btn.textContent = "作成中…";
    btn.disabled = true;
    try {
      const sb = await getSupabase();
      const code = generateRoomCode();
      const { data: room, error: roomErr } = await sb.from("rooms")
        .insert({ code, mode: selectedMode })
        .select().single();
      if(roomErr) throw roomErr;

      const { data: participant, error: pErr } = await sb.from("participants")
        .insert({ room_id: room.id, nickname })
        .select().single();
      if(pErr) throw pErr;

      state.room = room;
      state.me = participant;
      saveIdentity(room.code, participant.id, nickname);
            logEvent("group_room_create", selectedMode);
      enterLobby();
    } catch(e){
      showError("createError", "部屋の作成に失敗しました。通信環境をご確認ください");
    } finally {
      btn.textContent = original;
      btn.disabled = false;
    }
  });

  // ==========================================================
  // 画面: JOIN ROOM
  // ==========================================================
  document.getElementById("backFromJoin").addEventListener("click", (e) => {
    e.preventDefault();
    showScreen("g-landing");
  });

  document.getElementById("btnJoinRoom").addEventListener("click", async () => {
    const nickname = document.getElementById("joinNicknameInput").value.trim();
    clearError("joinError");
    if(!nickname){ showError("joinError", "ニックネームを入力してください"); return; }

    const btn = document.getElementById("btnJoinRoom");
    const original = btn.textContent;
    btn.textContent = "参加中…";
    btn.disabled = true;
    try {
      const sb = await getSupabase();
      const { data: participant, error } = await sb.from("participants")
        .insert({ room_id: state.room.id, nickname })
        .select().single();
      if(error) throw error;

      state.me = participant;
      saveIdentity(state.room.code, participant.id, nickname);
            logEvent("group_room_join", state.room.mode);
      enterLobby();
    } catch(e){
      showError("joinError", "参加に失敗しました。通信環境をご確認ください");
    } finally {
      btn.textContent = original;
      btn.disabled = false;
    }
  });

  // ==========================================================
  // 画面: LOBBY
  // ==========================================================
  function enterLobby(){
    document.getElementById("lobbyModeLabel").textContent =
      state.room.mode === "self" ? "SELF-DIAGNOSIS MODE" : "ANONYMOUS VOTE MODE";
    document.getElementById("lobbyRoomCode").textContent = state.room.code;
    showScreen("g-lobby");
    startLobbyPolling();
  }

  function startLobbyPolling(){
    stopLobbyPolling();
    pollLobby();
    state.lobbyPollTimer = setInterval(pollLobby, POLL_INTERVAL_MS);
  }
  function stopLobbyPolling(){
    if(state.lobbyPollTimer){ clearInterval(state.lobbyPollTimer); state.lobbyPollTimer = null; }
  }

  async function pollLobby(){
    try {
      const sb = await getSupabase();
      const [{ data: participants }, { data: room }] = await Promise.all([
        sb.from("participants").select("*").eq("room_id", state.room.id).order("created_at"),
        sb.from("rooms").select("*").eq("id", state.room.id).single(),
      ]);
      state.participants = participants || [];
      state.room = room || state.room;

      document.getElementById("lobbyParticipantCount").textContent = `${state.participants.length}人が参加中`;
      const list = document.getElementById("lobbyParticipantList");
      list.innerHTML = "";
      state.participants.forEach(p => {
        const li = document.createElement("li");
        li.innerHTML = `<span class="p-dot"></span><span>${escapeHtml(p.nickname)}</span>`;
        list.appendChild(li);
      });

      const startBtn = document.getElementById("btnStartQuiz");
      if(state.participants.length >= 2){
        startBtn.disabled = false;
        startBtn.textContent = "みんなで診断/投票を始める";
      } else {
        startBtn.disabled = true;
        startBtn.textContent = "2人以上集まったら開始できます";
      }

      // 誰かが既に開始していたら、自分もクイズ画面へ
      if(state.room.started_at){
        stopLobbyPolling();
        beginQuizFlow();
      }
    } catch(e){ /* ポーリング失敗時は次回リトライ */ }
  }

  document.getElementById("btnStartQuiz").addEventListener("click", async () => {
    try {
      const sb = await getSupabase();
      await sb.from("rooms").update({ started_at: new Date().toISOString() }).eq("id", state.room.id);
      stopLobbyPolling();
      beginQuizFlow();
    } catch(e){ /* 失敗しても他の人のポーリングで拾われる可能性があるため静かに失敗 */ }
  });

  document.getElementById("btnCopyRoomLink").addEventListener("click", () => {
    const url = location.origin + location.pathname + "?room=" + state.room.code;
    navigator.clipboard?.writeText(url).then(() => {
      const btn = document.getElementById("btnCopyRoomLink");
      const original = btn.textContent;
      btn.textContent = "コピーしました ✓";
      setTimeout(() => btn.textContent = original, 1800);
    }).catch(() => alert(url));
  });

    document.getElementById("btnShareRoomLine").addEventListener("click", () => {
          logEvent("group_share_room_line");
          const url = location.origin + location.pathname + "?room=" + state.room.code;
          const text = "フレネミー診断、一緒にやろう！\n" + url;
          const lineUrl = "https://line.me/R/msg/text/?" + encodeURIComponent(text);
          window.open(lineUrl, "_blank", "noopener,noreferrer");
    });

  function beginQuizFlow(){
    if(state.room.mode === "self"){
      state.selfCurrent = 0;
      state.selfAnswers = new Array(QUESTIONS.length).fill(null);
      renderSelfQuestion();
      showScreen("g-quiz-self");
    } else {
      state.voteCurrent = 0;
      state.voteAnswers = new Array(VOTE_QUESTIONS.length).fill(null);
      renderVoteQuestion();
      showScreen("g-quiz-vote");
    }
  }

  function escapeHtml(str){
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ==========================================================
  // 画面: SELF-MODE QUIZ (個人版と同じ-3〜+3の6択)
  // ==========================================================
  const SCALE_LABELS = [
    {v: 3, label:"とても当てはまる", cls:"lv6"},
    {v: 2, label:"当てはまる", cls:"lv5"},
    {v: 1, label:"やや当てはまる", cls:"lv4"},
    {v:-1, label:"やや当てはまらない", cls:"lv3"},
    {v:-2, label:"当てはまらない", cls:"lv2"},
    {v:-3, label:"全く当てはまらない", cls:"lv1"},
  ];
  const LV_COLORS = {
    lv1:{bg:"#3aa9a0", fg:"#211226"}, lv2:{bg:"#7fd4cb", fg:"#211226"},
    lv3:{bg:"rgba(127,212,203,0.22)", fg:"#7fd4cb"}, lv4:{bg:"rgba(240,196,122,0.22)", fg:"#f0c47a"},
    lv5:{bg:"#f0c47a", fg:"#211226"}, lv6:{bg:"#e8a33d", fg:"#211226"},
  };

  function renderSelfQuestion(){
    const idx = state.selfCurrent;
    const q = QUESTIONS[idx];
    document.getElementById("selfProgressLabel").textContent = `質問 ${idx+1} / ${QUESTIONS.length}`;
    document.getElementById("selfProgressFill").style.width = (idx / QUESTIONS.length * 100) + "%";
    document.getElementById("selfQText").textContent = q.text;

    const wrap = document.getElementById("selfScale");
    wrap.innerHTML = "";
    SCALE_LABELS.forEach(opt => {
      const btn = document.createElement("button");
      btn.className = "scale-btn";
      const col = LV_COLORS[opt.cls];
      const numText = opt.v > 0 ? "+" + opt.v : String(opt.v);
      btn.innerHTML = `<span class="num-badge" style="background:${col.bg};color:${col.fg};">${numText}</span><span>${opt.label}</span>`;
      btn.addEventListener("click", () => {
        state.selfAnswers[idx] = opt.v;
        if(idx < QUESTIONS.length - 1){
          state.selfCurrent++;
          renderSelfQuestion();
        } else {
          submitSelfResult();
        }
      });
      wrap.appendChild(btn);
    });
  }

  async function submitSelfResult(){
    const scores = {SU:0, AD:0, LE:0, IG:0};
    QUESTIONS.forEach((q, i) => {
      const signed = state.selfAnswers[i];
      scores[q.axis] += (q.dir === "left") ? signed : -signed;
    });
    const code = computeCode(scores);

    showScreen("g-waiting");
    document.getElementById("waitingLabel").textContent = "他のメンバーの回答を待っています…";
    try {
      const sb = await getSupabase();
      await sb.from("self_results").upsert({
        room_id: state.room.id, participant_id: state.me.id, code, scores,
      }, { onConflict: "participant_id" });
    } catch(e){ /* 送信失敗時もポーリングで再試行される想定 */ }

    startWaitPolling(async () => {
      const sb = await getSupabase();
      const [{ data: participants }, { data: results }] = await Promise.all([
        sb.from("participants").select("*").eq("room_id", state.room.id),
        sb.from("self_results").select("*").eq("room_id", state.room.id),
      ]);
      if(!participants || !results) return false;
      document.getElementById("waitingLabel").textContent =
        `他のメンバーの回答を待っています…(${results.length}/${participants.length}人)`;
      return results.length >= participants.length;
    }, () => showSelfResults());
  }

  // ==========================================================
  // 画面: VOTE-MODE QUIZ
  // ==========================================================
  function renderVoteQuestion(){
    const idx = state.voteCurrent;
    const q = VOTE_QUESTIONS[idx];
    document.getElementById("voteProgressLabel").textContent = `質問 ${idx+1} / ${VOTE_QUESTIONS.length}`;
    document.getElementById("voteProgressFill").style.width = (idx / VOTE_QUESTIONS.length * 100) + "%";
    document.getElementById("voteQText").textContent = q.text;

    const wrap = document.getElementById("voteTargetList");
    wrap.innerHTML = "";
    state.participants.forEach(p => {
      const btn = document.createElement("button");
      btn.className = "vote-target-btn";
      btn.textContent = p.nickname;
      btn.addEventListener("click", () => {
        state.voteAnswers[idx] = p.id;
        if(idx < VOTE_QUESTIONS.length - 1){
          state.voteCurrent++;
          renderVoteQuestion();
        } else {
          submitVotes();
        }
      });
      wrap.appendChild(btn);
    });
  }

  async function submitVotes(){
    showScreen("g-waiting");
    document.getElementById("waitingLabel").textContent = "他のメンバーの投票を待っています…";
    try {
      const sb = await getSupabase();
      const rows = VOTE_QUESTIONS.map((q, i) => ({
        room_id: state.room.id,
        question_index: i,
        voter_participant_id: state.me.id,
        target_participant_id: state.voteAnswers[i],
      }));
      await sb.from("votes").upsert(rows, { onConflict: "voter_participant_id,question_index" });
    } catch(e){ /* 送信失敗時もポーリングで再試行される想定 */ }

    const totalExpectedVotes = state.participants.length * VOTE_QUESTIONS.length;
    startWaitPolling(async () => {
      const sb = await getSupabase();
      const { data: votes } = await sb.from("votes").select("id").eq("room_id", state.room.id);
      if(!votes) return false;
      const votedParticipants = new Set();
      // 進捗表示用に、投票完了した人数を概算(1人20票のはず)
      const { data: allVotes } = await sb.from("votes").select("voter_participant_id").eq("room_id", state.room.id);
      (allVotes || []).forEach(v => votedParticipants.add(v.voter_participant_id));
      document.getElementById("waitingLabel").textContent =
        `他のメンバーの投票を待っています…(${votedParticipants.size}/${state.participants.length}人)`;
      return votes.length >= totalExpectedVotes;
    }, () => showVoteResults());
  }

  // -------------------- 待機ポーリング共通処理 --------------------
  function startWaitPolling(checkFn, onComplete){
    stopWaitPolling();
    const tick = async () => {
      const done = await checkFn();
      if(done){
        stopWaitPolling();
        onComplete();
      }
    };
    tick();
    state.waitPollTimer = setInterval(tick, POLL_INTERVAL_MS);
  }
  function stopWaitPolling(){
    if(state.waitPollTimer){ clearInterval(state.waitPollTimer); state.waitPollTimer = null; }
  }

  // ==========================================================
  // 結果表示: 自己診断モード
  // ==========================================================
  async function showSelfResults(){
    try {
      const sb = await getSupabase();
      const [{ data: participants }, { data: results }] = await Promise.all([
        sb.from("participants").select("*").eq("room_id", state.room.id),
        sb.from("self_results").select("*").eq("room_id", state.room.id),
      ]);

      const resultByParticipant = {};
      (results || []).forEach(r => resultByParticipant[r.participant_id] = r);

      const ranking = (participants || [])
        .filter(p => resultByParticipant[p.id])
        .map(p => {
          const r = resultByParticipant[p.id];
                    return { participantId: p.id, nickname: p.nickname, code: r.code, scores: r.scores, degree: frenemyDegree(r.scores) };
        })
        .sort((a, b) => b.degree - a.degree);

      renderRanking(ranking, "フレネミー度ランキング", (item) => `${item.degree}`, (item) => TYPES[item.code].name);

      const avgScores = averageScores(ranking.map(r => r.scores));
            const groupCode = renderGroupType(avgScores);
            logEvent("group_quiz_complete_self", groupCode);

      showScreen("g-results");
    } catch(e){
      document.getElementById("waitingLabel").textContent = "結果の取得に失敗しました。ページを再読み込みしてください。";
    }
  }

  // ==========================================================
  // 結果表示: 匿名投票モード
  // ==========================================================
  async function showVoteResults(){
    try {
      const sb = await getSupabase();
      const [{ data: participants }, { data: votes }] = await Promise.all([
        sb.from("participants").select("*").eq("room_id", state.room.id),
        sb.from("votes").select("*").eq("room_id", state.room.id),
      ]);

      // 参加者ごとに得票を軸スコアへ変換(個人版と同じ4軸ロジックに乗せる)
      const scoresByParticipant = {};
      (participants || []).forEach(p => { scoresByParticipant[p.id] = {SU:0, AD:0, LE:0, IG:0}; });

      (votes || []).forEach(v => {
        const q = VOTE_QUESTIONS[v.question_index];
        if(!q || !scoresByParticipant[v.target_participant_id]) return;
        // 個人版は1問あたり最大±3点×5問=最大±15点のスケール。
        // 投票モードは1問1票(±1)なので、同じ0〜100%の尺度に乗せるため3倍に補正する。
        scoresByParticipant[v.target_participant_id][q.axis] += (q.dir === "left") ? 3 : -3;
      });

      const ranking = (participants || []).map(p => {
        const scores = scoresByParticipant[p.id];
        const code = computeCode(scores);
              return { participantId: p.id, nickname: p.nickname, code, scores, degree: frenemyDegree(scores) };
      }).sort((a, b) => b.degree - a.degree);

      renderRanking(ranking, "投票で見えたタイプ", (item) => `${item.degree}`, (item) => TYPES[item.code].name);

      const avgScores = averageScores(ranking.map(r => r.scores));
            const groupCode = renderGroupType(avgScores);
            logEvent("group_quiz_complete_vote", groupCode);

      showScreen("g-results");
    } catch(e){
      document.getElementById("waitingLabel").textContent = "結果の取得に失敗しました。ページを再読み込みしてください。";
    }
  }

function renderRanking(ranking, title, scoreFn, typeNameFn){
      state.lastRanking = ranking;
      document.getElementById("rankTitle").textContent = title;
      const list = document.getElementById("rankList");
      list.innerHTML = "";
      ranking.forEach((item, i) => {
              const isMe = state.me && item.participantId === state.me.id;
              const li = document.createElement("li");
              li.className = "rank-item" + (i === 0 ? " top" : "") + (isMe ? " is-me" : "");
              li.innerHTML = `
                      <div class="rank-num">${i+1}</div>
                              <div class="rank-body">
                                        <div class="rank-name">${escapeHtml(item.nickname)}${isMe ? '<span class="rank-me-tag">あなた</span>' : ""}</div>
                                                  <div class="rank-type">${escapeHtml(typeNameFn(item))}</div>
                                                          </div>
                                                                  <div class="rank-score" data-target="${scoreFn(item)}">0</div>
                                                                        `;
              list.appendChild(li);
      });
      requestAnimationFrame(() => {
              list.querySelectorAll(".rank-score").forEach(el => {
                        const target = parseInt(el.dataset.target, 10) || 0;
                        const start = performance.now();
                        const duration = 900;
                        function tick(now){
                                    const t = Math.min(1, (now - start) / duration);
                                    const eased = 1 - Math.pow(1 - t, 3);
                                    el.textContent = Math.round(target * eased);
                                    if(t < 1) requestAnimationFrame(tick);
                        }
                        requestAnimationFrame(tick);
              });
      });
}

function renderGroupType(avgScores){
      const code = computeCode(avgScores);
      const gt = GROUP_TYPES[code];
      document.getElementById("groupTypeName").textContent = gt.name;
      document.getElementById("groupTypeSub").textContent = gt.desc;
      state.lastGroupResult = { code, name: gt.name, sub: gt.desc };
      return code;
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

  function buildGroupResultCardBlob(){
        return new Promise((resolve) => {
                const r = state.lastGroupResult;
                if(!r){ resolve(null); return; }

                const W = 1080, H = 1350;
                const canvas = document.createElement("canvas");
                canvas.width = W; canvas.height = H;
                const ctx = canvas.getContext("2d");

                const bgGrad = ctx.createLinearGradient(0, 0, W, H);
                bgGrad.addColorStop(0, "#2c1830");
                bgGrad.addColorStop(1, "#211226");
                ctx.fillStyle = bgGrad;
                ctx.fillRect(0, 0, W, H);

                const radial = ctx.createRadialGradient(W*0.85, H*0.1, 0, W*0.85, H*0.1, W*0.7);
                radial.addColorStop(0, "rgba(58,169,160,0.22)");
                radial.addColorStop(1, "rgba(58,169,160,0)");
                ctx.fillStyle = radial;
                ctx.fillRect(0, 0, W, H);

                ctx.textAlign = "center";

                ctx.fillStyle = "#7fd4cb";
                ctx.font = "600 28px sans-serif";
                ctx.fillText("GROUP RESULT — FRENEMY TYPE TEST", W/2, 160);

                ctx.fillStyle = "rgba(244,236,223,0.6)";
                ctx.font = "600 26px sans-serif";
                ctx.fillText("このグループの正体は", W/2, 420);

                ctx.fillStyle = "#f4ecdf";
                ctx.font = "800 62px serif";
                wrapCanvasText(ctx, r.name, W/2, 520, W-140, 74);

                ctx.fillStyle = "rgba(244,236,223,0.75)";
                ctx.font = "500 30px sans-serif";
                wrapCanvasText(ctx, r.sub, W/2, 660, W-200, 44);

                const top3 = state.lastRanking ? state.lastRanking.slice(0, 3) : [];
                ctx.fillStyle = "rgba(244,236,223,0.55)";
                ctx.font = "600 26px sans-serif";
                ctx.fillText("フレネミー度ランキング TOP" + top3.length, W/2, 900);

                top3.forEach((item, i) => {
                          const y = 970 + i*80;
                          ctx.fillStyle = i === 0 ? "#e8a33d" : "rgba(244,236,223,0.7)";
                          ctx.font = "800 34px serif";
                          ctx.textAlign = "right";
                          ctx.fillText(String(i+1), W/2 - 160, y);
                          ctx.textAlign = "left";
                          ctx.fillStyle = "#f4ecdf";
                          ctx.font = "700 32px sans-serif";
                          ctx.fillText(item.nickname, W/2 - 120, y);
                          ctx.textAlign = "right";
                          ctx.fillStyle = "#e8a33d";
                          ctx.font = "800 32px serif";
                          ctx.fillText(String(item.degree), W/2 + 160, y);
                          ctx.textAlign = "center";
                });

                ctx.fillStyle = "rgba(244,236,223,0.5)";
                ctx.font = "500 28px sans-serif";
                ctx.fillText("みんなでフレネミー診断", W/2, H-120);
                ctx.fillStyle = "rgba(244,236,223,0.35)";
                ctx.font = "400 24px sans-serif";
                ctx.fillText(location.origin.replace(/^https?:\/\//, ""), W/2, H-75);

                canvas.toBlob((blob) => resolve(blob), "image/png", 0.95);
        });
  }

  
  // ==========================================================
  // 起動時: URLに ?room=CODE があれば参加フローへ誘導
  // ==========================================================
  (async function init(){
    const urlCode = getUrlRoomCode();
    if(!urlCode) return;
    await enterJoinScreen(urlCode);
  })();

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

  async function shareGroupImage(){
        const btn = document.getElementById("btnShareGroupImage");
        const original = btn.textContent;
        btn.textContent = "画像を作成中…";
        btn.disabled = true;
        try {
                const blob = await buildGroupResultCardBlob();
                if(!blob) throw new Error("no result");
                const file = new File([blob], "frenemy-group-result.png", { type: "image/png" });
                logEvent("group_share_image");
                if(navigator.canShare && navigator.canShare({ files:[file] })){
                          await navigator.share({ files: [file], title: "フレネミー診断 グループ結果" });
                          document.getElementById("groupShareStatus").textContent = "";
                } else {
                          downloadBlob(blob, "frenemy-group-result.png");
                          document.getElementById("groupShareStatus").textContent = "画像を保存しました。InstagramやLINEでシェアしてください。";
                }
        } catch(e){
                if(e && e.name !== "AbortError"){
                          document.getElementById("groupShareStatus").textContent = "画像の作成に失敗しました。テキストでのシェアをお試しください。";
                }
        } finally {
                btn.textContent = original;
                btn.disabled = false;
        }
  }

  async function downloadGroupImage(){
        const btn = document.getElementById("btnDownloadGroupImage");
        const original = btn.textContent;
        btn.textContent = "画像を作成中…";
        btn.disabled = true;
        try {
                const blob = await buildGroupResultCardBlob();
                if(!blob) throw new Error("no result");
                downloadBlob(blob, "frenemy-group-result.png");
                logEvent("group_download_image");
                document.getElementById("groupShareStatus").textContent = "画像を保存しました。InstagramやLINEでシェアしてください。";
        } catch(e){
                document.getElementById("groupShareStatus").textContent = "画像の作成に失敗しました。";
        } finally {
                btn.textContent = original;
                btn.disabled = false;
        }
  }

  function groupShareText(){
        const r = state.lastGroupResult;
        if(!r) return "みんなでフレネミー診断やってみた";
        return `私たちのグループは「${r.name}」でした！ #フレネミー診断`;
  }

    function shareGroupToLine(){
          logEvent("group_share_result_line");
          const text = groupShareText() + "\n" + location.origin;
          const url = "https://line.me/R/msg/text/?" + encodeURIComponent(text);
          window.open(url, "_blank", "noopener,noreferrer");
    }

    function shareGroupToX(){
          logEvent("group_share_result_x");
          const url = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(groupShareText()) + "&url=" + encodeURIComponent(location.origin);
          window.open(url, "_blank", "noopener,noreferrer");
    }

    document.getElementById("btnShareGroupImage").addEventListener("click", shareGroupImage);
    document.getElementById("btnDownloadGroupImage").addEventListener("click", downloadGroupImage);
    document.getElementById("btnShareGroupLine").addEventListener("click", shareGroupToLine);
    document.getElementById("btnShareGroupX").addEventListener("click", shareGroupToX);

    document.getElementById("btnRetakeSameRoom").addEventListener("click", () => {
          logEvent("group_retake_same_room");
          stopWaitPolling();
          beginQuizFlow();
    });

  
})();
