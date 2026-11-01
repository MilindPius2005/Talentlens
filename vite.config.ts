import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const isGitHubPages = mode === "github-pages";
  const isVercelDeployment = mode === "vercel";
  if (isGitHubPages) {
    const { VITE_API_BASE } = loadEnv(mode, ".", "VITE_");
    let apiUrl: URL;
    try {
      apiUrl = new URL(VITE_API_BASE);
    } catch {
      throw new Error("Set VITE_API_BASE to your deployed backend HTTPS URL before building for GitHub Pages.");
    }
    if (apiUrl.protocol !== "https:" || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
      throw new Error("VITE_API_BASE must be an HTTPS backend URL without credentials, query parameters, or a fragment.");
    }
  }

  return {
    base: isGitHubPages ? "/Talentlens/" : "/",
    define: isVercelDeployment ? { "import.meta.env.VITE_API_BASE": JSON.stringify("/api") } : {},
    plugins: [react()],
    server: {
      port: 5173,
      proxy: isVercelDeployment ? undefined : {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, '')
        }
      }
    },
  };
});
