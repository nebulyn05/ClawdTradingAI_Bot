"use client";

import { useEffect, useRef } from "react";

const COLORS = ["#E8614D", "#4DD8B0", "#FF9A87", "#7ED9C0"];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
  maxLife: number;
  color: string;
}

/**
 * A lightweight, real, working replacement for the original site's WebGL
 * fluid-simulation cursor trail (which was driven entirely by client JS
 * that no longer exists in this rebuild). Not a Navier-Stokes solver —
 * a velocity-based particle trail with additive glow and fade, cheap
 * enough to run on a plain 2D canvas.
 */
export function FluidCursor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    const particles: Particle[] = [];
    let lastX = -1;
    let lastY = -1;
    let lastT = performance.now();

    function spawn(x: number, y: number, speed: number) {
      const count = Math.min(4, 1 + Math.floor(speed / 40));
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spread = Math.random() * Math.min(2, speed * 0.05);
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * spread,
          vy: Math.sin(angle) * spread,
          radius: 6 + Math.random() * 14,
          life: 0,
          maxLife: 500 + Math.random() * 400,
          color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
        });
      }
      if (particles.length > 220) particles.splice(0, particles.length - 220);
    }

    function onPointerMove(e: PointerEvent) {
      const x = e.clientX;
      const y = e.clientY;
      const now = performance.now();
      if (lastX >= 0) {
        const dt = Math.max(1, now - lastT);
        const dist = Math.hypot(x - lastX, y - lastY);
        const speed = (dist / dt) * 16;
        spawn(x, y, speed);
      }
      lastX = x;
      lastY = y;
      lastT = now;
    }
    window.addEventListener("pointermove", onPointerMove);

    let raf = 0;
    let prevFrame = performance.now();

    function frame(now: number) {
      const dt = now - prevFrame;
      prevFrame = now;
      ctx!.clearRect(0, 0, width, height);
      ctx!.globalCompositeOperation = "lighter";

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!;
        p.life += dt;
        if (p.life >= p.maxLife) {
          particles.splice(i, 1);
          continue;
        }
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.96;
        p.vy *= 0.96;

        const t = p.life / p.maxLife;
        const alpha = (1 - t) * 0.35;
        const r = p.radius * (1 + t * 1.8);

        const gradient = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        gradient.addColorStop(0, hexToRgba(p.color, alpha));
        gradient.addColorStop(1, hexToRgba(p.color, 0));
        ctx!.fillStyle = gradient;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx!.fill();
      }

      ctx!.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 z-[55] pointer-events-none"
    />
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
