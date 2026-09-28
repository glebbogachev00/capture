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
        aria-label="Watch the 57-second demo"
        onClick={() => setStarted(true)}
      >
        <picture>
          <source srcSet="/demos/capture-overview.webp" type="image/webp" />
          <img
            src="/demos/capture-overview.jpg"
            alt=""
            width={1920}
            height={1080}
            fetchPriority="high"
            decoding="async"
          />
        </picture>
        <span className="hero-demo-play">
          <Play size={17} strokeWidth={1.8} fill="currentColor" />
          Watch the 57-second demo
        </span>
      </button>
    );
  }

  return (
    <video
      aria-label="Capture product demo"
      controls
      autoPlay
      playsInline
      preload="metadata"
      poster="/demos/capture-overview.jpg"
      width={1920}
      height={1080}
    >
      <source src="/demos/capture-overview.mp4" type="video/mp4" />
    </video>
  );
}
