import { DEFAULT_OLLAMA_URL } from "./ollama";

export const DEFAULT_SETTINGS = {
  ollamaUrl: DEFAULT_OLLAMA_URL,
  lastModel: "",
  defaultSystemPrompt: "You are a helpful AI assistant.",
  defaultTemperature: 0.7,
  numCtx: 8192, // Ollama's own default is much smaller and silently truncates long prompts
  agentMaxSteps: 10,
  searxUrl: "", // optional SearXNG instance for web_search, e.g. http://localhost:8080
  sdUrl: "http://127.0.0.1:7860", // Stable Diffusion WebUI (AUTOMATIC1111 / Forge) for Imagine AI
  reviewSwarmPlan: true, // pause for approval before generated tools run
};
