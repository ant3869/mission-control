/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        base: '#0b0b0d',
        surface: '#0f0f12',
        card: '#141417',
        'card-hover': '#1a1a1e',
        border: '#1e1e24',
        'border-subtle': '#17171c',
        'text-primary': '#e4e4e8',
        'text-secondary': '#7a7a8a',
        'text-muted': '#4a4a58',
        'accent-green': '#4ade80',
        'accent-amber': '#fbbf24',
        'accent-red': '#f87171',
        'accent-blue': '#60a5fa',
        'accent-purple': '#a78bfa',
        'accent-teal': '#2dd4bf',
      },
      borderRadius: {
        DEFAULT: '6px',
        sm: '4px',
        lg: '8px',
        xl: '12px',
      },
    },
  },
  plugins: [],
}
