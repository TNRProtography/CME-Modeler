import React, { useState, useRef, useEffect, useCallback } from 'react';
import CloseIcon from './icons/CloseIcon';
import PlayIcon from './icons/PlayIcon';
import PauseIcon from './icons/PauseIcon';
import NextIcon from './icons/NextIcon';
import PrevIcon from './icons/PrevIcon';

// A simple Download Icon component to be used locally
const DownloadIcon: React.FC<{className?: string}> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
);

// Define the types of media the viewer can handle
type MediaObject = 
    | { type: 'image', url: string }
    | { type: 'video', url: string }
    | { type: 'animation', urls: string[] };

interface MediaViewerModalProps {
  media: MediaObject | null;
  onClose: () => void;
}

const MediaViewerModal: React.FC<MediaViewerModalProps> = ({ media, onClose }) => {
  // --- Generic Viewer State (Zoom/Pan) ---
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLImageElement | HTMLVideoElement>(null);

  // --- Animation-Specific State ---
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const intervalRef = useRef<number | null>(null);

  // --- Reset state when new media is opened ---
  useEffect(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setCurrentFrame(0);
    // Autoplay animations as soon as they are opened
    setIsPlaying(media?.type === 'animation');
  }, [media]);

  // --- Animation Playback Logic ---
  useEffect(() => {
    if (media?.type === 'animation' && isPlaying && media.urls.length > 0) {
      intervalRef.current = window.setInterval(() => {
        setCurrentFrame((prevFrame) => (prevFrame + 1) % (media.urls.length));
      }, 1000 / 12); // 12 FPS
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, media]);


  // --- Event Handlers ---
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
  
  const handlePlayPause = () => setIsPlaying(prev => !prev);
  const handleStep = (dir: 1 | -1) => {
    setIsPlaying(false);
    if(media?.type === 'animation') {
      setCurrentFrame(prev => (prev + dir + media.urls.length) % media.urls.length);
    }
  };
  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsPlaying(false);
    setCurrentFrame(Number(e.target.value));
  };

  const handleDownload = useCallback(() => {
    if (media?.type !== 'animation') return;
    const url = media.urls[currentFrame];
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `enlil_frame_${currentFrame + 1}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [media, currentFrame]);

  if (!media) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-[4000] flex flex-col justify-center items-center"
      onClick={onClose}
    >
        {/* Top Controls */}
        <div 
            className="absolute top-4 right-4 flex items-center gap-4 z-10"
            onClick={(e) => e.stopPropagation()} // Stop click from closing the modal
        >
            <button onClick={handleReset} className="px-3 py-1 bg-neutral-800/80 border border-neutral-600 rounded-md text-white hover:bg-neutral-700" title="Reset Zoom & Pan">Reset View</button>
            <button onClick={onClose} className="p-2 bg-neutral-800/80 border border-neutral-600 rounded-full text-white hover:bg-neutral-700" title="Close Viewer"><CloseIcon className="w-6 h-6" /></button>
        </div>

        {/* Media Container */}
        <div ref={containerRef} className="w-full h-full flex items-center justify-center overflow-hidden" onWheel={handleWheel}>
            {media.type === 'image' && (
                <img ref={contentRef as React.RefObject<HTMLImageElement>} src={media.url} alt="Full screen media" className="max-w-[95vw] max-h-[95vh] cursor-grab active:cursor-grabbing" style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})` }} onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} />
            )}
            
            {media.type === 'video' && (
                // This wrapper div now handles all interactions (panning, zooming) by acting as a transparent overlay.
                <div
                    className="relative max-w-[95vw] max-h-[95vh] cursor-grab active:cursor-grabbing"
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
                        // The video now has no interactive classes or direct event handlers.
                        // It simply fills its parent container, allowing the parent to handle events.
                        className="w-full h-full"
                    >
                        Your browser does not support the video tag.
                    </video>
                </div>
            )}
            
            {media.type === 'animation' && media.urls.length > 0 && (
                <img ref={contentRef as React.RefObject<HTMLImageElement>} src={media.urls[currentFrame]} alt={`Animation frame ${currentFrame + 1}`} className="max-w-[90vw] max-h-[80vh] cursor-grab active:cursor-grabbing" style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})` }} onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} />
            )}
        </div>

        {/* Bottom Controls for Animation */}
        {media.type === 'animation' && media.urls.length > 0 && (
            <div 
                className="absolute bottom-5 w-11/12 max-w-xl bg-neutral-900/80 backdrop-blur-sm p-4 rounded-lg shadow-2xl z-10 space-y-3"
                onClick={(e) => e.stopPropagation()}
            >
                 <input type="range" min="0" max={media.urls.length - 1} value={currentFrame} onChange={handleScrub} className="w-full h-2 bg-neutral-700 rounded-lg appearance-none cursor-pointer" />
                 <div className="flex justify-between items-center">
                    <span className="text-xs text-neutral-400">Frame: {currentFrame + 1} / {media.urls.length}</span>
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