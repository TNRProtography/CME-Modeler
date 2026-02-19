import React, { useState, useRef, useEffect, useCallback } from 'react';
import CloseIcon from './icons/CloseIcon';
import PlayIcon from './icons/PlayIcon';
import PauseIcon from './icons/PauseIcon';
import NextIcon from './icons/NextIcon';
import PrevIcon from './icons/PrevIcon';

const DownloadIcon: React.FC<{className?: string}> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
);

type MediaObject =
    | { type: 'image', url: string }
    | { type: 'video', url: string }
    | { type: 'image_with_labels', url: string, labels: { id: string; xPercent: number; yPercent: number; text: string }[] }
    | { type: 'animation', urls: string[] };

interface MediaViewerModalProps {
  media: MediaObject | null;
  onClose: () => void;
}

const MediaViewerModal: React.FC<MediaViewerModalProps> = ({ media, onClose }) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLImageElement | HTMLVideoElement>(null);

  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const intervalRef = useRef<number | null>(null);

  const [animationFrames, setAnimationFrames] = useState<string[]>([]);
  const [isAnimationLoading, setIsAnimationLoading] = useState(false);
  const [loadedFrameCount, setLoadedFrameCount] = useState(0);

  useEffect(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setCurrentFrame(0);

    if (media?.type === 'animation') {
      setIsPlaying(false);
      setAnimationFrames([]);
      setLoadedFrameCount(0);
      setIsAnimationLoading(true);

      let cancelled = false;
      const uniqueUrls = Array.from(new Set(media.urls));

      const preloadFrame = (url: string) =>
        new Promise<string | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(url);
          img.onerror = () => resolve(null);
          img.src = url;
        });

      (async () => {
        const results = await Promise.all(
          uniqueUrls.map(async (url) => {
            const loaded = await preloadFrame(url);
            if (loaded && !cancelled) {
              setLoadedFrameCount((prev) => prev + 1);
            }
            return loaded;
          })
        );

        if (cancelled) return;

        const validFrames = results.filter((u): u is string => Boolean(u));
        setAnimationFrames(validFrames);
        setCurrentFrame(0);
        setIsAnimationLoading(false);
        setIsPlaying(validFrames.length > 1);
      })();

      return () => {
        cancelled = true;
      };
    }

    setIsAnimationLoading(false);
    setAnimationFrames([]);
    setLoadedFrameCount(0);
    setIsPlaying(false);
  }, [media]);

  const effectiveAnimationFrames = media?.type === 'animation' ? animationFrames : [];

  useEffect(() => {
    if (media?.type === 'animation' && !isAnimationLoading && isPlaying && effectiveAnimationFrames.length > 0) {
      intervalRef.current = window.setInterval(() => {
        setCurrentFrame((prevFrame) => (prevFrame + 1) % effectiveAnimationFrames.length);
      }, 1000 / 12);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isAnimationLoading, isPlaying, media, effectiveAnimationFrames.length]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const scaleAmount = 0.1;
    setScale(prev => Math.min(Math.max(0.5, prev + (e.deltaY < 0 ? scaleAmount : -scaleAmount)), 5));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startPos = { x: e.clientX - position.x, y: e.clientY - position.y };
    const handleMouseMove = (moveEvent: MouseEvent) => {
      setPosition({ x: moveEvent.clientX - startPos.x, y: moveEvent.clientY - startPos.y });
    };
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handlePlayPause = () => {
    if (!isAnimationLoading) setIsPlaying(prev => !prev);
  };

  const handleStep = (dir: 1 | -1) => {
    setIsPlaying(false);
    if (media?.type === 'animation' && effectiveAnimationFrames.length > 0) {
      setCurrentFrame(prev => (prev + dir + effectiveAnimationFrames.length) % effectiveAnimationFrames.length);
    }
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsPlaying(false);
    setCurrentFrame(Number(e.target.value));
  };

  const handleDownload = useCallback(() => {
    if (media?.type !== 'animation') return;
    const url = effectiveAnimationFrames[currentFrame];
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `solar_frame_${currentFrame + 1}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [media, effectiveAnimationFrames, currentFrame]);

  if (!media) return null;

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-[4000] flex flex-col items-center p-4"
      onClick={onClose}
    >
      <div
        className="absolute top-4 right-4 flex items-center gap-4 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={handleReset} className="px-3 py-1 bg-neutral-800/80 border border-neutral-600 rounded-md text-white hover:bg-neutral-700" title="Reset Zoom & Pan">Reset View</button>
        <button onClick={onClose} className="p-2 bg-neutral-800/80 border border-neutral-600 rounded-full text-white hover:bg-neutral-700" title="Close Viewer"><CloseIcon className="w-6 h-6" /></button>
      </div>

      <div
        ref={containerRef}
        className="w-full flex-1 flex items-center justify-center overflow-hidden pt-12"
        onWheel={handleWheel}
      >
        {media.type === 'image' && (
          <img
            ref={contentRef as React.RefObject<HTMLImageElement>}
            src={media.url}
            alt="Full screen media"
            className="max-w-[95vw] max-h-[78vh] cursor-grab active:cursor-grabbing"
            style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})` }}
            onMouseDown={handleMouseDown}
            onClick={(e) => e.stopPropagation()}
          />
        )}

        {media.type === 'image_with_labels' && (
          <div
            className="relative max-w-[95vw] max-h-[78vh] cursor-grab active:cursor-grabbing"
            style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})` }}
            onMouseDown={handleMouseDown}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              ref={contentRef as React.RefObject<HTMLImageElement>}
              src={media.url}
              alt="Full disk with labels"
              className="max-w-[95vw] max-h-[78vh]"
            />
            <div className="absolute inset-0 pointer-events-none">
              {media.labels.map((label) => (
                <div key={label.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${label.xPercent}%`, top: `${label.yPercent}%` }}>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap bg-black/75 text-sky-200 border border-sky-500/40">
                    {label.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {media.type === 'video' && (
          <div
            className="relative max-w-[95vw] max-h-[78vh] cursor-grab active:cursor-grabbing"
            style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})` }}
            onMouseDown={handleMouseDown}
            onClick={(e) => e.stopPropagation()}
          >
            <video
              ref={contentRef as React.RefObject<HTMLVideoElement>}
              src={media.url}
              autoPlay
              loop
              muted
              playsInline
              className="w-full h-full"
            >
              Your browser does not support the video tag.
            </video>
          </div>
        )}

        {media.type === 'animation' && (
          <div className="w-full h-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            {isAnimationLoading ? (
              <div className="flex flex-col items-center gap-3 text-neutral-200">
                <div className="h-10 w-10 rounded-full border-4 border-sky-400/30 border-t-sky-400 animate-spin" />
                <p className="text-sm">Loading animation frames… ({loadedFrameCount}/{media.urls.length})</p>
              </div>
            ) : effectiveAnimationFrames.length > 0 ? (
              <img
                ref={contentRef as React.RefObject<HTMLImageElement>}
                src={effectiveAnimationFrames[currentFrame]}
                alt={`Animation frame ${currentFrame + 1}`}
                className="max-w-[95vw] max-h-[78vh] cursor-grab active:cursor-grabbing"
                style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})` }}
                onMouseDown={handleMouseDown}
              />
            ) : (
              <p className="text-neutral-300">No animation frames available.</p>
            )}
          </div>
        )}
      </div>

      {media.type === 'animation' && effectiveAnimationFrames.length > 0 && !isAnimationLoading && (
        <div
          className="w-full max-w-5xl bg-neutral-900/80 backdrop-blur-sm p-4 rounded-lg shadow-2xl mt-4 space-y-3"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="range"
            min="0"
            max={effectiveAnimationFrames.length - 1}
            value={currentFrame}
            onChange={handleScrub}
            className="w-full h-2 bg-neutral-700 rounded-lg appearance-none cursor-pointer"
          />
          <div className="flex justify-between items-center">
            <span className="text-xs text-neutral-400">Frame: {currentFrame + 1} / {effectiveAnimationFrames.length}</span>
            <div className="flex items-center gap-3">
              <button onClick={() => handleStep(-1)} className="p-2 bg-neutral-800 rounded-full hover:bg-neutral-700"><PrevIcon className="w-5 h-5"/></button>
              <button onClick={handlePlayPause} className="p-3 bg-sky-600 rounded-full hover:bg-sky-500">{isPlaying ? <PauseIcon className="w-6 h-6"/> : <PlayIcon className="w-6 h-6"/>}</button>
              <button onClick={() => handleStep(1)} className="p-2 bg-neutral-800 rounded-full hover:bg-neutral-700"><NextIcon className="w-5 h-5"/></button>
            </div>
            <button onClick={handleDownload} className="p-2 bg-neutral-800 rounded-full hover:bg-neutral-700" title="Download Current Frame"><DownloadIcon className="w-6 h-6" /></button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MediaViewerModal;
