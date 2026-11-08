import animate from 'tailwindcss-animate'

const hsl = (v) => `hsl(var(--${v}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: hsl('border'),
        input: hsl('input'),
        ring: hsl('ring'),
        background: hsl('background'),
        foreground: hsl('foreground'),
        surface: hsl('surface'),
        subtle: hsl('subtle-foreground'),
        primary: { DEFAULT: hsl('primary'), hover: hsl('primary-hover'), foreground: hsl('primary-foreground'), soft: hsl('primary-soft') },
        secondary: { DEFAULT: hsl('secondary'), foreground: hsl('secondary-foreground') },
        destructive: { DEFAULT: hsl('destructive'), foreground: hsl('destructive-foreground') },
        muted: { DEFAULT: hsl('muted'), foreground: hsl('muted-foreground') },
        accent: { DEFAULT: hsl('accent'), foreground: hsl('accent-foreground') },
        card: { DEFAULT: hsl('card'), foreground: hsl('card-foreground') },
        success: { DEFAULT: hsl('success'), soft: hsl('success-soft') },
        warning: { DEFAULT: hsl('warning'), soft: hsl('warning-soft') },
        danger: { DEFAULT: hsl('danger'), soft: hsl('danger-soft') },
        info: { DEFAULT: hsl('info'), soft: hsl('info-soft') },
      },
      // Thang chữ cho app dày dữ liệu: tối thiểu 12px, thân bài 14px
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }],          // 12/16 – chú thích, nhãn
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],     // 13/20 – nội dung panel
        base: ['0.875rem', { lineHeight: '1.375rem' }],   // 14/22 – thân bài
        lg: ['1rem', { lineHeight: '1.5rem' }],           // 16/24 – tiêu đề nhỏ
        xl: ['1.125rem', { lineHeight: '1.75rem' }],      // 18/28 – tiêu đề trang
        '2xl': ['1.375rem', { lineHeight: '1.875rem' }],  // 22/30 – số KPI
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      boxShadow: {
        e1: '0 1px 2px 0 rgb(15 23 42 / 0.06)',
        e2: '0 4px 12px -2px rgb(15 23 42 / 0.10), 0 2px 4px -2px rgb(15 23 42 / 0.06)',
        e3: '0 20px 40px -12px rgb(15 23 42 / 0.25)',
      },
      keyframes: { 'fade-in': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } } },
      animation: { 'fade-in': 'fade-in 150ms ease-out' },
    },
  },
  plugins: [animate],
}
