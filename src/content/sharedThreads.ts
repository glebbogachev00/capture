import type { ArticleImage } from "./articles";

/**
 * Threads already published from Capture on Capture Cloud. The writing index
 * links to their public pages instead of copying them, so unpublishing or
 * updating a thread there stays the only source of truth.
 */
export type SharedThread = {
  slug: string;
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  portrait: ArticleImage;
};

export const SHARED_THREADS: SharedThread[] = [
  {
    slug: "alex-karp",
    title: "What should all this information help you decide?",
    description:
      "An idea from The Philosopher in the Valley, about Alex Karp and Palantir, applied to the things a person saves for themselves: collecting it is not the same as making sense of it.",
    url: "https://cloud.trycapture.app/t/what-should-all-this-information-help-you-decide-necca6qahqab4bgz",
    publishedAt: "2026-10-04",
    portrait: {
      src: "/writing/thread-alex-karp.jpg",
      alt: "AI-assisted editorial portrait of Alex Karp with curly hair and round glasses, printed in forest-green halftone on cream paper with a small terracotta accent.",
      width: 640,
      height: 640,
    },
  },
  {
    slug: "visualize-value",
    title: "Nice picture. What does the product do?",
    description:
      "A lesson from Jack Butcher of Visualize Value on explaining a product: show the change between two situations, before the screen full of features.",
    url: "https://cloud.trycapture.app/t/nice-picture-what-does-the-product-do-6if74flhnidxigam",
    publishedAt: "2026-10-04",
    portrait: {
      src: "/writing/thread-visualize-value.jpg",
      alt: "AI-assisted editorial portrait of Jack Butcher with dark curly hair and a full beard, in forest-green halftone on cream paper with a small terracotta accent.",
      width: 640,
      height: 640,
    },
  },
  {
    slug: "vadim-zeland",
    title: "One more fix. Then I’ll show someone.",
    description:
      "An observation from Vadim Zeland’s Reality Transurfing, applied to making things: when does improving the work turn into putting off the moment someone sees it?",
    url: "https://cloud.trycapture.app/t/when-does-making-it-better-become-putting-it-off-sg54mx2o4gsbomtb",
    publishedAt: "2026-10-03",
    portrait: {
      src: "/writing/thread-vadim-zeland.jpg",
      alt: "AI-assisted editorial portrait of Vadim Zeland wearing dark sunglasses, in forest-green halftone on cream paper.",
      width: 640,
      height: 640,
    },
  },
  {
    slug: "jim-jannard",
    title: "Does the product earn the story?",
    description:
      "From Jim Jannard’s Origins of Oakley interview: before improving the pitch, find the part of the product that gives it something concrete to say.",
    url: "https://cloud.trycapture.app/t/jim-jannard-the-product-earns-its-story-be3ln2xq7py6r2au",
    publishedAt: "2026-10-03",
    portrait: {
      src: "/writing/thread-jim-jannard.jpg",
      alt: "AI-assisted editorial portrait of Jim Jannard adjusting his sunglasses, in forest-green halftone on cream paper.",
      width: 640,
      height: 640,
    },
  },
];
