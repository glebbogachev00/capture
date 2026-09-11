"use client";

import { useState } from "react";
import { Play } from "lucide-react";

export function LandingDemo() {
  const [started, setStarted] = useState(false);

  if (!started) {
    return (
      <button
        type="button"
        className="hero-demo-poster"
        aria-label="Watch the 25-second demo"
        onClick={() => setStarted(true)}
      >
        <picture>
          <source
            media="(max-width: 600px)"
            srcSet="/demos/two-places-mobile.avif"
            type="image/avif"
          />
          <source
            media="(max-width: 600px)"
            srcSet="/demos/two-places-mobile.webp"
            type="image/webp"
          />
          <source srcSet="/demos/two-places.avif" type="image/avif" />
          <source srcSet="/demos/two-places.webp" type="image/webp" />
          <img
            src="/demos/two-places.jpg"
            alt=""
            width={1920}
            height={1230}
            fetchPriority="high"
            decoding="async"
          />
        </picture>
        <span className="hero-demo-play">
          <Play size={17} strokeWidth={1.8} fill="currentColor" />
          Watch the 25-second demo
        </span>
      </button>
    );
  }

  return (
    <video
      aria-label="Capture product demo"
      controls
      autoPlay
      muted
      playsInline
      preload="metadata"
      poster="/demos/two-places.jpg"
      width={1920}
      height={1230}
    >
      <source
        media="(max-width: 600px)"
        src="/demos/two-places-mobile.mp4"
        type="video/mp4"
      />
      <source src="/demos/two-places.mp4" type="video/mp4" />
    </video>
  );
}
