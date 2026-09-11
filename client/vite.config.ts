import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // shared 目录可能残留 tsc 生成的同名 .js；开发与构建必须以当前 TypeScript 源码为准，
  // 否则会出现“UI 已支持新公式、运行时却仍加载旧公式引擎”的版本错配。
  resolve: {
    extensions: ['.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx', '.json'],
  },
  server: {
    // 允许任意 Host 访问 dev server（如通过局域网 IP 访问，否则被 Vite 默认 host 校验拦截）
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
