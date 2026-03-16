/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Upload, 
  Play, 
  Pause, 
  Download, 
  Trash2, 
  Settings, 
  Layers, 
  Clock, 
  Maximize, 
  ChevronRight, 
  ChevronLeft,
  Video,
  Image as ImageIcon,
  Sparkles,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import confetti from 'canvas-confetti';

// --- Utility ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
type AspectRatio = '16:9' | '9:16' | '1:1';
type Resolution = '720p' | '1080p';
type TransitionType = 'zoom-in' | 'zoom-out' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'fade' | 'rotate-in' | 'rotate-out' | 'combo' | 'cinematic-combo' | 'cinematic-3d' | 'cinematic-3d-clean' | 'cinematic-3d-pro' | 'cinematic-3d-elite';

interface ImageItem {
  id: string;
  url: string;
  file: File;
  name: string;
}

interface Particle {
  x: number;
  y: number;
  size: number;
  speedX: number;
  speedY: number;
  opacity: number;
}

const TRANSITIONS: Exclude<TransitionType, 'combo'>[] = [
  'zoom-in', 'zoom-out', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'fade', 'rotate-in', 'rotate-out'
];

// --- Constants ---
const ASPECT_RATIO_VALUES = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
};

const RESOLUTION_VALUES = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

export default function App() {
  // State
  const [images, setImages] = useState<ImageItem[]>([]);
  const [imageCache, setImageCache] = useState<Record<string, HTMLImageElement>>({});
  const [duration, setDuration] = useState<number>(3); // seconds per image
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [resolution, setResolution] = useState<Resolution>('1080p');
  const [transition, setTransition] = useState<TransitionType>('cinematic-3d');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0); // 0 to 1 for current image
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [offscreenCanvas] = useState(() => {
    if (typeof document !== 'undefined') {
      return document.createElement('canvas');
    }
    return null;
  });

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(null);
  const startTimeRef = useRef<number>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Initialize Particles
  useEffect(() => {
    const p: Particle[] = [];
    for (let i = 0; i < 40; i++) {
      p.push({
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 3 + 1,
        speedX: (Math.random() - 0.5) * 0.05,
        speedY: (Math.random() - 0.5) * 0.05,
        opacity: Math.random() * 0.5 + 0.2
      });
    }
    setParticles(p);
  }, []);

  // --- Handlers ---
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles: File[] = Array.from(e.target.files);
      const newItems: ImageItem[] = newFiles.map((file: File) => ({
        id: Math.random().toString(36).substring(7),
        url: URL.createObjectURL(file),
        file,
        name: file.name
      }));
      
      // Pre-load images into cache
      newItems.forEach(item => {
        const img = new Image();
        img.src = item.url;
        img.onload = () => {
          setImageCache(prev => ({ ...prev, [item.id]: img }));
        };
      });

      setImages(prev => [...prev, ...newItems]);
    }
  };

  const removeImage = (id: string) => {
    setImages(prev => {
      const filtered = prev.filter(img => img.id !== id);
      const removed = prev.find(img => img.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      return filtered;
    });
    setImageCache(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const clearAll = () => {
    images.forEach(img => URL.revokeObjectURL(img.url));
    setImages([]);
    setImageCache({});
    setCurrentIndex(0);
    setProgress(0);
    setIsPlaying(false);
  };

  // --- Rendering Logic ---
  const getTransitionForIndex = (index: number): Exclude<TransitionType, 'combo'> => {
    if (transition !== 'combo') return transition;
    return TRANSITIONS[index % TRANSITIONS.length];
  };

  const drawFrame = useCallback((ctx: CanvasRenderingContext2D, imgIndex: number, t: number) => {
    if (images.length === 0) return;
    
    const { width: canvasW, height: canvasH } = ctx.canvas;
    const transType = getTransitionForIndex(imgIndex);

    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvasW, canvasH);

    const getEliteStyle = (idx: number) => {
      const styles = [
        { zoom: 'in', slide: 'left' as const, rotate: 'cw' as const },
        { zoom: 'out', slide: 'right' as const, rotate: 'ccw' as const },
        { zoom: 'in', slide: 'up' as const, rotate: 'none' as const },
        { zoom: 'out', slide: 'down' as const, rotate: 'cw' as const },
      ];
      return styles[idx % styles.length];
    };

    const renderImage = (idx: number, progress: number, type: TransitionType, xOffset: number = 0, yOffset: number = 0, isBackground: boolean = false, customRot: number = 0) => {
      const currentImgData = images[idx % images.length];
      if (!currentImgData) return;

      const img = imageCache[currentImgData.id];
      if (!img || !img.complete) return;

      ctx.save();

      // 1. Calculate Base "Cover" Dimensions
      const imgRatio = img.width / img.height;
      const canvasRatio = canvasW / canvasH;
      let drawW, drawH;

      if (imgRatio > canvasRatio) {
        drawH = canvasH;
        drawW = canvasH * imgRatio;
      } else {
        drawW = canvasW;
        drawH = canvasW / imgRatio;
      }

      // 2. Determine Animation Properties
      let scale = 1.15; 
      let panX = 0;
      let panY = 0;
      let rot = 0;
      let opacity = 1;
      let blurAmount = 0;

      const ease = (n: number) => n < 0.5 ? 2 * n * n : -1 + (4 - 2 * n) * n;
      const easeOut = (n: number) => 1 - Math.pow(1 - n, 3);
      const easeOutQuart = (n: number) => 1 - Math.pow(1 - n, 4);
      const easeInOutQuint = (n: number) => n < 0.5 ? 16 * n * n * n * n * n : 1 - Math.pow(-2 * n + 2, 5) / 2;

      if (type === 'cinematic-3d' || type === 'cinematic-3d-clean' || type === 'cinematic-3d-pro' || type === 'cinematic-3d-elite') {
        let t = progress;
        const swing = Math.sin(progress * Math.PI * 2) * 0.008;
        const isElite = type === 'cinematic-3d-elite';
        const eliteStyle = isElite ? getEliteStyle(idx) : { zoom: 'in', slide: 'left' };
        
        if (isBackground) {
          const baseScale = eliteStyle.zoom === 'in' ? 1.4 : 1.7;
          const scaleMod = eliteStyle.zoom === 'in' ? 0.3 : -0.3;
          scale = baseScale + (t * scaleMod);
          panX = t * 0.05 * canvasW;
          blurAmount = (type === 'cinematic-3d-pro' || isElite) ? 20 + (t * 10) : 15;
          opacity = 0.6;
        } else {
          const baseScale = eliteStyle.zoom === 'in' ? 1.1 : 1.4;
          const scaleMod = eliteStyle.zoom === 'in' ? 0.3 : -0.3;
          
          if (progress < 0.4) {
            const stageT = ease(progress / 0.4);
            scale = baseScale + (stageT * scaleMod * 0.2);
            panX = stageT * -0.02 * canvasW;
          } else if (progress < 0.8) {
            const stageT = easeOut((progress - 0.4) / 0.4);
            scale = (baseScale + scaleMod * 0.2) + (stageT * scaleMod * 0.6);
            panX = -0.02 * canvasW + (stageT * -0.06 * canvasW);
            panY = stageT * 0.03 * canvasH;
          } else {
            const stageT = (progress - 0.8) / 0.2;
            scale = (baseScale + scaleMod * 0.8) + (stageT * scaleMod * 0.2);
            panX = -0.08 * canvasW + (stageT * -0.02 * canvasW);
            panY = 0.03 * canvasH;
          }
          rot = swing + (t * 0.03) + customRot;
        }
      } else if (type === 'cinematic-combo') {
        if (progress < 0.5) {
          const t = ease(progress / 0.5);
          scale = 1.15 + (t * 0.1);
          rot = Math.sin(progress * Math.PI) * 0.01;
        } else {
          const t = ease((progress - 0.5) / 0.5);
          scale = 1.25 + (t * 0.15);
          panX = t * -0.1 * canvasW;
          panY = t * 0.1 * canvasH;
          rot = 0.01 + Math.cos(progress * Math.PI) * 0.01;
        }
      } else {
        scale = 1.1; 
        switch (type) {
          case 'zoom-in': scale = 1.1 + (progress * 0.2); break;
          case 'zoom-out': scale = 1.3 - (progress * 0.2); break;
          case 'fade': opacity = progress; scale = 1.1; break;
          case 'rotate-in':
            rot = (1 - progress) * 0.1;
            scale = 1.1 + (progress * 0.1);
            break;
          case 'rotate-out':
            rot = (progress - 1) * 0.1;
            scale = 1.2 - (progress * 0.1);
            break;
          default: scale = 1.1; break;
        }
      }

      // 3. Apply Transformations
      ctx.translate(canvasW / 2 + xOffset + panX, canvasH / 2 + yOffset + panY);
      ctx.rotate(rot);
      ctx.scale(scale, scale);
      ctx.globalAlpha = opacity;
      
      // Optimized Blur using Offscreen Scaling (much faster than ctx.filter)
      if (blurAmount > 0 && offscreenCanvas) {
        const blurScale = 0.2; // Scale down for fast blur
        offscreenCanvas.width = drawW * blurScale;
        offscreenCanvas.height = drawH * blurScale;
        const octx = offscreenCanvas.getContext('2d');
        if (octx) {
          octx.imageSmoothingEnabled = true;
          octx.drawImage(img, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
          ctx.drawImage(offscreenCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
        }
      } else {
        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      }

      // PRO Feature: Bloom/Glow Overlay (Simplified for performance)
      if ((type === 'cinematic-3d-pro' || type === 'cinematic-3d-elite') && !isBackground) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.1 * Math.sin(progress * Math.PI);
        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.globalCompositeOperation = 'source-over';
      }
      
      ctx.restore();
    };

    const ease = (n: number) => n < 0.5 ? 2 * n * n : -1 + (4 - 2 * n) * n;
    const easeInOutQuint = (n: number) => n < 0.5 ? 16 * n * n * n * n * n : 1 - Math.pow(-2 * n + 2, 5) / 2;

    if (transType === 'cinematic-3d' || transType === 'cinematic-3d-clean' || transType === 'cinematic-3d-pro' || transType === 'cinematic-3d-elite') {
      const transitionThreshold = transType === 'cinematic-3d-elite' ? 0.6 : 0.8;
      
      if (t < transitionThreshold) {
        // Normal Parallax Rendering
        const progress = t / transitionThreshold;
        renderImage(imgIndex, progress, transType, 0, 0, true); // Background
        renderImage(imgIndex, progress, transType, 0, 0, false); // Foreground
      } else {
        // Seamless Push Transition (No Gaps)
        const transitionProgress = (t - transitionThreshold) / (1 - transitionThreshold);
        const slideT = easeInOutQuint(transitionProgress);
        
        const isElite = transType === 'cinematic-3d-elite';
        const eliteStyle = isElite ? getEliteStyle(imgIndex) : { zoom: 'in' as const, slide: 'left' as const, rotate: 'none' as const };
        const nextEliteStyle = isElite ? getEliteStyle(imgIndex + 1) : { zoom: 'in' as const, slide: 'left' as const, rotate: 'none' as const };

        let offX = 0, offY = 0;
        let nextOffX = 0, nextOffY = 0;

        switch (eliteStyle.slide) {
          case 'left': offX = -slideT * canvasW; nextOffX = offX + canvasW; break;
          case 'right': offX = slideT * canvasW; nextOffX = offX - canvasW; break;
          case 'up': offY = -slideT * canvasH; nextOffY = offY + canvasH; break;
          case 'down': offY = slideT * canvasH; nextOffY = offY - canvasH; break;
        }
        
        // Elite Rotation Logic
        let currentRot = 0;
        let nextRot = 0;
        const rotAngle = 0.3; 
        if (isElite) {
          currentRot = slideT * rotAngle;
          nextRot = (slideT - 1) * rotAngle;
        }

        // BRUTE-FORCE OUTSIDE CALCULATION
        // To be 100% sure it starts outside, we use a distance that accounts for 
        // max scale (1.4) and rotation. 1.5x canvas dimension is a safe bet.
        const totalDistX = canvasW * 1.6;
        const totalDistY = canvasH * 1.6;

        if (eliteStyle.slide === 'left') {
          offX = -slideT * totalDistX;
          nextOffX = totalDistX - slideT * totalDistX;
        } else if (eliteStyle.slide === 'right') {
          offX = slideT * totalDistX;
          nextOffX = -totalDistX + slideT * totalDistX;
        } else if (eliteStyle.slide === 'up') {
          offY = -slideT * totalDistY;
          nextOffY = totalDistY - slideT * totalDistY;
        } else if (eliteStyle.slide === 'down') {
          offY = slideT * totalDistY;
          nextOffY = -totalDistY + slideT * totalDistY;
        }

        // Current image slides out (keeping it at its end state of the first phase)
        renderImage(imgIndex, 1.0, transType, offX, offY, true, currentRot);
        renderImage(imgIndex, 1.0, transType, offX, offY, false, currentRot);
        
        // Next image slides in from COMPLETELY OUTSIDE
        // We render it at its progress=0 state so it's ready to start its own animation
        renderImage(imgIndex + 1, 0, transType, nextOffX, nextOffY, true, nextRot);
        renderImage(imgIndex + 1, 0, transType, nextOffX, nextOffY, false, nextRot);
      }
    } else if (transType === 'cinematic-combo' && t > 0.8) {
      const transitionProgress = (t - 0.8) / 0.2;
      const slideT = ease(transitionProgress);
      
      // Current image pushes out to the left
      renderImage(imgIndex, t, 'cinematic-combo', -slideT * canvasW);
      
      // Next image follows immediately from the right (perfectly attached)
      renderImage(imgIndex + 1, 0, 'cinematic-combo', (1 - slideT) * canvasW);
    } else if (transType === 'slide-left') {
      const slideT = ease(t);
      renderImage(imgIndex, t, transType, -slideT * canvasW);
      renderImage(imgIndex + 1, 0, transType, (1 - slideT) * canvasW);
    } else if (transType === 'slide-right') {
      const slideT = ease(t);
      renderImage(imgIndex, t, transType, slideT * canvasW);
      renderImage(imgIndex + 1, 0, transType, (slideT - 1) * canvasW);
    } else {
      renderImage(imgIndex, t, transType);
    }

    // Add Cinematic Vignette
    const vignette = ctx.createRadialGradient(canvasW / 2, canvasH / 2, canvasW / 4, canvasW / 2, canvasH / 2, canvasW * 0.9);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(0.7, 'rgba(0,0,0,0.2)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Add Dust Particles (Only for original 3D mode)
    if (transition === 'cinematic-3d') {
      ctx.save();
      particles.forEach(p => {
        const px = ((p.x + t * p.speedX * 1000) % 100) / 100 * canvasW;
        const py = ((p.y + t * p.speedY * 1000) % 100) / 100 * canvasH;
        
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity * (1 - t * 0.5)})`;
        ctx.fill();
      });
      ctx.restore();
    }

    // Add Cinematic Light Leak
    if (transition === 'cinematic-3d' || transition === 'cinematic-3d-clean' || transition === 'cinematic-3d-pro' || transition === 'cinematic-3d-elite') {
      ctx.save();
      const leakGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, canvasW);
      leakGradient.addColorStop(0, `rgba(255, 180, 100, ${Math.sin(t * Math.PI) * (transition === 'cinematic-3d-pro' || transition === 'cinematic-3d-elite' ? 0.25 : 0.15)})`);
      leakGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = leakGradient;
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();
    }
  }, [images, transition, imageCache, particles]);

  // --- Animation Loop ---
  const animate = useCallback((time: number) => {
    if (!startTimeRef.current) startTimeRef.current = time;
    const elapsed = (time - startTimeRef.current) / 1000;
    
    const totalDuration = duration;
    const currentProgress = (elapsed % totalDuration) / totalDuration;
    const currentImgIndex = Math.floor(elapsed / totalDuration) % images.length;

    setCurrentIndex(currentImgIndex);
    setProgress(currentProgress);

    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        drawFrame(ctx, currentImgIndex, currentProgress);
      }
    }

    requestRef.current = requestAnimationFrame(animate);
  }, [duration, images.length, drawFrame]);

  useEffect(() => {
    if (isPlaying && images.length > 0) {
      requestRef.current = requestAnimationFrame(animate);
    } else {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      startTimeRef.current = null;
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying, images.length, animate]);

  // --- Export Logic ---
  const startExport = async () => {
    if (images.length === 0) return;
    
    setIsExporting(true);
    setIsPlaying(false);
    setExportProgress(0);
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set canvas to export resolution
    const res = RESOLUTION_VALUES[resolution];
    const originalWidth = canvas.width;
    const originalHeight = canvas.height;
    
    canvas.width = res.width;
    canvas.height = res.height;

    const stream = canvas.captureStream(30); // 30 FPS fixed
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: resolution === '1080p' ? 12000000 : 8000000
    });

    recordedChunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tofa-video-v2-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      
      // Reset canvas
      canvas.width = originalWidth;
      canvas.height = originalHeight;
      setIsExporting(false);
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 }
      });
    };

    recorder.start(1000); // Collect data every second

    // Manual frame-by-frame rendering for export to ensure quality
    const ctx = canvas.getContext('2d', { alpha: false })!;
    const fps = 30;
    const frameDelay = 1000 / fps;
    const totalFrames = images.length * duration * fps;
    
    // Give recorder a moment to warm up
    await new Promise(r => setTimeout(r, 500));

    for (let i = 0; i < images.length; i++) {
      for (let f = 0; f < duration * fps; f++) {
        const t = f / (duration * fps);
        drawFrame(ctx, i, t);
        setExportProgress(((i * duration * fps + f) / totalFrames) * 100);
        // Sync with recorder's expected frame rate
        await new Promise(r => setTimeout(r, frameDelay)); 
      }
    }

    // Give it a final moment to capture the last frame
    await new Promise(r => setTimeout(r, 500));
    recorder.stop();
  };

  // Set initial canvas size based on aspect ratio
  useEffect(() => {
    if (canvasRef.current) {
      const container = canvasRef.current.parentElement;
      if (container) {
        const ratio = ASPECT_RATIO_VALUES[aspectRatio];
        const containerW = container.clientWidth;
        const containerH = container.clientHeight;
        
        if (containerW / containerH > ratio) {
          canvasRef.current.height = containerH;
          canvasRef.current.width = containerH * ratio;
        } else {
          canvasRef.current.width = containerW;
          canvasRef.current.height = containerW / ratio;
        }
      }
    }
  }, [aspectRatio]);

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-white font-sans selection:bg-indigo-500/30">
      {/* Background Gradient Orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-indigo-600/10 blur-[120px] rounded-full" />
        <div className="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] bg-purple-600/10 blur-[120px] rounded-full" />
      </div>

      {/* Header */}
      <header className="border-b border-white/5 bg-black/40 backdrop-blur-2xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/20 rotate-3">
              <Video className="text-white w-7 h-7" />
            </div>
            <div>
              <h1 className="font-black text-2xl tracking-tighter bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">Video Frame By TOFA V.02</h1>
              <p className="text-[10px] uppercase tracking-[0.3em] text-indigo-400 font-bold">Pro Cinematic Engine</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={startExport}
              disabled={images.length === 0 || isExporting}
              className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 disabled:opacity-50 disabled:hover:from-indigo-500 text-white px-6 py-2.5 rounded-full font-bold transition-all active:scale-95 shadow-xl shadow-indigo-500/20"
            >
              {isExporting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Processing {Math.round(exportProgress)}%
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Export Master
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Preview & Timeline */}
        <div className="lg:col-span-8 space-y-6">
          {/* Preview Area */}
          <div className="relative aspect-video bg-zinc-900 rounded-3xl overflow-hidden border border-white/5 shadow-2xl group">
            <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-zinc-800 to-zinc-900">
              {images.length === 0 ? (
                <div className="text-center space-y-4">
                  <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto border border-white/10">
                    <ImageIcon className="w-10 h-10 text-zinc-500" />
                  </div>
                  <p className="text-zinc-400 font-medium">Upload images to start creating</p>
                  <label className="inline-flex items-center gap-2 bg-white text-black px-6 py-3 rounded-full font-bold cursor-pointer hover:bg-zinc-200 transition-colors">
                    <Upload className="w-4 h-4" />
                    Browse Files
                    <input type="file" multiple accept="image/*" className="hidden" onChange={handleImageUpload} />
                  </label>
                </div>
              ) : (
                <canvas 
                  ref={canvasRef} 
                  className="max-w-full max-h-full shadow-2xl"
                />
              )}
            </div>

            {/* Preview Controls */}
            {images.length > 0 && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-black/60 backdrop-blur-md px-6 py-3 rounded-full border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center text-white hover:scale-110 transition-transform active:scale-95 shadow-xl shadow-indigo-500/30"
                >
                  {isPlaying ? <Pause className="fill-current w-7 h-7" /> : <Play className="fill-current w-7 h-7 ml-1" />}
                </button>
                <button 
                  onClick={() => setCurrentIndex(prev => Math.min(images.length - 1, prev + 1))}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>

          {/* Timeline / Image List */}
          <div className="bg-zinc-900/50 rounded-3xl border border-white/5 p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-indigo-400" />
                <h2 className="font-bold text-lg">Timeline</h2>
                <span className="bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded text-xs text-indigo-300 font-mono">{images.length} items</span>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={clearAll}
                  className="text-xs text-zinc-500 hover:text-red-400 transition-colors flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear All
                </button>
                <label className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-full cursor-pointer transition-colors flex items-center gap-2">
                  <Upload className="w-3 h-3" />
                  Add More
                  <input type="file" multiple accept="image/*" className="hidden" onChange={handleImageUpload} />
                </label>
              </div>
            </div>

            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
              <AnimatePresence mode="popLayout">
                {images.map((img, idx) => (
                  <motion.div 
                    key={img.id}
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className={cn(
                      "relative flex-shrink-0 w-32 aspect-video rounded-xl overflow-hidden border-2 transition-all group",
                      currentIndex === idx ? "border-indigo-500 shadow-xl shadow-indigo-500/30 scale-105 z-10" : "border-white/5"
                    )}
                  >
                    <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button 
                        onClick={() => removeImage(img.id)}
                        className="p-1.5 bg-red-500 rounded-lg hover:bg-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="absolute bottom-1 right-1 bg-black/60 px-1.5 py-0.5 rounded text-[8px] font-mono">
                      {idx + 1}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              
              {images.length === 0 && (
                <div className="w-full py-12 border-2 border-dashed border-white/5 rounded-2xl flex flex-col items-center justify-center text-zinc-600">
                  <ImageIcon className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-sm">No images in timeline</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Settings */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-zinc-900/50 rounded-3xl border border-white/5 p-6 sticky top-24">
            <div className="flex items-center gap-2 mb-8">
              <Settings className="w-5 h-5 text-indigo-400" />
              <h2 className="font-bold text-lg">Project Settings</h2>
            </div>

            <div className="space-y-8">
              {/* Duration */}
              <div className="space-y-3">
                <label className="text-xs uppercase tracking-widest text-zinc-500 font-bold flex items-center gap-2">
                  <Clock className="w-3 h-3" />
                  Image Duration
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {[1, 2, 3, 5, 10].map(d => (
                    <button
                      key={d}
                      onClick={() => setDuration(d)}
                      className={cn(
                        "py-2 rounded-xl text-xs font-bold border transition-all",
                        duration === d 
                          ? "bg-indigo-500 border-indigo-500 text-white shadow-lg shadow-indigo-500/20" 
                          : "bg-white/5 border-white/5 hover:border-white/20 text-zinc-400"
                      )}
                    >
                      {d}s
                    </button>
                  ))}
                </div>
              </div>

              {/* Aspect Ratio */}
              <div className="space-y-3">
                <label className="text-xs uppercase tracking-widest text-zinc-500 font-bold flex items-center gap-2">
                  <Maximize className="w-3 h-3" />
                  Aspect Ratio
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['16:9', '9:16', '1:1'] as AspectRatio[]).map(r => (
                    <button
                      key={r}
                      onClick={() => setAspectRatio(r)}
                      className={cn(
                        "py-3 rounded-xl text-xs font-bold border transition-all flex flex-col items-center gap-1",
                        aspectRatio === r 
                          ? "bg-indigo-500 border-indigo-500 text-white shadow-lg shadow-indigo-500/20" 
                          : "bg-white/5 border-white/5 hover:border-white/20 text-zinc-400"
                      )}
                    >
                      <div className={cn(
                        "border-2 mb-1",
                        r === '16:9' ? "w-6 h-3.5" : r === '9:16' ? "w-3.5 h-6" : "w-5 h-5",
                        aspectRatio === r ? "border-black" : "border-zinc-600"
                      )} />
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Resolution */}
              <div className="space-y-3">
                <label className="text-xs uppercase tracking-widest text-zinc-500 font-bold flex items-center gap-2">
                  <Video className="w-3 h-3" />
                  Export Resolution
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['720p', '1080p'] as Resolution[]).map(res => (
                    <button
                      key={res}
                      onClick={() => setResolution(res)}
                      className={cn(
                        "py-2.5 rounded-xl text-xs font-bold border transition-all",
                        resolution === res 
                          ? "bg-indigo-500 border-indigo-500 text-white shadow-lg shadow-indigo-500/20" 
                          : "bg-white/5 border-white/5 hover:border-white/20 text-zinc-400"
                      )}
                    >
                      {res}
                    </button>
                  ))}
                </div>
              </div>

              {/* Transitions */}
              <div className="space-y-3">
                <label className="text-xs uppercase tracking-widest text-zinc-500 font-bold flex items-center gap-2">
                  <Sparkles className="w-3 h-3" />
                  Transition Style
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setTransition('cinematic-3d')}
                    className={cn(
                      "col-span-2 py-4 rounded-xl text-xs font-bold border transition-all flex flex-col items-center justify-center gap-1",
                      transition === 'cinematic-3d' 
                        ? "bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-500 border-indigo-400 text-white shadow-lg shadow-indigo-500/40 scale-[1.02]" 
                        : "bg-white/5 border-white/5 hover:border-white/20 text-zinc-400"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-yellow-400 animate-pulse" />
                      <span className="text-sm tracking-tight">ULTRA CINEMATIC 3D</span>
                    </div>
                    <span className="text-[9px] opacity-60 uppercase tracking-widest">Parallax Depth Engine</span>
                  </button>
                  <button
                    onClick={() => setTransition('cinematic-3d-clean')}
                    className={cn(
                      "col-span-2 py-4 rounded-xl text-xs font-bold border transition-all flex flex-col items-center justify-center gap-1",
                      transition === 'cinematic-3d-clean' 
                        ? "bg-gradient-to-br from-emerald-500 via-teal-600 to-cyan-500 border-emerald-400 text-white shadow-lg shadow-emerald-500/40 scale-[1.02]" 
                        : "bg-white/5 border-white/5 hover:border-white/20 text-zinc-400"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <ImageIcon className="w-4 h-4 text-cyan-300" />
                      <span className="text-sm tracking-tight">ULTRA CINEMATIC 3D (CLEAN)</span>
                    </div>
                    <span className="text-[9px] opacity-60 uppercase tracking-widest">No Particles • Pure Visuals</span>
                  </button>
                  <button
                    onClick={() => setTransition('cinematic-3d-pro')}
                    className={cn(
                      "col-span-2 py-4 rounded-xl text-xs font-bold border transition-all flex flex-col items-center justify-center gap-1",
                      transition === 'cinematic-3d-pro' 
                        ? "bg-gradient-to-br from-amber-500 via-orange-600 to-red-600 border-amber-400 text-white shadow-lg shadow-amber-500/40 scale-[1.02]" 
                        : "bg-white/5 border-white/5 hover:border-white/20 text-zinc-400"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-yellow-300 animate-bounce" />
                      <span className="text-sm tracking-tight">ULTRA CINEMATIC 3D (PRO)</span>
                    </div>
                    <span className="text-[9px] opacity-60 uppercase tracking-widest">Soft Transitions • Bloom • Alive</span>
                  </button>
                  <button
                    onClick={() => setTransition('cinematic-3d-elite')}
                    className={cn(
                      "col-span-2 py-4 rounded-xl text-xs font-bold border transition-all flex flex-col items-center justify-center gap-1",
                      transition === 'cinematic-3d-elite' 
                        ? "bg-gradient-to-br from-rose-500 via-pink-600 to-fuchsia-600 border-rose-400 text-white shadow-lg shadow-rose-500/40 scale-[1.02]" 
                        : "bg-white/5 border-white/5 hover:border-white/20 text-zinc-400"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-white animate-spin-slow" />
                      <span className="text-sm tracking-tight">ULTRA CINEMATIC 3D (ELITE)</span>
                    </div>
                    <span className="text-[9px] opacity-60 uppercase tracking-widest">Multi-Directional • Dynamic Variety</span>
                  </button>
                  <button
                    onClick={() => setTransition('cinematic-combo')}
                    className={cn(
                      "col-span-2 py-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-2",
                      transition === 'cinematic-combo' 
                        ? "bg-gradient-to-r from-indigo-500 to-purple-500 border-indigo-500 text-white" 
                        : "bg-white/5 border-white/5 hover:border-white/20 text-zinc-400"
                    )}
                  >
                    <Video className="w-4 h-4" />
                    Classic Cinematic
                  </button>
                  <button
                    onClick={() => setTransition('combo')}
                    className={cn(
                      "col-span-2 py-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-2",
                      transition === 'combo' 
                        ? "bg-gradient-to-r from-indigo-500 to-purple-500 border-indigo-500 text-white" 
                        : "bg-white/5 border-white/5 hover:border-white/20 text-zinc-400"
                    )}
                  >
                    <RefreshCw className="w-4 h-4" />
                    Dynamic Combo Mode
                  </button>
                  {TRANSITIONS.map(t => (
                    <button
                      key={t}
                      onClick={() => setTransition(t)}
                      className={cn(
                        "py-2.5 rounded-xl text-[10px] uppercase tracking-wider font-bold border transition-all",
                        transition === t 
                          ? "bg-indigo-500 border-indigo-500 text-white shadow-lg shadow-indigo-500/20" 
                          : "bg-white/5 border-white/5 hover:border-white/20 text-zinc-400"
                      )}
                    >
                      {t.replace('-', ' ')}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-zinc-500 italic mt-2">
                  {transition === 'cinematic-3d'
                    ? "Advanced dual-layer parallax with camera swing and atmospheric dust particles."
                    : transition === 'cinematic-3d-clean'
                    ? "Pure cinematic 3D parallax without atmospheric dust particles."
                    : transition === 'cinematic-3d-pro'
                    ? "Pro-grade cinematic experience with soft transitions, bloom glow, and dynamic depth of field."
                    : transition === 'cinematic-3d-elite'
                    ? "The ultimate experience with randomized zoom directions and multi-directional seamless transitions."
                    : transition === 'cinematic-combo'
                    ? "Using multi-stage 3D keyframe animations for a professional cinematic look."
                    : transition === 'combo' 
                    ? "Combo mode automatically cycles through all transitions for a cinematic look." 
                    : `Using ${transition} transition for all images.`}
                </p>
              </div>
            </div>

            {/* Stats */}
            <div className="mt-10 pt-6 border-t border-white/5 space-y-2">
              <div className="flex justify-between text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                <span>Total Duration</span>
                <span className="text-white">{(images.length * duration).toFixed(1)}s</span>
              </div>
              <div className="flex justify-between text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                <span>Estimated Size</span>
                <span className="text-white">~{(images.length * duration * (resolution === '1080p' ? 1 : 0.6)).toFixed(1)} MB</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-white/5 mt-12">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-3 opacity-50">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
              <Video className="w-4 h-4 text-white" />
            </div>
            <span className="text-xs font-bold uppercase tracking-widest">Video Frame By TOFA V.01</span>
          </div>
          <div className="flex gap-8 text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
            <a href="#" className="hover:text-indigo-400 transition-colors">Privacy</a>
            <a href="#" className="hover:text-indigo-400 transition-colors">Terms</a>
            <a href="#" className="hover:text-indigo-400 transition-colors">Help</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
