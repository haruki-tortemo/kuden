(() => {
  const ep = JSON.parse(document.getElementById("episode").textContent);
  const LABELS = ep.langLabels;
  const NOTE = {
    ja: "吹き出しに ▶ があるコマは、押すと職人本人の声が流れます。",
    ja_easy: "▶ が ある ところを おすと、しょくにんの こえが きこえます。",
    en: "Tap a panel with ▶ to hear the craftsman say it in their own voice.",
    vi: "Chạm vào khung có ▶ để nghe chính giọng của người thợ.",
    pt: "Toque num quadro com ▶ para ouvir a voz do próprio artesão.",
  };

  let lang = "ja";
  try {
    const saved = localStorage.getItem("lang");
    if (saved && LABELS[saved]) lang = saved;
  } catch {}

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
    if (playing === el && !audio.paused) {
      audio.pause();
      return;
    }
    audio.src = src;
    audio.currentTime = 0;
    audio.play().then(() => setPlaying(el)).catch(() => setPlaying(null));
  }

  const strip = document.getElementById("strip");
  const balloonEls = [];

  for (const panel of ep.panels) {
    const fig = document.createElement("figure");
    fig.className = "panel";
    fig.style.aspectRatio = `${panel.width} / ${panel.height}`;
    const img = document.createElement("img");
    img.src = panel.image;
    img.alt = "";
    img.loading = "lazy";
    img.width = panel.width;
    img.height = panel.height;
    fig.appendChild(img);

    let firstVoice = null;
    for (const b of panel.balloons) {
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
      fig.appendChild(el);
      balloonEls.push({ el, span, b });
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
    btn.textContent = LABELS[code];
    btn.addEventListener("click", () => setLang(code));
    nav.appendChild(btn);
  }

  function setLang(code) {
    lang = code;
    try { localStorage.setItem("lang", code); } catch {}
    document.documentElement.lang = code === "ja_easy" ? "ja" : code;
    for (const btn of nav.children) btn.setAttribute("aria-pressed", String(btn.dataset.lang === code));
    for (const { el, span, b } of balloonEls) {
      span.textContent = b.text[code] ?? b.text.ja;
      if (b.voice) el.setAttribute("aria-label", `${span.textContent} ▶`);
    }
    document.getElementById("title").textContent = ep.title[code] ?? ep.title.ja;
    document.getElementById("lesson").textContent = ep.lesson ?? "";
    document.getElementById("note").textContent = NOTE[code] ?? NOTE.ja;
  }

  setLang(lang);
})();
