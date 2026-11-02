# Reader screen: design direction

The reader was designed image-first: three layout hypotheses were drawn as images from written specs, compared side by side, and one was chosen before any HTML was written. The chosen image is the reference the implementation copies.

| | |
|---|---|
| Screen | The reading page of one episode, phone, vertical scroll |
| Candidates | A: paper book, languages as pills on top / B: controls in a floating bottom bar / C: episode title page, tabs for languages, framed panels |
| Chosen | C, with B's voice on/off switch added (2026-11-02 15:30) |
| Original | `design/reader-original.png` (GPT-Image-2.5, sunburst, xhigh, refined from the C draft; sha256 starts 028e99fe6ed7977b) |
| Patterns taken | A textbook chapter title page (episode number, title, the one judgment this episode passes on); manga panel frames; a settings-row toggle for the voice; tabs with an underline for languages |
| Not copied | No layout, decoration or branding taken from any particular app; the drafts were drawn from written specs, not from screenshots of existing products |
| Our own point | The voice row: the craftsman's own voice is a first-class control next to the title, and every balloon the craftsman speaks carries a ▶ that plays the seconds they said it |

Tokens used by `web/reader/reader.css`: paper `#f3efe6`, ink `#1d1b18`, accent (vermilion) `#c2412d`, soft ink `#6b655c`, rule `#d9d2c4`.
