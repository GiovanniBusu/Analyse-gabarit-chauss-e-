import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built dist/ works both at a domain root and at a
  // GitHub Pages project subpath (https://user.github.io/repo/) without
  // hardcoding the repo name here — matches IFC2CLOUD's own approach.
  // Runtime code resolves absolute URLs (e.g. the web-ifc wasm path) via
  // document.baseURI instead of import.meta.env.BASE_URL for the same reason.
  base: './',
  plugins: [react()],
})
