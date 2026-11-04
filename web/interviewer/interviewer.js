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
  // The demo only: the steps of making the episode after the interview, shown in the same step line.
  const MAKE_STEPS = { ingest: "書き起こし", storyboard: "コマ割り", draw: "絵", review: "見直し", redraw: "描き直し", voice: "声" };
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
  let make = null; // the demo's progress, null outside the demo
  let makeStartedAt = 0;

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
    if (make && make.state !== "idle") return renderMakeSteps();
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
    const waitOnly = move.listen_only && !move.next_question_ja;
    $("next-label").textContent = move.listen_only ? (waitOnly ? "いまは聞くだけ" : "いまは聞くだけ（促すなら）") : move.phase === "done" ? "聞き取りは終わりです" : "次に聞くこと";
    $("question").textContent = waitOnly ? "返事を待ちましょう。" : move.next_question_ja;
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


  const panelName = (id) => `${id.replace(/^p/, "")} コマ目`;

  function makeText(m) {
    if (m.state === "done") return ["漫画ができました", "公開の前に、親方と一緒に確かめます。", "セリフを 1 つずつ聞いて、字と声を確かめます。"];
    if (m.state === "failed") return ["止まりました", m.error ?? "途中で止まりました。", "もう一度押すと、できた所の続きから作ります。"];
    if (m.state === "idle") return ["録音しました", "この録音から、漫画を作ります。", "書き起こしから絵と声まで、15〜20 分ほどかかります。"];
    const label = "漫画にしています";
    switch (m.step) {
      case "ingest":
        return [label, "録音を文字にしています", "この Mac の中で書き起こすので、親方の声はここでは外に出ません。"];
      case "storyboard":
        return [label, "聞き違いを直し、コマ割りとセリフの訳を作っています", "親方のセリフは、録音で話した言葉だけで作ります。"];
      case "draw":
        if (m.drawn === 0 && m.sheets < 3 && m.steps.includes("review"))
          return [label, `人物と材料の見本を描いています（${m.sheets} / 3）`, "どのコマも、この見本を見ながら描きます。"];
        return [label, `絵を描いています（${m.drawn} / ${m.panels} コマ）`, "絵には字を描かせません。セリフは後から重ねます。"];
      case "review":
        return [label, "描いた絵を 3 回見直しています", "話の流れ、人物、手元と小物の順に見ます。"];
      case "redraw":
        return m.redraw.length
          ? [label, `見直しで直す所が見つかったコマを描き直しています（${m.redraw.map(panelName).join("、")}）`, "描き直すのは、読む人を迷わせる所だけです。"]
          : [label, "描き直すコマがあるか確かめています", ""];
      case "voice":
        return [label, "親方の声をセリフごとに切り出しています", "コマを押すと、この声が鳴ります。"];
      default:
        return [label, "", ""];
    }
  }

  function renderMakeSteps() {
    const keys = make.steps;
    const now = keys.indexOf(make.step);
    $("steps").style.gridTemplateColumns = `repeat(${keys.length}, 1fr)`;
    $("steps").setAttribute("aria-label", "漫画にする進み具合");
    $("steps").replaceChildren(
      ...keys.map((k, i) => {
        const li = document.createElement("li");
        li.textContent = MAKE_STEPS[k];
        if (make.state === "done" || i < now) li.className = "done";
        else if (i === now && make.state === "running") {
          li.className = "now";
          li.setAttribute("aria-current", "step");
        }
        return li;
      }),
    );
  }

  function renderMake() {
    const [label, question, why] = makeText(make);
    document.querySelector(".next").classList.remove("listening", "waiting");
    $("next-label").textContent = label;
    $("question").textContent = question;
    $("why").textContent = why;
    $("backup").textContent = "";
    $("asked").hidden = true;
    $("another").hidden = true;
    $("make").hidden = make.state === "running" || make.state === "done";
    $("make").textContent = make.state === "failed" ? "もう一度試す" : "漫画にする";
    $("to-confirm").hidden = make.state !== "done";
    if (make.confirm) $("to-confirm").href = make.confirm;
    if (make.state === "running") status(makeStartedAt ? `経過 ${clock((Date.now() - makeStartedAt) / 1000)}` : "");
    else if (make.state !== "failed") status("");
    if (make.state !== "idle") renderMakeSteps();
  }

  async function pollMake() {
    try {
      make = await fetch("/api/make").then((r) => r.json());
      renderMake();
    } catch (err) {
      status(`進み具合を読めませんでした（${err.message}）。`, true);
    }
    if (make?.state === "running") setTimeout(pollMake, 2000);
  }

  $("make").addEventListener("click", async () => {
    $("make").disabled = true;
    try {
      makeStartedAt = Date.now();
      make = await post("/api/make");
      renderMake();
      pollMake();
    } catch (err) {
      status(`漫画にできませんでした（${err.message}）`, true);
    } finally {
      $("make").disabled = false;
    }
  });

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
    recorder.addEventListener("stop", () => {
      stream.getTracks().forEach((t) => t.stop());
      // The last piece of audio is queued before "stop" fires, so this waits for all of it.
      sending.then(() => {
        if (make) renderMake();
        else status("録音を止めました。録音はこの回の live フォルダに残っています。");
      });
    });
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
      make = s.make;
      renderLines();
      renderSteps();
      if (move) renderMove();
      if (lines.length) {
        $("rec-button").textContent = "録音しました";
        $("rec-button").disabled = true;
        status("この回にはもう録音があります。新しく録る時は、別の回の名前（--ep）で起動してください。");
      }
      if (make && (make.recorded || make.state !== "idle")) {
        renderMake();
        if (make.state === "running") pollMake();
      }
    })
    .catch(() => status("サーバーにつながりません。node src/cli.ts interview で起動してください。", true));
})();
