(() => {
  const $ = (id) => document.getElementById(id);
  const STEPS = [
    ["opening", "始め"], ["axis", "軸"], ["incident", "出来事"], ["telling", "語り"], ["timeline", "順番"],
    ["probes", "掘る"], ["newcomer", "新人なら"], ["lineage", "教わった人"], ["confirm", "確かめ"],
  ];
  const PROBES = [
    ["cues", "手がかり"], ["knowledge", "知識"], ["similar_case", "似た経験"], ["goal", "守った物"],
    ["options", "迷った手"], ["deciding_factor", "決め手"], ["what_if", "もしも"],
  ];
  const CHUNK_MS = 5000; // how often the recording is sent
  const MIN_GAP_MS = 15000; // at most one suggestion per this long, unless asked for

  let recorder = null;
  let startedAt = 0;
  let timer = null;
  let lines = [];
  let linesAtLastMove = -1;
  let lastMoveAt = 0;
  let thinking = false;
  let move = null;
  let sending = Promise.resolve();

  const post = async (url, body) => {
    const res = await fetch(url, { method: "POST", body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  };

  function status(text, isError = false) {
    $("status").textContent = text;
    $("status").classList.toggle("error", isError);
  }

  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  function renderSteps() {
    const now = move ? STEPS.findIndex(([k]) => k === move.phase) : -1;
    const done = move?.phase === "done";
    $("steps").replaceChildren(
      ...STEPS.map(([, label], i) => {
        const li = document.createElement("li");
        li.textContent = label;
        if (done || i < now) li.className = "done";
        else if (i === now) {
          li.className = "now";
          li.setAttribute("aria-current", "step");
        }
        return li;
      }),
    );
  }

  function renderPoints() {
    const points = move?.covered.decision_points ?? [];
    $("points").replaceChildren(
      ...points.map((p) => {
        const card = document.createElement("article");
        card.className = "point";
        const head = document.createElement("div");
        const label = document.createElement("p");
        label.className = "label";
        label.textContent = "判断の点";
        const name = document.createElement("h2");
        name.className = "point-name";
        name.textContent = p.label_ja;
        head.append(label, name);
        const chips = document.createElement("ul");
        chips.className = "chips";
        for (const [key, text] of PROBES) {
          const li = document.createElement("li");
          li.textContent = text;
          if (p.probes_answered.includes(key)) li.className = "yes";
          chips.append(li);
        }
        card.append(head, chips);
        return card;
      }),
    );
  }

  function renderLines() {
    const box = $("lines");
    if (!lines.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = recorder ? "話し始めると、ここに文字が出ます。" : "まだ録音していません。";
      box.replaceChildren(li);
      return;
    }
    box.replaceChildren(
      ...lines.map((l, i) => {
        const li = document.createElement("li");
        if (i === lines.length - 1) li.className = "pending";
        const t = document.createElement("time");
        t.textContent = `[${clock(l.start)}]`;
        const span = document.createElement("span");
        span.textContent = l.text;
        li.append(t, span);
        return li;
      }),
    );
    box.scrollTop = box.scrollHeight;
  }

  function renderMove() {
    const next = document.querySelector(".next");
    next.classList.toggle("listening", Boolean(move?.listen_only));
    next.classList.remove("waiting");
    if (!move) return;
    $("next-label").textContent = move.listen_only ? "いまは聞くだけ（促すなら）" : move.phase === "done" ? "聞き取りは終わりです" : "次に聞くこと";
    $("question").textContent = move.next_question_ja;
    $("why").textContent = move.why_ja;
    $("backup").textContent = move.backup_question_ja ? `控え：${move.backup_question_ja}` : "";
    $("asked").disabled = !recorder || !move.next_question_ja;
    $("another").disabled = !recorder || !move.backup_question_ja;
    const notes = move.notes_ja ?? [];
    $("memo-wrap").hidden = !notes.length;
    $("memo").replaceChildren(...notes.map((n) => Object.assign(document.createElement("li"), { textContent: n })));
    renderSteps();
    renderPoints();
  }

  async function askNext(force = false) {
    if (thinking) return;
    if (!force && (lines.length === linesAtLastMove || Date.now() - lastMoveAt < MIN_GAP_MS)) return;
    thinking = true;
    status("次の質問を考えています…");
    try {
      linesAtLastMove = lines.length;
      move = await post("/api/next");
      lastMoveAt = Date.now();
      renderMove();
      status("");
    } catch (err) {
      status(`次の質問を出せませんでした（${err.message}）。少し待つと、もう一度試します。`, true);
    } finally {
      thinking = false;
    }
  }

  function sendChunk(blob) {
    sending = sending.then(async () => {
      try {
        const data = await post("/api/audio", blob);
        lines = data.lines;
        renderLines();
        askNext();
      } catch (err) {
        status(`録音を送れませんでした（${err.message}）。録音は続けています。`, true);
      }
    });
  }

  async function start() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
    } catch {
      status("マイクを使えませんでした。ブラウザのマイクの許可を確かめてください。", true);
      return;
    }
    recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    recorder.addEventListener("dataavailable", (e) => e.data.size && sendChunk(e.data));
    recorder.addEventListener("stop", () => stream.getTracks().forEach((t) => t.stop()));
    recorder.start(CHUNK_MS);
    startedAt = Date.now();
    timer = setInterval(() => ($("rec-time").textContent = clock((Date.now() - startedAt) / 1000)), 1000);
    document.body.classList.add("recording");
    $("rec-button").textContent = "録音を止める";
    renderLines();
    askNext(true);
  }

  function stop() {
    recorder.stop();
    recorder = null;
    clearInterval(timer);
    document.body.classList.remove("recording");
    // One recording per interview: a second one appended to the same file could not be decoded.
    $("rec-button").textContent = "録音しました";
    $("rec-button").disabled = true;
    $("asked").disabled = true;
    $("another").disabled = true;
    sending.then(() => status("録音を止めました。録音はこの回の live フォルダに残っています。"));
  }

  $("rec-button").addEventListener("click", () => (recorder ? stop() : start()));

  $("asked").addEventListener("click", async () => {
    const q = move?.next_question_ja;
    if (!q) return;
    $("asked").disabled = true;
    try {
      await post("/api/asked", JSON.stringify({ question: q }));
    } catch (err) {
      status(`記録できませんでした（${err.message}）`, true);
    }
    document.querySelector(".next").classList.add("waiting");
    $("next-label").textContent = "答えを聞いています";
    // The next suggestion comes once the answer has started to arrive.
    linesAtLastMove = lines.length;
    lastMoveAt = Date.now();
  });

  $("another").addEventListener("click", () => {
    if (!move?.backup_question_ja) return;
    move = { ...move, next_question_ja: move.backup_question_ja, backup_question_ja: "", why_ja: "控えの質問です。" };
    renderMove();
  });

  fetch("/api/state")
    .then((r) => r.json())
    .then((s) => {
      $("craft").textContent = s.craft;
      lines = s.lines ?? [];
      move = s.move;
      renderLines();
      renderSteps();
      if (move) renderMove();
      if (lines.length) {
        $("rec-button").textContent = "録音しました";
        $("rec-button").disabled = true;
        status("この回にはもう録音があります。新しく録る時は、別の回の名前（--ep）で起動してください。");
      }
    })
    .catch(() => status("サーバーにつながりません。node src/cli.ts interview で起動してください。", true));
})();
