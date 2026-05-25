/// <reference types="vite/client" />

declare module 'date-fns' {
  export function format(date: Date, formatStr: string): string
  export function startOfWeek(date: Date, options?: { weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6 }): Date
  export function addDays(date: Date, amount: number): Date
  export function isToday(date: Date): boolean
}

