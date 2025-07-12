import React, { useState, useRef, useEffect } from 'react';
import CloseIcon from './icons/CloseIcon';

interface MediaViewerModalProps {
  mediaUrl: string | null;
  mediaType: 'image' | 'video' | null;
  onClose: () => void;
}

const MediaViewerModal: React.FC<MediaViewerModalProps> = ({ mediaUrl, mediaType, onClose }) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLImageElement | HTMLVideoElement>(null);

  useEffect(() => {
    // Reset zoom and pan when a new media item is opened
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, [mediaUrl]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const scaleAmount = 0.1;
    let newScale = scale;
    if (e.deltaY < 0) {
      newScale = scale + scaleAmount; // Zoom in
    } else {
      newScale = scale - scaleAmount; // Zoom out
    }
    // CRITICAL FIX: Removed extra parenthesis
    setScale(Math.min(Math.max(0.5, newScale), 5)); // Clamp scale between 0.5x and 5x
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startPos = { x: e.clientX - position.x, y: e.clientY - position.y };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      setPosition({
        x: moveEvent.clientX - startPos.x,
        y: moveEvent.clientY - startPos.y,
      });
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


  if (!mediaUrl || !mediaType) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex flex-col justify-center items-center"
      onClick={onClose}
    >
        {/* Controls */}
        <div className="absolute top-4 right-4 flex items-center gap-4 z-10">
            <button
                onClick={handleReset}
                className="px-3 py-1 bg-neutral-800/80 border border-neutral-600 rounded-md text-white hover:bg-neutral-700"
                title="Reset Zoom & Pan"
            >
                Reset View
            </button>
            <button 
                onClick={onClose} 
                className="p-2 bg-neutral-800/80 border border-neutral-600 rounded-full text-white hover:bg-neutral-700"
                title="Close Viewer"
            >
                <CloseIcon className="w-6 h-6" />
            </button>
        </div>

        {/* Media Container */}
        <div 
            ref={containerRef}
            className="w-full h-full flex items-center justify-center overflow-hidden"
            onWheel={handleWheel}
        >
            {mediaType === 'image' && (
                <img
                    ref={contentRef as React.RefObject<HTMLImageElement>}
                    src={mediaUrl}
                    alt="Full screen media"
                    className="max-w-[95vw] max-h-[95vh] cursor-grab active:cursor-grabbing"
                    style={{
                        transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                        transition: 'transform 0.1s ease-out',
                    }}
                    onMouseDown={handleMouseDown}
                    onClick={(e) => e.stopPropagation()} // Prevent modal from closing when clicking image
                />
            )}
            {mediaType === 'video' && (
                <video
                    ref={contentRef as React.RefObject<HTMLVideoElement>}
                    src={mediaUrl}
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="max-w-[95vw] max-h-[95vh] cursor-grab active:cursor-grabbing"
                    style={{
                        transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                        transition: 'transform 0.1s ease-out',
                    }}
                    onMouseDown={handleMouseDown}
                    onClick={(e) => e.stopPropagation()} // Prevent modal from closing when clicking video
                >
                    Your browser does not support the video tag.
                </video>
            )}
        </div>
    </div>
  );
};

export default MediaViewerModal;