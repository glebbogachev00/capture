export const SEMANTIC_KIND_BOUNDARY = `
Classify the speech act before the topic or the sentence's main verb.
For each semantic claim, first ask whether the source assigns a discrete completable act. If it does, classify that claim as an Action. If it does not, ask whether the claim adopts a standing personal orientation; classify that as an Intention. Otherwise classify description or truth-seeking as developing thought. Apply this per claim so a mixed capture can retain each role.
- A concise first-person declaration is an intention when its function is to adopt a standing personal stance, permission, value, or way of living. It remains an intention when it uses active present-tense language but names no discrete act that can be completed once.
- A factual observation, belief under examination, uncertainty, or inquiry is developing thought even when it is first person.
- A discrete promise, request, or commitment to perform a completable act is an Action. It needs a source-stated result that can be finished once; an active verb alone does not supply one.
- An Intention owns no Action and no Thread destination.
`;
