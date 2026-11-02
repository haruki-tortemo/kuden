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

One planned difference from the original: balloons sit on the top or bottom edge of each frame instead of inside the picture. The generated panels do not reliably leave the planned corner empty, in the first build a balloon covered the apprentice's face, and translations run longer than the Japanese, so the picture is kept clear.

## Interviewer screen

Drawn the same way: three drafts from one written spec, in the reader's visual system. The one with the largest question was chosen (2026-11-02 22:43), because the interviewer glances at it during a call and reads it out. Original: `design/interviewer-original.png` (sha256 starts 85e2eb265f518453). The states the drawing does not show (before recording, listen only, waiting for the answer, no connection) use the same parts.

Tokens used by `web/reader/reader.css`: paper `#f3efe6`, ink `#1d1b18`, accent (vermilion) `#c2412d`, soft ink `#6b655c`, rule `#d9d2c4`.
