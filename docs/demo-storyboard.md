# Demo GIF — storyboard

One job: a builder feels "I dump a messy thought, it comes back filed" in
under 20 seconds. Two beats, clean loop, no extras (no Organize, no record,
no grouped view — those belong in posts, not the first impression).

Target: `docs/demo.gif`, 720px wide, looping. The README placeholder is
already waiting for exactly that path.

## Setup (once, ~1 minute)

1. Run the app locally and open it in a **fresh browser profile or incognito**
   (so your real board never appears on camera).
2. Paste this in the DevTools console to make the board look lived-in, then
   reload:

```js
(async () => {
  const now = Date.now(), DAY = 864e5;
  const board = {
    actions: [
      { id: "d1", text: "Renew the car insurance before the 28th", done: false, at: now - 2*DAY, shelf: "days", expires: now + 3*DAY, updatedAt: now },
      { id: "d2", text: "Send Maya the contract redlines", done: false, at: now - DAY, shelf: "keep", expires: null, updatedAt: now }
    ],
    threads: [
      { id: "dt1", name: "Pricing the new tier", summary: "Leaning toward usage-based over seats — churn risk feels lower.", frags: [
        { id: "df1", at: now - 3*DAY, text: "Seats punish the exact teams we want; usage grows with value." },
        { id: "df2", at: now - DAY, text: "Competitor moved to usage last quarter and kept NRR above 120." }
      ] }
    ],
    intentions: [], principles: []
  };
  const db = await new Promise((res, rej) => { const r = indexedDB.open("capture", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  await new Promise((res, rej) => { const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(JSON.stringify(board), "capture:data:v1");
    tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  location.reload();
})()
```

3. Recorder: **Kap** (free, exports GIF directly, trims, loops) or QuickTime +
   `ffmpeg`. Frame just the app column, ~720px wide. Hide the cursor between
   actions; the two typing moments carry the motion.

## Beat 1 — the messy errand (0–10s)

Click the capture box and type, quickly, exactly this (the garble is the
point — it is what dictation actually produces):

> uh so remind me to call the vet about luna's shots tomorrow and also need
> to book the boiler service before friday

Hit **Capture**. Hold on the result: the landed banner, then **two clean
actions** on the board, each with its shelf-life chip. Do not scroll, do not
narrate. This one moment shows garble-cleanup, action extraction, and
fade-by-default at once.

## Beat 2 — the thinking (10–18s)

Type:

> still torn between usage based and seats for the new tier, the seats
> version punishes our best teams honestly

Hit **Capture**. It lands in the existing *Pricing the new tier* thread — tap
the thread open for ~2 seconds so "Where this stands" flashes (the summary
will have absorbed the new fragment). Close back to the board. Loop ends
where it began: a calm board, two thoughts heavier.

## Retakes

The sort is a live model call — if the phrasing comes back off, just delete
the items and take it again. Two or three takes is normal; keep the one where
the shelf-life chips read clearly.

## Export

- Trim dead frames at both ends so the loop breathes but never stalls.
- 720px wide, 12–15 fps is plenty for UI; keep it under ~4MB so the README
  loads fast.
- Save to `docs/demo.gif`, then replace the README placeholder comment with:

```html
<p align="center"><img src="docs/demo.gif" width="720" alt="a messy dictated thought becoming two filed actions" /></p>
```
