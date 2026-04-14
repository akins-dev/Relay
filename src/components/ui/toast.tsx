'use client';
// Minimal toast — swap with sonner if preferred
import * as React from 'react';
import { cn } from '@/lib/cn';

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  onClose: () => void;
}

export function Toast({ message, type = 'info', onClose }: ToastProps) {
  React.useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className={cn(
      'fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg animate-fade-in',
      type === 'success' && 'border-green-200 bg-green-50 text-green-800',
      type === 'error'   && 'border-red-200 bg-red-50 text-red-800',
      type === 'info'    && 'border-border bg-card text-foreground',
    )}>
      <span>{message}</span>
      <button onClick={onClose} className="ml-2 opacity-50 hover:opacity-100">×</button>
    </div>
  );
}
