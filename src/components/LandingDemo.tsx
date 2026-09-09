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
        aria-label="Play Capture demo"
        onClick={() => setStarted(true)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/demos/two-places.jpg" alt="" width={1440} height={1000} />
        <span className="hero-demo-play">
          <Play size={17} strokeWidth={1.8} fill="currentColor" />
          Watch the 10-second demo
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
      width={1440}
      height={1000}
    >
      <source src="/demos/two-places.mp4" type="video/mp4" />
    </video>
  );
}
