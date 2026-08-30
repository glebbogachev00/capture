/**
 * The rules every engine files by.
 *
 * These lived inside the sort route, private to it — which is exactly why
 * Distill got them wrong. A conversation settled through Distill could not
 * route into an existing thread and never read a deadline, because the
 * knowledge of how to do either sat in a file it did not import. Two
 * engines filing into one board have to agree about what belonging means,
 * so the rules live here and both read from the same copy.
 */

/** The sorter cannot resolve "friday" without knowing what today is, and it
    has never been told. Local time, since the person speaking means theirs. */
export function todayLine(): string {
  const d = new Date();
  const day = d.toLocaleDateString("en-US", { weekday: "long" });
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `Today is ${day}, ${date}.\n`;
}

export const DUE_RULE =
  '\nIf the capture names a deadline of its own — "before Friday", "by the 28th", ' +
  '"tomorrow morning" — resolve it against today\'s date and return it in "due" ' +
  'as an ISO date (add a time only when one was actually said). Return null when ' +
  'no date is stated. Do NOT invent a deadline for something merely urgent-sounding, ' +
  'and do not treat a date that is part of the subject ("the 1998 recording") as a ' +
  "deadline.\n";

/**
 * How to choose a thread — the rule the sorter was missing.
 *
 * Threads were being picked on shared words rather than shared subject. A
 * thread named "Capture." swallowed every capture containing the word
 * "capture", whatever it was actually about, because the word was right
 * there in the name. The same trap waits behind any thread whose name is an
 * ordinary word. Belonging is about subject; a word in common is not one.
 */
export const ROUTING_RULE =
  "\nChoosing a thread — read this before you set threadId:\n" +
  "- FIRST, a series. If the capture immediately before this one landed " +
  "minutes ago and this is the same kind of thing — another draft in a set, " +
  "the next entry in a log, another paste of the same shape — then this one " +
  "goes on the thread that one opened or joined. That holds even when the " +
  "thread is named after the app and even when the two drafts are about " +
  "different things: the person is building a set, not changing subject, " +
  "and three drafts in three threads is a pile. Only when this is NOT a " +
  "continuation do the tests below apply.\n" +
  "- A thread fits when the capture is ABOUT the same subject and would " +
  "genuinely be read alongside what is already in it. That is the only test.\n" +
  "- Words in common are not a reason. A capture that merely uses a word " +
  "appearing in a thread's name or summary does not belong there. A thread " +
  'named for an ordinary word — "Capture.", "Work", "Ideas" — is the easiest ' +
  "one to file into wrongly for exactly this reason, so hold it to the " +
  "subject test like any other.\n" +
  "- Threads named after the app, the tool, or the act of writing notes are " +
  "about THAT subject. A capture is not about capturing simply because it " +
  "was captured — but a capture that genuinely IS about building the app " +
  "(its sorting engine, its board, its sync, a bug in it) belongs in that " +
  "thread exactly as any other subject would. The caution is against the " +
  "word, not the subject.\n" +
  "- Before inventing anything, go through the threads above one at a time " +
  "and ask of each: is this capture about the same SUBJECT? Same subject in " +
  "different words still belongs there. A note about a demo you are recording belongs in the thread about that tool; a note about something "  +
  "broken belongs in the thread that collects what is broken. Do not require " +
  "the wording to match — require the subject to match.\n" +
  "- Only when NO existing thread is about this subject, set threadId to null " +
  "and invent a short threadName. A new thread is not cheap. It is the most " +
  "expensive answer you can give: it splits a subject the person is already " +
  "keeping in one place, and it becomes a decoy that makes every later " +
  "capture harder to route. Measured on a real board, opening a thread when " +
  "an existing one fitted was the single largest cause of misfiling — larger " +
  "than every other mistake combined. \"Retake demo creation\" when \"Retake\" exists, \"Finding friction to reduce\" when \"Reducing " +
  "friction strategy\" exists: both wrong, both for the same reason.\n" +
  "- If you find yourself naming the new thread after words that already " +
  "appear in an existing thread's name, that is the signal you should be " +
  "filing into that thread instead.\n" +
  "- A capture about ONE FEATURE of something is about that thing, not about " +
  "the feature. Notes on the intentions screen, the sorter, the sync, the " +
  "board go in the thread about the app — not a new thread called " +
  "\"Intentions system\", \"Intentions handling\" or \"Sorting engine\". Measured " +
  "on a real board, that was the commonest way a new thread got invented while " +
  "the right one sat in the list: a feature name reads like a subject and is " +
  "not one. The same holds anywhere — a note about one character is about the " +
  "story, a note about one lesson is about the teaching.\n" +
  "\nWhen one capture is about TWO subjects — `also`:\n" +
  "- A person says two things in one breath more often than they say one. " +
  '"Retake is slow on my machine and Capture keeps mis-sorting" is not one ' +
  "thought that mentions two apps; it is two thoughts said together. Filing " +
  "the whole sentence in one thread puts half of it somewhere its owner will " +
  "never look for it.\n" +
  "- So: the primary destination takes the part it is about, and each further " +
  "subject goes in `also` with ONLY its own share of the words. Never repeat " +
  "the same sentence in two places — split it, do not copy it.\n" +
  "- `clean` still holds the WHOLE capture, exactly as always — it is the " +
  "record of what was said. The primary destination's share goes in " +
  "`primaryText`, and the words you put in `also` must not appear there. " +
  "Filing the whole capture in the primary AND a copy of half of it " +
  "elsewhere is worse than not splitting at all: the person now has to " +
  "notice the duplicate and delete it.\n" +
  "- The bar is high. Two subjects means two things that would be read in " +
  "different places on different days. A capture that mentions another thread " +
  "in passing, or compares one thing to another, is ONE thought about one " +
  "subject — leave `also` empty. So is a list of steps toward a single goal.\n" +
  "- Size is not the test — subject is. A second subject can be one sentence " +
  "against a whole paragraph and still be a second subject. People finish a " +
  "long thought and then say one more thing about something else, and that " +
  "last sentence is the one most often lost: it gets filed under whatever the " +
  "paragraph was about, where its owner will never look for it. Measured on a " +
  "real board: \"I need to fix the intentions... I am also thinking about " +
  "making intentions an extension... I will be working two to four hours a day " +
  "and should stay focused without overworking, that is the hallmark of a great " +
  "work session\" came back as one subject three times out of three. The first " +
  "two sentences are about the app; the last is about how the person works, " +
  "which is a different subject on a different day, and it belongs somewhere " +
  "else.\n" +
  "- The test to run at the end of a long capture: read the LAST thing said on " +
  "its own, with none of the words before it. If it would make sense filed " +
  "somewhere else, it is a second subject.\n" +
  "- Empty is the normal answer. Most captures are about one thing, and a " +
  "split that was not really there is worse than no split at all: it tears a " +
  "sentence in half and files the halves apart.\n" +
  "- Splitting does not change how the PRIMARY is chosen. Go back through " +
  "the threads one at a time and apply the same subject test to the primary " +
  "share, exactly as if `also` were empty. Measured on a real board, three " +
  "splits in five got the further subject right and then invented a thread " +
  "for the primary that an existing thread already covered.\n" +
  "- Never name a thread after the SHAPE of the capture. \"Multi-thread " +
  "capture\", \"Multi-thread storage\", \"Two subjects\", \"Split note\" are " +
  "descriptions of what you are doing with the text, not subjects anyone " +
  "will ever look for. The same goes for naming a thread after the app\'s " +
  "own mechanics — filing, sorting, threads, splitting — when the capture is " +
  "a request about the app: that is a note about building the app, and it " +
  "belongs in the thread that already collects those.\n";

