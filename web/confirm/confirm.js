(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children.filter((c) => c != null && c !== false));
    return node;
  };
  const WHO = { master: "親方", apprentice: "新人", narration: "ナレーション" };

  let ep = null;
  let current = 0;
  let editing = null; // balloon index being edited
  let recording = null; // { index, recorder }
  let busy = false;

  function notice(text, isError = false) {
    $("notice").replaceChildren(text);
    $("notice").classList.toggle("error", isError);
  }

  async function call(action, body, query = "") {
    if (busy) return;
    busy = true;
    try {
      const res = await fetch(`/api/${action}${query}`, { method: "POST", body: body instanceof Blob ? body : JSON.stringify(body ?? {}) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      ep = data;
      render();
      return data;
    } catch (err) {
      notice(`できませんでした（${err.message}）`, true);
    } finally {
      busy = false;
    }
  }

  const panel = () => ep.panels[current];

  function panelState(p) {
    if (p.balloons.some((b) => b.voiceState === "differs" && !b.removed)) return ["声とずれ", "warn"];
    if (ep.checked.includes(p.id)) return ["確かめた", "done"];
    return ["まだ", ""];
  }

  // The changed part of an edited line is underlined, so the veteran sees what the voice no longer says.
  function marked(text, original) {
    if (text === original) return [text];
    let s = 0;
    while (s < text.length && s < original.length && text[s] === original[s]) s++;
    let e = 0;
    while (e < text.length - s && e < original.length - s && text[text.length - 1 - e] === original[original.length - 1 - e]) e++;
    return [text.slice(0, s), el("mark", { textContent: text.slice(s, text.length - e) }), text.slice(text.length - e)];
  }

  function renderList() {
    $("panel-list").replaceChildren(
      ...ep.panels.map((p, i) => {
        const [label, cls] = panelState(p);
        const btn = el(
          "button",
          { type: "button", onclick: () => go(i) },
          el("span", { className: "no", textContent: String(i + 1) }),
          el("img", { src: p.image, alt: "" }),
          el("span", { className: `state ${cls}`, textContent: label }),
        );
        if (i === current) btn.setAttribute("aria-current", "true");
        btn.setAttribute("aria-label", `${i + 1} コマ目　${label}`);
        return el("li", {}, btn);
      }),
    );
  }

  function renderBalloon(b) {
    const voiced = b.speaker === "master" && b.hasVoice;
    const who = el("p", { className: "who", textContent: voiced ? "親方の声" : WHO[b.speaker] });
    if (editing === b.index) {
      const area = el("textarea", { value: b.text, ariaLabel: "セリフを直す" });
      const save = el("button", { type: "button", className: "btn-ink", textContent: "直した字にする", onclick: () => { editing = null; call("edit", { panel: panel().id, index: b.index, text: area.value }); } });
      const cancel = el("button", { type: "button", className: "btn-line", textContent: "やめる", onclick: () => { editing = null; render(); } });
      queueMicrotask(() => area.focus());
      return el("div", { className: "line" }, who, el("div", { className: "editor" }, area, el("div", {}, save, cancel)));
    }

    const bubble = el("div", { className: `bubble ${b.kind === "caption" ? "caption" : "speech"}${b.removed ? " removed" : ""}` }, ...marked(b.text, b.original));
    const parts = [who, bubble];

    if (!voiced) parts.push(el("p", { className: "note", textContent: `${WHO[b.speaker]}のセリフは声を使いません` }));
    else if (b.removed) parts.push(el("p", { className: "note", textContent: "このセリフは声を外しました。漫画には字だけが出ます。" }));
    else if (b.voiceState === "differs") parts.push(el("p", { className: "alert", textContent: "字を直したので、声は直す前のままです。" }));
    else if (b.voiceState === "recorded") parts.push(el("p", { className: "note", textContent: "録り直した声を使います。" }));
    else if (b.voiceState === "kept" && b.edited) parts.push(el("p", { className: "note", textContent: "声は直す前のまま使います。" }));

    const main = el("div", { className: "main" });
    const small = el("div", { className: "small" });
    if (voiced) {
      if (recording?.index === b.index) {
        main.append(
          el("span", { className: "recording", textContent: "録音しています" }),
          el("button", { type: "button", className: "btn-accent", textContent: "止める", onclick: stopRecording }),
        );
      } else if (b.voiceState === "differs" && !b.removed) {
        main.append(
          el("button", { type: "button", className: "btn-accent", textContent: "録り直す", onclick: () => startRecording(b.index) }),
          el("button", { type: "button", className: "btn-accent", textContent: "このまま使う", onclick: () => call("keep", { panel: panel().id, index: b.index }) }),
        );
      }
      small.append(el("button", { type: "button", className: "btn-small", textContent: "聞く", disabled: !b.voice || b.removed, onclick: () => play(b.voice) }));
    }
    small.append(el("button", { type: "button", className: "btn-small", textContent: "直す", onclick: () => { editing = b.index; render(); } }));
    if (voiced) {
      if (b.voiceState !== "differs" && recording?.index !== b.index)
        small.append(el("button", { type: "button", className: "btn-small", textContent: "録り直す", onclick: () => startRecording(b.index) }));
      const remove = el("button", { type: "button", className: "btn-small", textContent: "声を外す", onclick: () => call("remove", { panel: panel().id, index: b.index, removed: !b.removed }) });
      remove.setAttribute("aria-pressed", String(b.removed));
      small.append(remove);
    }
    parts.push(el("div", { className: "line-actions" }, main, small));
    return el("div", { className: "line" }, ...parts);
  }

  function renderCorrection(c) {
    const change = c.parts.map((p) => `${p.from || "（なし）"} → ${p.to || "（なし）"}`).join("　");
    const box = el("div", { className: "fixes" }, el("p", { className: "who", textContent: "聞き取りを直した所" }), el("p", { className: "fix-change", textContent: change }), el("p", { className: "fix-why", textContent: c.reason }));
    if (c.state) box.append(el("p", { className: "fix-done", textContent: c.state === "ok" ? "合っていると確かめました。" : "聞こえたままの字に戻しました。" }));
    else
      box.append(
        el(
          "div",
          { className: "line-actions" },
          el(
            "div",
            { className: "main" },
            el("button", { type: "button", className: "btn-fill", textContent: "合っている", onclick: () => call("correction", { segment: c.segment, state: "ok" }) }),
            el("button", { type: "button", className: "btn-accent", textContent: "元に戻す", onclick: () => call("correction", { segment: c.segment, state: "reverted" }) }),
          ),
        ),
      );
    return box;
  }

  function render() {
    const p = panel();
    $("kicker").textContent = ep.kicker;
    $("title").textContent = ep.title;
    $("progress").textContent = `${ep.panels.length} コマのうち ${ep.checked.length} コマを確かめました`;
    $("publish").disabled = ep.blockers.length > 0;
    if (ep.published) {
      notice("");
      $("notice").append("公開用のページを書き出しました。", " ", el("a", { href: ep.published, target: "_blank", textContent: "書き出したページを開く" }));
    } else if (!$("notice").classList.contains("error")) notice(ep.blockers.join(" "));
    renderList();
    $("panel-image").src = p.image;
    $("panel-image").alt = `${current + 1} コマ目の絵`;
    $("balloons").replaceChildren(...p.balloons.map(renderBalloon));
    $("corrections").replaceChildren(...p.corrections.map(renderCorrection));
    const passed = ep.checked.includes(p.id);
    $("pass").textContent = passed ? "確かめました（取り消す）" : "このコマはこれでよい";
    $("next").disabled = current === ep.panels.length - 1;
  }

  function go(i) {
    if (recording) return;
    current = i;
    editing = null;
    $("notice").classList.remove("error");
    render();
    window.scrollTo({ top: 0 });
  }

  function play(src) {
    const player = $("player");
    player.src = src;
    player.play().catch(() => notice("声を再生できませんでした。", true));
  }

  async function startRecording(index) {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      notice("マイクを使えませんでした。ブラウザのマイクの許可を確かめてください。", true);
      return;
    }
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    recorder.addEventListener("dataavailable", (e) => e.data.size && chunks.push(e.data));
    recorder.addEventListener("stop", () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: "audio/webm" });
      const p = panel();
      recording = null;
      call("record", blob, `?panel=${encodeURIComponent(p.id)}&index=${index}`);
    });
    recorder.start();
    recording = { index, recorder };
    render();
  }

  function stopRecording() {
    recording?.recorder.stop();
  }

  $("pass").addEventListener("click", async () => {
    const p = panel();
    const passed = ep.checked.includes(p.id);
    await call("checked", { panel: p.id, checked: !passed });
    if (!passed && current < ep.panels.length - 1) go(current + 1);
  });
  $("next").addEventListener("click", () => go(Math.min(current + 1, ep.panels.length - 1)));
  $("publish").addEventListener("click", async () => {
    notice("公開用のページを書き出しています。字を直したセリフがあれば、訳も作り直します（1 分ほど）。");
    await call("publish");
  });

  fetch("/api/episode")
    .then((r) => r.json())
    .then((data) => {
      ep = data;
      render();
    })
    .catch(() => notice("サーバーにつながりません。node src/cli.ts confirm で起動してください。", true));
})();
