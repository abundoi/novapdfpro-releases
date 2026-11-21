import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalAIAssistantService } from '../src/services/aiAssistant.ts';

test('Local AI Assistant: Default settings & persistent configuration', () => {
  const service = new LocalAIAssistantService();
  assert.equal(service.getEndpoint(), 'http://localhost:11434');
  assert.equal(service.getDefaultModel(), 'llama3');

  service.saveConfig('http://127.0.0.1:1234', 'mistral');
  assert.equal(service.getEndpoint(), 'http://127.0.0.1:1234');
  assert.equal(service.getDefaultModel(), 'mistral');

  // Reset back to standard
  service.saveConfig('http://localhost:11434', 'llama3');
});

test('Local AI Assistant: Connection failure handling when service is offline', async () => {
  // Mock offline Electron API
  globalThis.window = {
    electronAPI: {
      checkOllama: async (endpoint) => ({
        available: false,
        models: [],
        endpoint,
        error: `Could not connect to ${endpoint} (ECONNREFUSED). Please ensure Ollama is installed and running.`,
      }),
      generateOllama: async () => ({ success: false, error: 'Ollama offline' }),
    },
  };

  const service = new LocalAIAssistantService();
  const status = await service.checkStatus('http://localhost:11434');
  assert.equal(status.isAvailable, false);
  assert.equal(status.models.length, 0);
  assert.match(status.error, /ECONNREFUSED/);
});

test('Local AI Assistant: Successful connection, model discovery & latency measurement', async () => {
  let capturedPayload = null;

  // Mock active Electron Ollama API
  globalThis.window = {
    electronAPI: {
      checkOllama: async (endpoint) => ({
        available: true,
        models: ['llama3:latest', 'phi3:latest', 'mistral:latest'],
        latencyMs: 12,
        version: '0.3.14',
        endpoint,
      }),
      generateOllama: async (payload) => {
        capturedPayload = payload;
        return {
          success: true,
          response: 'Executive Summary: The agreement was successfully verified by local AI with 100% privacy.',
        };
      },
    },
  };

  const service = new LocalAIAssistantService();
  const status = await service.testConnection('http://localhost:11434');

  assert.equal(status.isAvailable, true, 'Mock server must report available');
  assert.equal(status.models.length, 3, 'Must discover 3 models');
  assert.ok(status.models.includes('llama3:latest'));
  assert.ok(status.models.includes('phi3:latest'));
  assert.equal(status.latencyMs, 12, 'Latency must be tracked');
  assert.equal(status.activeModel, 'llama3:latest');

  // Test query execution with document context
  const sampleDoc = 'CONFIDENTIAL MERGER BETWEEN ACME CORP AND GLOBAL TECH. EFFECTIVE 14 NOV 2026.';
  const response = await service.queryDocument(sampleDoc, 'Provide an executive summary of this document');

  assert.equal(
    response,
    'Executive Summary: The agreement was successfully verified by local AI with 100% privacy.'
  );

  assert.ok(capturedPayload, 'Payload must be passed to electron API');
  assert.equal(capturedPayload.endpoint, 'http://localhost:11434');
  assert.equal(capturedPayload.model, 'llama3:latest');
  assert.ok(capturedPayload.prompt.includes('CONFIDENTIAL MERGER'), 'Document context must be included in prompt');
  assert.ok(
    capturedPayload.systemPrompt.includes('100% privacy'),
    'Privacy system prompt must be included'
  );
});
