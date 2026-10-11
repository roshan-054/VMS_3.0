import React, { useState } from 'react';
import { getDirectImageUrl, extractDriveFileId } from '../lib/branding';
import { ShoppingBag, ExternalLink } from 'lucide-react';

interface SmartProductImageProps {
  src?: string;
  alt?: string;
  className?: string;
  fallbackClassName?: string;
}

export const SmartProductImage: React.FC<SmartProductImageProps> = ({
  src,
  alt = 'Product',
  className = 'w-12 h-12 rounded-xl object-contain bg-white border border-slate-200 p-1',
  fallbackClassName
}) => {
  const [errorStage, setErrorStage] = useState<number>(0);

  if (!src || !src.trim()) {
    return (
      <div className={fallbackClassName || className.replace('object-contain', '').replace('bg-white', 'bg-slate-100') + ' flex items-center justify-center'}>
        <ShoppingBag className="w-1/2 h-1/2 text-slate-400" />
      </div>
    );
  }

  const raw = src.trim();
  const driveId = extractDriveFileId(raw);

  // Determine current image URL based on fallback retry stage
  let currentSrc = getDirectImageUrl(raw);
  if (errorStage === 1 && driveId) {
    currentSrc = `https://drive.google.com/thumbnail?id=${driveId}&sz=w1000`;
  } else if (errorStage === 2 && driveId) {
    currentSrc = `https://drive.google.com/uc?export=view&id=${driveId}`;
  }

  if (errorStage >= 3) {
    return (
      <div className={fallbackClassName || className + ' overflow-hidden flex items-center justify-center p-0.5'} title="Private or expired Drive link. Click to open in Drive.">
        <a
          href={raw}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full h-full flex flex-col items-center justify-center bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg p-0.5 text-[9px] text-center border border-amber-200 transition font-bold"
        >
          <ExternalLink className="w-3 h-3 mb-0.5 shrink-0" />
          <span className="line-clamp-1">Open Drive</span>
        </a>
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      onError={() => {
        setErrorStage((prev) => prev + 1);
      }}
    />
  );
};
