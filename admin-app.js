// ==========================================================
// フレネミー診断 ダッシュボード — メインロジック
//
// ★ 使用前に設定してください ★
// group-app.js / app.js と同じSupabaseプロジェクトの情報を設定します。
//
// ログインには Supabase Auth を使います。事前にSupabaseダッシュボードの
// 「Authentication」→「Users」から、自分用のログインアカウント(メール+
// パスワード)を1つ作成しておいてください。誰でもサインアップできる
// 画面は用意していません(このダッシュボードは限られた人だけが使う想定のため)。
// ==========================================================
const ADMIN_SUPABASE_URL = "https://rxstatkbpelbxkbgidta.supabase.co";
const ADMIN_SUPABASE_ANON_KEY = "sb_publishable_Wo6ELR2G2yoJhNKTkoeJnA_ae9j-fhz";

(function(){
  "use strict";

  let supabaseClient = null;
  async function getSupabase(){
    if(supabaseClient) return supabaseClient;
    const mod = await import("https://esm.sh/@supabase/supabase-js@2");
    supabaseClient = mod.createClient(ADMIN_SUPABASE_URL, ADMIN_SUPABASE_ANON_KEY);
    return supabaseClient;
  }

  const gateScreen = document.getElementById("gate-screen");
  const dashScreen = document.getElementById("dash-screen");

  document.getElementById("gateBtn").addEventListener("click", login);
  document.getElementById("gateInput").addEventListener("keydown", (e) => {
    if(e.key === "Enter") login();
  });

  async function login(){
    const email = document.getElementById("gateEmail").value.trim();
    const password = document.getElementById("gateInput").value;
    const errorEl = document.getElementById("gateError");
    errorEl.style.display = "none";

    if(!email || !password){
      errorEl.textContent = "メールアドレスとパスワードを入力してください";
      errorEl.style.display = "block";
      return;
    }

    const btn = document.getElementById("gateBtn");
    const original = btn.textContent;
    btn.textContent = "確認中…";
    btn.disabled = true;
    try {
      const sb = await getSupabase();
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if(error) throw error;

      gateScreen.classList.remove("active");
      dashScreen.classList.add("active");
      loadDashboard(7);
    } catch(e){
      errorEl.textContent = "ログインに失敗しました。メールアドレスとパスワードをご確認ください";
      errorEl.style.display = "block";
    } finally {
      btn.textContent = original;
      btn.disabled = false;
    }
  }

  // 既にログイン済みのセッションがあれば、そのまま自動でダッシュボードを開く
  (async function checkExistingSession(){
    try {
      const sb = await getSupabase();
      const { data } = await sb.auth.getSession();
      if(data && data.session){
        gateScreen.classList.remove("active");
        dashScreen.classList.add("active");
        loadDashboard(7);
      }
    } catch(e){ /* 未ログイン状態のまま */ }
  })();

  document.querySelectorAll(".range-tab[data-range]").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".range-tab[data-range]").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      loadDashboard(Number(tab.dataset.range));
    });
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    try {
      const sb = await getSupabase();
      await sb.auth.signOut();
    } catch(e){ /* 失敗しても画面はログイン画面に戻す */ }
    dashScreen.classList.remove("active");
    gateScreen.classList.add("active");
    document.getElementById("gateInput").value = "";
  });

  async function loadDashboard(rangeDays){
    document.getElementById("dashLoading").style.display = "block";
    document.getElementById("dashContent").style.display = "none";

    try {
      const sb = await getSupabase();
      let query = sb.from("analytics_events").select("event_type, type_code, created_at");
      if(rangeDays > 0){
        const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString();
        query = query.gte("created_at", since);
      }
      const { data, error } = await query;
      if(error) throw error;

      renderDashboard(data || []);
      document.getElementById("dashUpdatedAt").textContent =
        "最終更新: " + new Date().toLocaleString("ja-JP");
    } catch(e){
      document.getElementById("dashLoading").textContent =
        "データの取得に失敗しました。Supabaseの接続設定をご確認ください。";
      return;
    }

    document.getElementById("dashLoading").style.display = "none";
    document.getElementById("dashContent").style.display = "block";
  }

  function renderDashboard(events){
    const counts = {};
    events.forEach(e => { counts[e.event_type] = (counts[e.event_type] || 0) + 1; });

    const starts = counts.quiz_start || 0;
    const completes = counts.quiz_complete || 0;
    const shareTotal = (counts.share_image || 0) + (counts.share_line || 0) + (counts.share_x || 0) + (counts.copy_text || 0);
    const compatShareTotal = (counts.share_compat_image || 0) + (counts.share_compat_line || 0);

    document.getElementById("statStart").textContent = starts.toLocaleString();
    document.getElementById("statComplete").textContent = completes.toLocaleString();
    document.getElementById("statCompleteRate").textContent =
      starts > 0 ? `完了率 ${Math.round((completes / starts) * 100)}%` : "";
    document.getElementById("statShare").textContent = shareTotal.toLocaleString();
    document.getElementById("statCompatShare").textContent = compatShareTotal.toLocaleString();

    // タイプ分布(quiz_completeイベントのtype_codeを集計)
    const typeCounts = {};
    events.filter(e => e.event_type === "quiz_complete" && e.type_code).forEach(e => {
      typeCounts[e.type_code] = (typeCounts[e.type_code] || 0) + 1;
    });
    renderBarList("typeDistribution", Object.entries(typeCounts)
      .map(([code, count]) => ({ label: (TYPES[code] ? TYPES[code].name : code), count }))
      .sort((a, b) => b.count - a.count));

    // シェア手段の内訳
    const shareLabels = {
      share_image: "画像でシェア(個人)",
      share_line: "LINEで送る(個人)",
      share_x: "Xでシェア",
      copy_text: "テキストコピー",
      share_compat_image: "画像でシェア(共存確率)",
      share_compat_line: "LINEで送る(共存確率)",
      download_image: "画像を保存(個人)",
      download_compat_image: "画像を保存(共存確率)",
    };
    renderBarList("shareBreakdown", Object.entries(shareLabels)
      .map(([key, label]) => ({ label, count: counts[key] || 0 }))
      .filter(item => item.count > 0)
      .sort((a, b) => b.count - a.count));
  }

  function renderBarList(containerId, items){
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    if(items.length === 0){
      container.innerHTML = '<div style="font-size:12.5px; color:rgba(244,236,223,0.4);">データがまだありません</div>';
      return;
    }
    const max = Math.max(...items.map(i => i.count));
    items.forEach(item => {
      const pct = max > 0 ? (item.count / max) * 100 : 0;
      const row = document.createElement("div");
      row.className = "bar-row";
      row.innerHTML = `
        <div class="bar-name">${escapeHtml(item.label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;"></div></div>
        <div class="bar-num">${item.count}</div>
      `;
      container.appendChild(row);
    });
  }

  function escapeHtml(str){
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

})();
