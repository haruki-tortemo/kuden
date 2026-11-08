(() => {
  const ep = JSON.parse(document.getElementById("episode").textContent);
  const LABELS = ep.langLabels;
  const pick = (perLang, code) => (perLang && (perLang[code] ?? perLang.ja)) || "";
  const VOICE_NAME = {
    ja: (m) => `${m}の声`,
    ja_easy: (m) => `${m}の こえ`,
    en: (m) => `${m}'s voice`,
    vi: (m) => `Giọng của ${m}`,
    pt: (m) => `Voz do ${m}`,
  };
  const VOICE_LABEL = { ja: "声をきく", ja_easy: "こえを きく", en: "Play voice", vi: "Nghe giọng", pt: "Ouvir voz" };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  let lang = LABELS[store.get("lang")] ? store.get("lang") : "ja";
  const toggle = document.getElementById("voice-toggle");
  toggle.checked = store.get("voices") !== "off";

  const audio = new Audio();
  let playing = null;
  audio.addEventListener("ended", () => setPlaying(null));
  audio.addEventListener("pause", () => setPlaying(null));

  function setPlaying(el) {
    if (playing) playing.classList.remove("playing");
    playing = el;
    if (el) el.classList.add("playing");
  }

  function play(src, el) {
    if (!toggle.checked) return;
    if (playing === el && !audio.paused) {
      audio.pause();
      return;
    }
    audio.src = src;
    audio.currentTime = 0;
    audio.play().then(() => setPlaying(el)).catch(() => setPlaying(null));
  }

  function setVoices(on) {
    document.body.classList.toggle("voices-on", on);
    store.set("voices", on ? "on" : "off");
    if (!on) {
      audio.pause();
      setPlaying(null);
    }
    for (const { el, b } of balloonEls) if (b.voice) el.disabled = !on;
  }

  // Manga balloons in Japanese drop the full stop: a stop between sentences becomes a line break,
  // and the line also breaks after a comma. Only the display changes; the checked words stay as recorded.
  function mangaJa(text) {
    return text.trim().replace(/。+$/, "").replace(/。\s*/g, "\n").replace(/、\s*/g, "、\n");
  }

  // やさしい日本語 writes readings as 漢字(よみ); show them as ruby instead of brackets.
  function fill(span, text, code) {
    span.textContent = "";
    if (code === "ja") {
      span.textContent = mangaJa(text);
      return;
    }
    if (code !== "ja_easy") {
      span.textContent = text;
      return;
    }
    const re = /([一-鿿々]+)[(（]([ぁ-ゖー]+)[)）]/g;
    let last = 0;
    for (const m of text.matchAll(re)) {
      span.append(text.slice(last, m.index));
      const ruby = document.createElement("ruby");
      ruby.append(m[1]);
      const rt = document.createElement("rt");
      rt.textContent = m[2];
      ruby.append(rt);
      span.append(ruby);
      last = m.index + m[0].length;
    }
    span.append(text.slice(last));
  }

  const strip = document.getElementById("strip");
  const balloonEls = [];

  for (const panel of ep.panels) {
    const fig = document.createElement("figure");
    fig.className = "panel";
    fig.dataset.beat = panel.beat;
    // Balloons sit on the top or bottom edge of the frame, not over the middle of the picture,
    // so a longer translation never covers a face or the hands doing the work.
    const top = document.createElement("div");
    top.className = "band top";
    const frame = document.createElement("div");
    frame.className = "frame";
    const bottom = document.createElement("div");
    bottom.className = "band bottom";
    const img = document.createElement("img");
    img.src = panel.image;
    img.alt = "";
    img.loading = "lazy";
    img.width = panel.width;
    img.height = panel.height;
    frame.appendChild(img);
    fig.append(top, frame, bottom);

    const side = (a) => (a.endsWith("left") ? 0 : a.endsWith("right") ? 2 : 1);
    const ordered = [...panel.balloons].sort(
      (x, y) => (x.kind === "caption" ? -1 : 0) - (y.kind === "caption" ? -1 : 0) || side(x.anchor) - side(y.anchor),
    );

    let firstVoice = null;
    for (const b of ordered) {
      const el = document.createElement(b.voice ? "button" : "div");
      el.className = `balloon ${b.kind} ${b.speaker} at-${b.anchor}`;
      const span = document.createElement("span");
      span.className = "text";
      el.appendChild(span);
      if (b.voice) {
        el.type = "button";
        el.classList.add("has-voice");
        const mark = document.createElement("i");
        mark.className = "mark";
        mark.setAttribute("aria-hidden", "true");
        el.prepend(mark);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          play(b.voice, el);
        });
        firstVoice ??= { src: b.voice, el };
      }
      (b.anchor.startsWith("bottom") ? bottom : top).appendChild(el);
      balloonEls.push({ el, span, b });
    }
    for (const band of [top, bottom]) {
      if (!band.children.length) band.remove();
      // Narration gets its own line above the speech balloons.
      const captions = band.querySelectorAll(".caption");
      if (captions.length && captions.length < band.children.length) {
        const br = document.createElement("i");
        br.className = "break";
        captions[captions.length - 1].after(br);
      }
    }
    if (firstVoice) {
      fig.classList.add("voiced");
      fig.addEventListener("click", () => play(firstVoice.src, firstVoice.el));
    }
    strip.appendChild(fig);
  }

  const nav = document.getElementById("langs");
  for (const code of Object.keys(LABELS)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.lang = code;
    btn.lang = code === "ja_easy" ? "ja" : code;
    btn.textContent = LABELS[code];
    btn.addEventListener("click", () => setLang(code));
    nav.appendChild(btn);
  }

  function setLang(code) {
    lang = code;
    store.set("lang", code);
    document.documentElement.lang = code === "ja_easy" ? "ja" : code;
    for (const btn of nav.children) btn.setAttribute("aria-pressed", String(btn.dataset.lang === code));
    for (const { el, span, b } of balloonEls) {
      fill(span, pick(b.text, code), code);
      if (b.voice) el.setAttribute("aria-label", `${span.textContent} ▶`);
    }
    document.getElementById("kicker").textContent = pick(ep.kicker, code);
    document.getElementById("title").textContent = pick(ep.title, code);
    document.getElementById("lesson").textContent = pick(ep.lesson, code);
    const master = pick(ep.masterName, code);
    document.getElementById("voice-name").textContent = (VOICE_NAME[code] ?? VOICE_NAME.ja)(master);
    document.getElementById("voice-label").textContent = VOICE_LABEL[code] ?? VOICE_LABEL.ja;
    document.title = pick(ep.title, code);
  }

  toggle.addEventListener("change", () => setVoices(toggle.checked));
  setLang(lang);
  setVoices(toggle.checked);
})();
