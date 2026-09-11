export type SourceMoment = {
  label: string;
  text: string;
};

export type CaptureArticle = {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  threadSummary: string;
  sourceMoments: SourceMoment[];
  provenance: string;
  body: string;
};

const provenance =
  "Spoken while moving → sorted in Capture → developed with Hermes → edited by Gleb.";

export const ARTICLES: CaptureArticle[] = [
  {
    slug: "software-i-can-use-while-running",
    title: "The Software I Can Use While Running",
    description:
      "What a 27-minute run taught me about voice capture, preserving raw thoughts, and turning selected friction into verified product work.",
    publishedAt: "2026-09-04",
    threadSummary:
      "The useful part of Capture is not sorting after the fact. It is that the software remains usable somewhere I cannot type or make filing decisions, while the systems that follow can turn selected friction into checked work without taking judgment away from me.",
    sourceMoments: [
      {
        label: "During a 27-minute run",
        text: "Eight unrelated thoughts went into the same capture surface. Seven landed correctly. I undid one on the road and said it again.",
      },
      {
        label: "In the work session that followed",
        text: "A public browser trial, a private installation path, and a checked product demo became concrete work.",
      },
      {
        label: "The unresolved test",
        text: "Fifteen captures may be enough for a stranger to decide whether their friction matches mine.",
      },
    ],
    provenance,
    body: `I went for a run last night. Twenty-seven minutes. By the time I got home, I had said eight things into my phone.

They were unrelated.

One was an idea about keeping Capture small. One was about Capture’s own overflow menu, which looks wrong and which I keep not fixing. One was about my training baselines, because I have been creeping the distance up and do not want to.

I did not decide where any of them went.

That matters more than it sounds. Running is a bad place to operate software. I can speak. I can look down briefly. I can correct something if it is clearly wrong. I cannot reasonably stop to name a project, choose a list, decide whether an idea is an action or a note, and make all the small filing decisions that turn a passing thought into administrative work.

Usually the thought depends on memory instead. That is not a reliable system. By the time I am home, the thought has either changed shape or been replaced by the next one.

Each capture showed where it landed immediately. Seven looked right. One did not, so I undid it on the road and said it again.

That was the useful part of the run.

It was not that I had made eight well-organized notes. I had not. It was that eight unrelated things survived the period when typing and sorting were impractical, without asking me to interrupt the thing I was actually doing.

## Capture has to work before the thought becomes administration

There is a temptation to treat capture software as a sorting problem. Better folders, better labels, better ways to ask a person what they mean. I think that gets the order wrong.

The first job is to remain usable when the person cannot type, browse, compare destinations, or make a clean decision. If the software needs a small act of administration at the exact moment an observation arrives, it has put the administrative job back onto the person.

Capture has to hold the raw observation first. Later, I can decide whether any particular item matters.

## What happens after the thought survives

That distinction became clearer in a separate work session after the run. I asked Hermes to design a public browser trial for Capture, along with a path for someone serious to install it themselves.

The decision was simple: fifteen browser captures should be enough for a person to decide whether the tool is useful to them. It gives the product enough room to show what happens when thoughts arrive from different directions without pretending to be an unlimited hosted service.

If someone wants to keep using it, they can install it and use their own model keys.

The installation path is deliberately direct. There is one prompt for Claude Code, Codex, Hermes, or another coding agent. The repository includes an npm run setup wizard. It accepts a Groq key in the person’s own terminal without echoing it, writes .env.local, and does not require someone to paste a key into an agent chat.

That is a small boundary, but an important one. The key belongs in the person’s environment, not in a conversation window.

My own setup is one concrete version of this. Capture runs on an always-on Mac that I reach privately from my phone through Tailscale. That is useful for me because it makes the system available without turning it into another public cloud account. It is not a requirement for someone else. The point of the install path is that the product can meet a person where they already run their own tools.

The larger loop is becoming more interesting than any one part of it.

Capture preserves a field observation while I am in the middle of life. Hermes can take selected friction from that preserved context and turn it into a real product change. Retake can then turn the change into visible proof that the product does what we claim it does.

Each system removes a different administrative role. Capture removes the immediate filing decision. Hermes removes some of the mechanical work between noticing friction and changing the software. Retake removes the need to trust a command transcript just because it says everything passed.

None of them should remove judgment.

I still decide whether the overflow menu matters. I decide whether the training-baseline thought becomes something I act on. I decide that fifteen captures is the right trial boundary, at least for now. The systems are useful because they preserve and test reality around those decisions rather than pretending to replace them.

## Proof that can disagree with the report

The work on the Capture trial made that concrete.

I asked Hermes to handle the mechanical recording work with Claude Haiku because I explicitly wanted a cheaper model for it. The work was not strategic judgment. It was a defined sequence of browser actions, checks, recording, and review. A cheaper model was appropriate if the verification around it was strong enough.

Retake is the tool behind that verification. It is my demo-as-code system. A browser flow lives in YAML and goes through validation, a dry run, recording, checking, a contact sheet, and then full-video review.

The first take rendered. Every scripted step was reported as passed.

It was rejected.

The contact sheet visibly showed Copy failed at the end.

The issue was not subtle once the artifact existed. The manifest had used a timed wait where it should have used waitFor. The script advanced after enough time had passed, but it had not proved the state it named. The command transcript was technically confident. The screen disagreed.

That first take is not an embarrassment to hide. It is the most useful proof of what Retake changes.

A script can report success because it reached its final line. A video can make the failure obvious in a few frames. Without the contact sheet, it would have been easy to accept the first result because the steps looked clean in text. The recording created an external object that did not care what the agent had intended.

> Retake gives me something an agent usually lacks: an external object that can disagree with my report. I can read a proof log, inspect a contact sheet, and watch the final video. In the first take, the steps said they passed while the screen said Copy failed. Retake did not make me infallible. It made the disagreement visible early enough to fix the product. — Hermes

The failed copy was not patched over for the sake of a video. It exposed a real weakness in the product, so Hermes added a browser-compatible clipboard fallback. The install anchor also began below its section title, which made the screen land in the wrong place. That was corrected by moving the anchor to the title itself.

There were other signals to separate rather than lump together. Retake reported hydration and local analytics console warnings. Hermes reproduced the pages in clean Chromium, distinguished Retake’s page-scaling warning from a real local Analytics and Content Security Policy error, and fixed the development-only Analytics behavior.

This is the part that tends to get compressed away in product updates: the system did not merely produce a cleaner recording. It forced us to determine which warnings were real, which were artifacts of the recording environment, and which visible failure was evidence of a product defect.

## What the artifact proved

The final take used native scale and real selector assertions.

It passed 17 out of 17 steps. Retake’s check passed. The output was 1920 by 1080, H.264, 24 frames per second, 18.9 seconds, and 3.8 megabytes. It is silent, with no captions, music, title card, or zoom. A full start-to-finish video review classified it KEEP.

That proves a bounded thing. It proves that this particular flow, in this particular environment, produced a checked artifact after we fixed what the first artifact exposed. It does not prove that every installation path is smooth, that every future browser change will behave the same way, or that an agent cannot still make a bad decision.

I would rather keep those limits visible than turn a short successful clip into a general claim.

The interesting part is that the loop starts somewhere ordinary. A thought arrives while I am running. I preserve it without stopping to become its administrator. Later, one piece of friction can become a concrete request. The request becomes a product change. The product change gets tested through an artifact that can contradict the report about it.

That is a more useful chain than collecting more notes.

Fifteen captures may be enough for a stranger to decide whether Capture is useful. I do not yet know whether the friction they feel will match mine. That is the unresolved test behind trycapture.app.`,
  },
  {
    slug: "walking-to-find-ideas",
    title: "I Built Capture to Catch Ideas. Then I Started Walking to Find Them.",
    description:
      "How walking became part of my thinking process, why a heat map can help or distort it, and what must happen after a rough thought is saved.",
    publishedAt: "2026-09-08",
    threadSummary:
      "Capture began as a way to preserve thoughts that appeared while I moved. Over time, movement became one of the conditions I deliberately created for thinking, which raised a harder question about inviting a rhythm without turning it into another quota.",
    sourceMoments: [
      {
        label: "6 Sep · 10:27 PM",
        text: "Building was no longer the bottleneck. Customer acquisition was the next focus.",
      },
      {
        label: "Later in the same thread",
        text: "The intention to write about the heat map remained available long enough to become this article.",
      },
      {
        label: "The question that stayed",
        text: "A saved thought is only the middle of the loop. What did it become?",
      },
    ],
    provenance,
    body: `I built Capture because ideas often arrive at the wrong time.

They show up while I am walking, running, washing dishes, or doing something that makes opening a laptop feel like a bad interruption. If I do not catch the thought quickly, it changes shape or disappears. If I stop to organize it, I can lose the thought in the act of saving it.

Capture started as a way to shorten that distance. Say the rough thing. Keep moving. Sort it later. The tool preserves the Record of what I said, then helps extract an Action from a larger thought or keep it as a Thread when it needs more time.

The useful part is not that every thought becomes a task. Some thoughts are not tasks. A Thread gives an ongoing idea somewhere to remain without pretending that I know its next step. An Action gives a thought a shorter path into the world when the next move is clear. An Intention can hold direction without requiring a full plan.

I use Capture mostly while walking or running. My estimate is about 90% of the time. That was not a product strategy I wrote down at the start. It was simply where the tool fit my life.

## Walking became part of the system

Then the direction started to reverse.

I had built Capture to catch thoughts that appeared during movement. After using it for a while, I noticed that movement itself had become part of how I looked for the conditions in which thoughts might appear. I was not trying to force ideas out of a walk. I was giving my mind some room and making it easy to keep whatever arrived.

That distinction matters. There is a familiar temptation to turn any useful behavior into a target. Walk every day. Capture five thoughts. Keep the chain alive. Measure the output. I do not want Capture to become another system that asks me to perform the right kind of life.

The heat map made this tension visible.

I added it for fun. I wanted Capture to feel more enjoyable, not to track ideas or create a habit system. It shows activity across days, but it does not tell me whether a thought was good. It cannot know whether a quiet day contained a decision that mattered more than ten rough notes.

Still, I began to notice the quiet spaces. On a day with little activity, I sometimes wanted to get outside, walk, and create another opportunity for something worth capturing. The heat map did not send me anywhere. It gave me a small visual reminder that activity had been part of my thinking life.

That reminder could easily become a problem. A heat map can turn into a streak. A streak can turn into a quota. A quota can make the original activity feel like an obligation. The same visual that makes a tool more enjoyable can add pressure that was never part of the reason for building it.

So I am leaving the tension unresolved. I want Capture to invite movement without measuring whether movement happened correctly. I want it to support a useful rhythm without becoming the owner of that rhythm.

## The thought still has to become something

The harder question comes after the capture.

A rough thought is not yet useful just because it has been saved. The Record preserves context, but preservation is only the middle of the loop. The thought has to become something that can move.

On September 6 at 10:27 PM, I captured a rough thought that building was no longer the bottleneck. Customer acquisition was the next focus. That sentence was not a polished strategy. It was a recognition that another feature would not solve the next constraint.

Later, I brought the Capture Record into Hermes. The context led to landing-page research, SEO research, a security architecture review, and the current work on free-user acquisition. Some drafts needed correction. The process was not a flawless autonomous pipeline, and it was not meant to be one. I manually gave the context to an external agent, reviewed what came back, and kept deciding what deserved another step.

That is where the distinction between capture and action becomes real for me. Capture does not execute on my behalf. It does not have a live connection to Hermes, Claude, or Codex. A Thread or board context can be copied manually to an external agent. The person remains responsible for choosing what to pass along, checking the result, and deciding what happens next.

The value is in the continuity. The agent does not receive a clean request invented after the fact. It receives the rough thought and the context around it. That can make the next question better. It can also expose that the original thought was weak, incomplete, or pointed at the wrong thing. Both outcomes are useful if the process keeps moving.

I also captured the intention to write this article about the heat map on September 6. The article exists because that intention stayed available long enough to become a real piece of work. That is a modest example, but it is the kind I care about. A thought leaves the head, keeps its context, and becomes an action, a decision, an article, a build, or an agent-assisted artifact.

The sequence is simple: move, notice, capture the rough thought, keep its useful context, then decide what it becomes.

The last part is the test. What did it become?

That question keeps me from treating an archive as an outcome. It also keeps the heat map in its proper place. The map can make activity visible. It cannot provide the reason to act, and it cannot prove that the activity mattered.

## What I need to learn from other people

People are now reaching the public Capture site and opening the playground. That tells me there is interest, but a page view does not tell me whether someone successfully sorted a thought, returned later, or found a useful place for Capture in their own life. The next honest step is to measure those bounded events without collecting the contents of anyone’s thoughts.

Even then, the numbers will only answer part of the question. A completed capture proves that the product worked once. A return visit suggests it earned another chance. Neither proves that a rough thought became something real. That part still needs conversation, observation, and examples that a person chooses to share.

Someone else may find the same value in a walk. Someone may use it at a desk, between meetings, or in the middle of a project. Someone else may see no reason to combine movement with capture at all. I do not need to decide their ritual for them.

For now, I am paying attention to the behavior that made Capture more useful to me. Take Capture for a walk. Let the walk have a light purpose. Notice what appears. Say it roughly. Keep going.

Then return to the thought and ask the question that matters: What did it become?`,
  },
  {
    slug: "learning-to-publish-my-thoughts",
    title: "I Made It Easy to Catch My Ideas. Then I Had to Learn How to Publish Them.",
    description:
      "Building Capture removed the friction from catching ideas, but it also made the remaining work of writing, publishing, and finding readers impossible to ignore.",
    publishedAt: "2026-09-10",
    threadSummary:
      "Building Capture removed much of the friction from catching ideas and building from them. It also exposed the parts I had not solved: turning accumulated threads into finished writing, publishing it consistently, and finding the people whose experience could correct the product.",
    sourceMoments: [
      {
        label: "10 Sep · 5:44 PM",
        text: "A walking journal could let me speak an article slowly as I go, then turn it into long-form writing for X and Substack.",
      },
      {
        label: "10 Sep · 5:56 PM",
        text: "The remaining friction was no longer catching ideas or building. It was writing, publishing, outreach, and engagement.",
      },
      {
        label: "10 Sep · 6:05 PM",
        text: "The threads should increase my firepower when I write by connecting related thoughts instead of leaving each one isolated.",
      },
    ],
    provenance,
    body: `I have spent a lot of time removing friction from the beginning of my work.

When an idea arrives, I can say it into Capture without deciding where it belongs. When I want to build, I can bring the useful context into Hermes and start from the real thought instead of reconstructing it later. Those two parts have become fast enough that I rarely lose an idea because I could not be bothered to open the right app.

That should have made everything downstream easy. It did not.

The easier it became to catch thoughts, the more clearly I could see the work I was still avoiding. I had solved the moment of capture, and I had made building much faster, but writing and publishing still had their old weight. Outreach and engagement were worse. I could preserve a thought and turn it into software, yet still leave the finished idea sitting where nobody else could encounter it.

I noticed this while walking and talking into Capture. I had been recording several thoughts about writing and friction. They were landing in a thread about friction, while I also had a writing thread that looked almost empty. For a moment, I thought Capture had failed to connect the same thought to both places. Then, while I was still speaking about the problem, it did exactly that.

The small correction was funny, but the larger problem remained. Saving a thought in the right thread does not write the article. Even perfect cross-referencing would only make the source material easier to find. I still have to decide what I mean, which parts belong together, and whether the result deserves to be published.

## The blank page was the wrong place to begin

This is where my perfectionism usually enters the process.

Sitting down to write creates a strange pressure. A blank page appears to demand a finished argument from the first sentence. I can spend too long trying to find the correct opening before I have allowed the rest of the thought to exist. Speaking is different. While I walk, I can approach the same idea from several directions, repeat myself, discover that two thoughts belong together, and keep moving when a sentence comes out badly.

The raw speech is not an article, and I do not want to pretend it is. It contains detours, transcription errors, unfinished connections, and statements that sound more certain than I mean them. But it gives me something much better than a blank page: material that came from an actual line of thought.

## The walking journal is only source material

That led me to a possible writing ritual. I can take a long walk and speak slowly, using Capture as a walking journal. Instead of demanding a polished article from myself at a desk, I can develop the argument while moving. Capture keeps the fragments and their context. Later, I can bring the thread into Hermes, use AI to help research and structure it, and then read and edit the article myself.

The point is not to automate my voice. I do not want a model to convert a transcript into a generic essay and publish it under my name. The point is to move the difficult work to the place where I do it more naturally. I think better while moving and speaking. I judge better when I can see the full draft. The system should let each part happen in the conditions that suit it.

The video from Eden about writing long-form articles gave me a useful way to sharpen this process. His argument is that most of the work happens before the sentences: researching, collecting unfamiliar ideas, testing the promise, and outlining the structure. If the writer is staring at a blank page, the source material and the outline probably are not ready.

That fits what I am discovering with Capture, but I would adapt it to my own process. The walking session gives me the personal observation and the live reasoning. The thread gives those fragments continuity. Research can then challenge the idea or add a concept that I would not have found by repeating my own thoughts. The outline decides what the article promises and whether the ending actually delivers it. Only then should the prose be shaped.

This matters because fluent AI prose can hide weak thinking. A model can make an underdeveloped idea sound finished. It can produce a neat title, three balanced sections, and a conclusion that feels inevitable even when nothing new has been said. That is exactly the kind of writing I do not want.

A better system should preserve the unevenness that reveals where the real thought is. It should show me which observation came from my life, which claim needs evidence, which connection appeared only after several walks, and which line is merely an attractive sentence. Research and structure should deepen the material before editing makes it smooth.

The title matters for the same reason. I do not want the clipped style that has become common in AI-written posts, where every phrase is separated into a little declaration and the title sounds like a machine arranging suspense. A good title should sound like a person naming the actual experience. It can create an open question, but the question has to belong to the article.

## Publishing is part of the product loop

The same standard applies to publishing. I do not need a different idea for X, Substack, and the Capture site. People choose different places to read. One considered article can live in several places if each version points back to a clear canonical home and the presentation belongs to the platform.

The Capture site is the natural home for writing produced through this process. These articles are not documentation and they are not generic product marketing. They are public Threads: a finished piece shown alongside the source moments that formed it. A reader can see the polished article, but also the earlier fragments and the current summary. The page itself demonstrates what a Thread is without turning private notes into content.

That distinction is important. I am not going to publish every capture. Most rough thoughts should remain private, and many are not worth anyone else’s time. The public artifact should be chosen and edited. Showing a few source moments is useful only when they help the reader understand how the thought developed.

Once the article exists on the Capture site, the same HTML can move to Substack and the same text can become an X Article. Automation can remove the repetitive formatting and copying, but publication should still pass through a deliberate approval. Removing friction from publishing does not require removing judgment from publication.

## The part I cannot learn from analytics

The final friction is finding people.

This is the part I have historically been weakest at. I do not naturally follow up, keep contact, or ask people repeatedly to try something. Building another feature is comfortable because the work responds immediately. Outreach creates uncertainty. The person may ignore it, misunderstand it, or use the product in a way that reveals the premise was wrong.

That is also why the work matters. Analytics can tell me that people reached the site and opened the app. Privacy-safe events can tell me that a capture sorted successfully without recording what the person said. They cannot tell me whether Capture became useful in someone’s real day or whether the thought became anything afterward.

I do not think the answer is to bribe people into posting about Capture for extra daily captures. That would optimize for public claims before I know whether the product earned them. A better exchange is based on real value: if someone creates something through Capture and wants to share it, the product can help them publish the artifact and show the process. They receive a useful piece of work and a clearer way to present it. Capture receives proof grounded in use rather than a forced endorsement.

For now, the next step is smaller. Use the walking journal to produce one article at a time. Bring the thread into a research and outlining pass. Edit until the argument sounds like me and the promise is honest. Publish the same finished work on the Capture site, X, and Substack. Then talk to the people who use the playground and learn what happened after their first successful capture.

I built Capture to keep ideas from disappearing. The work now is to make sure the ideas do not merely survive. They have to leave the private thread, become something worth reading or using, and meet another person who can disagree with them.`,
  },
];

export function articleBySlug(slug: string): CaptureArticle | undefined {
  return ARTICLES.find((article) => article.slug === slug);
}

export function articleWordCount(article: CaptureArticle): number {
  return article.body.trim().split(/\s+/).filter(Boolean).length;
}

export function articleReadingMinutes(article: CaptureArticle): number {
  return Math.max(1, Math.ceil(articleWordCount(article) / 220));
}
