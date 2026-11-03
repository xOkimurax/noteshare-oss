import React, { useRef, useEffect, useState } from 'react';
import { Camera, X, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { useBackable } from '../hooks/useBackable';

interface CameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}

export default function CameraModal({ isOpen, onClose, onCapture }: CameraModalProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const startCamera = async () => {
        try {
          // Try environment camera first
          let stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).catch(() => null);
          
          if (!stream) {
            // Fallback to any camera
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
          }

          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play();
          }
        } catch (err) {
          console.error('Error accessing camera:', err);
          setError(t('camera_error') || 'No se pudo acceder a la cámara. Revisa los permisos.');
        }
      };
      startCamera();
    } else {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      setError(null);
    }
    
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [isOpen, t]);

  const handleCapture = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        canvas.toBlob(blob => {
          if (blob) {
            const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
            onCapture(file);
            onClose();
          }
        }, 'image/jpeg', 0.8);
      }
    }
  };

  useBackable(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl h-[80vh] flex flex-col p-4">
        <button 
          onClick={onClose}
          className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white z-10 transition-colors"
        >
          <X className="w-6 h-6" />
        </button>
        
        <div className="flex-1 w-full h-full flex items-center justify-center bg-black rounded-3xl overflow-hidden relative border border-white/10 shadow-2xl">
          {error ? (
            <div className="text-white text-center p-6">
              <Camera className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{error}</p>
            </div>
          ) : (
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className="w-full h-full object-cover"
            />
          )}
        </div>
        
        <div className="mt-8 flex justify-center pb-8">
          <button 
            onClick={handleCapture}
            disabled={!!error}
            className="w-20 h-20 bg-white rounded-full border-4 border-emerald-500 flex items-center justify-center hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:hover:scale-100"
          >
            <div className="w-16 h-16 rounded-full border-2 border-stone-200"></div>
          </button>
        </div>
      </div>
    </div>
  );
}
