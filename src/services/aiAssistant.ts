export interface LocalAIStatus {
  isAvailable: boolean;
  models: string[];
  activeModel: string;
  latencyMs?: number;
  endpoint: string;
  version?: string;
  warning?: string;
  error?: string;
}

const STORAGE_ENDPOINT_KEY = 'novapdfpro_local_ai_endpoint';
const STORAGE_MODEL_KEY = 'novapdfpro_local_ai_model';
const DEFAULT_ENDPOINT = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3';

export class LocalAIAssistantService {
  private endpoint: string;
  private defaultModel: string;
  private lastStatus: LocalAIStatus | null = null;

  constructor() {
    this.endpoint = this.loadSavedEndpoint();
    this.defaultModel = this.loadSavedModel();
  }

  private loadSavedEndpoint(): string {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const saved = window.localStorage.getItem(STORAGE_ENDPOINT_KEY);
        if (saved && saved.trim()) return saved.trim();
      } catch {
        // LocalStorage fallback
      }
    }
    return DEFAULT_ENDPOINT;
  }

  private loadSavedModel(): string {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const saved = window.localStorage.getItem(STORAGE_MODEL_KEY);
        if (saved && saved.trim()) return saved.trim();
      } catch {
        // LocalStorage fallback
      }
    }
    return DEFAULT_MODEL;
  }

  public getEndpoint(): string {
    return this.endpoint;
  }

  public setEndpoint(endpoint: string) {
    this.endpoint = endpoint.trim() || DEFAULT_ENDPOINT;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(STORAGE_ENDPOINT_KEY, this.endpoint);
      } catch {
        // Ignore
      }
    }
  }

  public getDefaultModel(): string {
    return this.defaultModel;
  }

  public setDefaultModel(model: string) {
    this.defaultModel = model.trim() || DEFAULT_MODEL;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(STORAGE_MODEL_KEY, this.defaultModel);
      } catch {
        // Ignore
      }
    }
  }

  public saveConfig(endpoint: string, model: string) {
    this.setEndpoint(endpoint);
    this.setDefaultModel(model);
  }

  public getLastStatus(): LocalAIStatus | null {
    return this.lastStatus;
  }

  /**
   * Check if local Ollama daemon or compatible local AI endpoint is active
   */
  public async checkStatus(targetEndpoint?: string): Promise<LocalAIStatus> {
    const endpointToUse = targetEndpoint || this.endpoint;

    if (typeof window !== 'undefined' && window.electronAPI?.checkOllama) {
      try {
        const res = await window.electronAPI.checkOllama(endpointToUse);
        const models: string[] = res.models || [];
        const isAvail = Boolean(res.available);

        // Pick model: if saved model is in list, keep it; else first model or default
        let activeModel = this.defaultModel;
        if (models.length > 0) {
          const match = models.find((m) => m === this.defaultModel || m.startsWith(`${this.defaultModel}:`));
          activeModel = match || models[0];
        }

        const status: LocalAIStatus = {
          isAvailable: isAvail,
          models,
          activeModel,
          latencyMs: res.latencyMs,
          endpoint: endpointToUse,
          version: res.version,
          warning: res.warning,
          error: res.error,
        };

        this.lastStatus = status;
        return status;
      } catch (err: any) {
        const status: LocalAIStatus = {
          isAvailable: false,
          models: [],
          activeModel: this.defaultModel,
          endpoint: endpointToUse,
          error: err.message,
        };
        this.lastStatus = status;
        return status;
      }
    }

    // Direct fetch fallback (browser development)
    const startTime = Date.now();
    try {
      const res = await fetch(`${endpointToUse}/api/tags`, { method: 'GET' });
      const latencyMs = Date.now() - startTime;
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
      const data = await res.json();
      const models = data.models?.map((m: any) => m.name || m) || [];
      const match = models.find((m: string) => m === this.defaultModel || m.startsWith(`${this.defaultModel}:`));
      const activeModel = match || models[0] || this.defaultModel;

      const status: LocalAIStatus = {
        isAvailable: true,
        models,
        activeModel,
        latencyMs,
        endpoint: endpointToUse,
      };
      this.lastStatus = status;
      return status;
    } catch (err: any) {
      const status: LocalAIStatus = {
        isAvailable: false,
        models: [],
        activeModel: this.defaultModel,
        endpoint: endpointToUse,
        error: `Cannot connect to ${endpointToUse}: ${err.message}`,
      };
      this.lastStatus = status;
      return status;
    }
  }

  /**
   * Explicitly test connection to the local AI service
   */
  public async testConnection(endpoint?: string): Promise<LocalAIStatus> {
    const status = await this.checkStatus(endpoint);
    if (status.isAvailable) {
      if (endpoint) this.setEndpoint(endpoint);
      if (status.activeModel) this.setDefaultModel(status.activeModel);
    }
    return status;
  }

  /**
   * Ask a question or request a summary using local LLM
   */
  public async queryDocument(
    documentText: string,
    prompt: string,
    model?: string
  ): Promise<string> {
    const targetModel = model || this.defaultModel;
    const truncatedText = documentText.slice(0, 18000); // Safe context window limit

    const systemPrompt = `You are NovaPDFPro's Offline AI Document Assistant. You analyze the user's PDF document completely locally on their computer with 100% privacy and zero cloud access. Be concise, professional, and highlight key terms, numbers, dates, and insights.`;

    const fullPrompt = `Document Context:
\"\"\"
${truncatedText}
\"\"\"

User Request: ${prompt}`;

    if (typeof window !== 'undefined' && window.electronAPI?.generateOllama) {
      const res = await window.electronAPI.generateOllama({
        endpoint: this.endpoint,
        model: targetModel,
        prompt: fullPrompt,
        systemPrompt,
      });

      if (!res.success) {
        throw new Error(res.error || 'Failed to query local AI model');
      }
      return res.response || 'No response generated.';
    }

    // Direct HTTP fetch fallback
    const response = await fetch(`${this.endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: targetModel,
        prompt: fullPrompt,
        system: systemPrompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      let errorMsg = `HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(text);
        if (parsed.error) errorMsg = parsed.error;
      } catch {
        // Ignore
      }
      throw new Error(`Local AI query failed: ${errorMsg}`);
    }

    const data = await response.json();
    return data.response || 'No output generated.';
  }

  /**
   * Built-in local prompt shortcuts
   */
  public async summarizeDocument(documentText: string, model?: string): Promise<string> {
    return this.queryDocument(
      documentText,
      'Provide an executive summary of this document, including main objective, key parties involved, dates, and financial amounts if any.',
      model
    );
  }

  public async extractKeyDates(documentText: string, model?: string): Promise<string> {
    return this.queryDocument(
      documentText,
      'List all critical dates, milestones, deadlines, and timeframes mentioned in this document in chronological order.',
      model
    );
  }

  public async auditContractObligations(documentText: string, model?: string): Promise<string> {
    return this.queryDocument(
      documentText,
      'Analyze the legal obligations, payment terms, confidentiality clauses, and liability limits in this contract.',
      model
    );
  }
}

export const aiAssistant = new LocalAIAssistantService();
