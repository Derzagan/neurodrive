import { defineConfig } from "vite";

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: {
        main: "index.html",
        registrationTest: "intitled-1.html",
      },
      output: {
        manualChunks: {
          three: ["three"],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
