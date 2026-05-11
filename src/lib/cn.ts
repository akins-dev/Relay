import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes safely — resolves conflicts correctly.
 * e.g. cn('px-4', 'px-6') → 'px-6'  (not 'px-4 px-6')
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
