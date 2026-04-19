import { describe, expect, it } from 'vitest';

import {
  formatProviderStatusText,
  getProviderConnectionModeSummary,
  getProviderCredentialSummary,
  getProviderCurrentRuntimeSummary,
  isConnectionManagedRuntimeProvider,
} from '@renderer/components/runtime/providerConnectionUi';
import { createDefaultCliExtensionCapabilities } from '@shared/utils/providerExtensionCapabilities';

import type { CliProviderStatus } from '@shared/types';

function createAnthropicProvider(
  overrides?: Partial<CliProviderStatus['connection']> & {
    authenticated?: boolean;
    authMethod?: string | null;
  }
): CliProviderStatus {
  return {
    providerId: 'anthropic',
    displayName: 'Anthropic',
    supported: true,
    authenticated: overrides?.authenticated ?? true,
    authMethod: overrides?.authMethod ?? 'oauth_token',
    verificationState: 'verified',
    statusMessage: 'Connected',
    models: ['claude-sonnet-4-6'],
    canLoginFromUi: true,
    capabilities: {
      teamLaunch: true,
      oneShot: true,
      extensions: createDefaultCliExtensionCapabilities(),
    },
    selectedBackendId: null,
    resolvedBackendId: null,
    availableBackends: [],
    externalRuntimeDiagnostics: [],
    backend: null,
    connection: {
      supportsOAuth: true,
      supportsApiKey: true,
      configurableAuthModes: ['auto', 'oauth', 'api_key'],
      configuredAuthMode: overrides?.configuredAuthMode ?? 'auto',
      apiKeyConfigured: overrides?.apiKeyConfigured ?? false,
      apiKeySource: overrides?.apiKeySource ?? null,
      apiKeySourceLabel: overrides?.apiKeySourceLabel ?? null,
    },
  };
}

function createCodexProvider(
  overrides?: Partial<CliProviderStatus['connection']> & {
    authenticated?: boolean;
    authMethod?: string | null;
    selectedBackendId?: string | null;
    resolvedBackendId?: string | null;
    availableBackends?: CliProviderStatus['availableBackends'];
    backend?: CliProviderStatus['backend'];
  }
): CliProviderStatus {
  return {
    providerId: 'codex',
    displayName: 'Codex',
    supported: true,
    authenticated: overrides?.authenticated ?? true,
    authMethod: overrides?.authMethod ?? 'oauth_token',
    verificationState: 'verified',
    statusMessage: 'Connected',
    models: ['gpt-5-codex'],
    canLoginFromUi: true,
    capabilities: {
      teamLaunch: true,
      oneShot: true,
      extensions: createDefaultCliExtensionCapabilities(),
    },
    selectedBackendId: overrides?.selectedBackendId ?? 'auto',
    resolvedBackendId: overrides?.resolvedBackendId ?? 'adapter',
    availableBackends: overrides?.availableBackends ?? [],
    externalRuntimeDiagnostics: [],
    backend:
      overrides?.backend ??
      ({
        kind: 'adapter',
        label: 'Codex subscription',
      } satisfies NonNullable<CliProviderStatus['backend']>),
    connection: {
      supportsOAuth: true,
      supportsApiKey: true,
      configurableAuthModes: ['oauth', 'api_key'],
      configuredAuthMode: overrides?.configuredAuthMode ?? 'oauth',
      apiKeyBetaAvailable: true,
      apiKeyBetaEnabled: overrides?.apiKeyBetaEnabled ?? true,
      apiKeyConfigured: overrides?.apiKeyConfigured ?? false,
      apiKeySource: overrides?.apiKeySource ?? null,
      apiKeySourceLabel: overrides?.apiKeySourceLabel ?? null,
    },
  };
}

describe('providerConnectionUi', () => {
  it('hides Anthropic preferred auth summary once the provider is already authenticated', () => {
    const provider = createAnthropicProvider({
      authenticated: true,
      authMethod: 'api_key',
      configuredAuthMode: 'api_key',
      apiKeyConfigured: true,
      apiKeySource: 'stored',
      apiKeySourceLabel: 'Stored in app',
    });

    expect(getProviderConnectionModeSummary(provider)).toBeNull();
  });

  it('shows Anthropic preferred auth summary when a pinned mode is selected but not connected', () => {
    const provider = createAnthropicProvider({
      authenticated: false,
      authMethod: null,
      configuredAuthMode: 'oauth',
    });

    expect(getProviderConnectionModeSummary(provider)).toBe(
      'Preferred auth: Anthropic subscription'
    );
  });

  it('prefers the actual Codex runtime once the provider is already authenticated', () => {
    const provider = createCodexProvider({
      authenticated: true,
      authMethod: 'oauth_token',
      configuredAuthMode: 'api_key',
      apiKeyConfigured: true,
      apiKeySource: 'stored',
      apiKeySourceLabel: 'Stored in app',
    });

    expect(getProviderCurrentRuntimeSummary(provider)).toBe(
      'Current runtime: Codex subscription'
    );
  });

  it('shows the selected Codex runtime when the provider is not authenticated yet', () => {
    const provider = createCodexProvider({
      authenticated: false,
      authMethod: null,
      configuredAuthMode: 'api_key',
      apiKeyConfigured: true,
      apiKeySource: 'stored',
      apiKeySourceLabel: 'Stored in app',
    });

    expect(getProviderCurrentRuntimeSummary(provider)).toBe('Selected runtime: OpenAI API key');
  });

  it('reports an environment Anthropic API key without claiming it is stored in Manage', () => {
    const provider = createAnthropicProvider({
      authenticated: true,
      authMethod: 'oauth_token',
      configuredAuthMode: 'oauth',
      apiKeyConfigured: true,
      apiKeySource: 'environment',
      apiKeySourceLabel: 'Detected from ANTHROPIC_API_KEY',
    });

    expect(getProviderCredentialSummary(provider)).toBe('Detected from ANTHROPIC_API_KEY');
  });

  it('reports an environment Codex API key without claiming it is stored in Manage', () => {
    const provider = createCodexProvider({
      authenticated: true,
      authMethod: 'oauth_token',
      configuredAuthMode: 'oauth',
      apiKeyConfigured: true,
      apiKeySource: 'environment',
      apiKeySourceLabel: 'Detected from OPENAI_API_KEY',
    });

    expect(getProviderCredentialSummary(provider)).toBe('Detected from OPENAI_API_KEY');
  });

  it('tells the user when a stored Codex key exists but API key mode is still disabled', () => {
    const provider = createCodexProvider({
      authenticated: true,
      authMethod: 'oauth_token',
      configuredAuthMode: 'oauth',
      apiKeyBetaEnabled: false,
      apiKeyConfigured: true,
      apiKeySource: 'stored',
      apiKeySourceLabel: 'Stored in app',
    });

    expect(getProviderCredentialSummary(provider)).toBe(
      'OpenAI API key is saved in Manage. Enable API key mode to use it.'
    );
  });

  it('treats Codex as lane-managed once explicit backend options exist', () => {
    const provider = createCodexProvider({
      availableBackends: [
        {
          id: 'auto',
          label: 'Auto',
          description: 'Automatically choose the best backend.',
          selectable: true,
          recommended: true,
          available: true,
        },
        {
          id: 'codex-native',
          label: 'Codex native',
          description: 'Use codex exec JSON mode.',
          selectable: true,
          recommended: false,
          available: true,
        },
      ],
      selectedBackendId: 'codex-native',
      resolvedBackendId: 'codex-native',
      backend: {
        kind: 'codex-native',
        label: 'Codex native',
      },
    });

    expect(isConnectionManagedRuntimeProvider(provider)).toBe(false);
    expect(getProviderCurrentRuntimeSummary(provider)).toBeNull();
  });

  it('does not tell the user to enable API key mode when codex-native is already selected', () => {
    const provider = createCodexProvider({
      apiKeyBetaEnabled: false,
      configuredAuthMode: 'api_key',
      apiKeyConfigured: true,
      apiKeySource: 'stored',
      apiKeySourceLabel: 'Stored in app',
      selectedBackendId: 'codex-native',
      resolvedBackendId: 'codex-native',
      availableBackends: [
        {
          id: 'codex-native',
          label: 'Codex native',
          description: 'Use codex exec JSON mode.',
          selectable: true,
          recommended: false,
          available: true,
        },
      ],
      backend: {
        kind: 'codex-native',
        label: 'Codex native',
      },
    });

    expect(getProviderCredentialSummary(provider)).toBe('Saved API key available in Manage');
  });

  it('keeps locked codex-native lanes visible instead of flattening them to connected-via-api-key', () => {
    const provider = createCodexProvider({
      authenticated: true,
      authMethod: 'api_key',
      statusMessage: 'Codex native runtime ready',
      selectedBackendId: 'codex-native',
      resolvedBackendId: 'codex-native',
      availableBackends: [
        {
          id: 'codex-native',
          label: 'Codex native',
          description: 'Use codex exec JSON mode.',
          selectable: false,
          recommended: false,
          available: true,
          state: 'locked',
          audience: 'internal',
          statusMessage: 'Ready but locked',
          detailMessage: 'Internal rollout only.',
        },
      ],
      backend: {
        kind: 'codex-native',
        label: 'Codex native',
      },
    });

    expect(formatProviderStatusText(provider)).toBe('Ready but locked');
  });

  it('keeps internal codex-native ready state explicit instead of showing a generic auth label', () => {
    const provider = createCodexProvider({
      authenticated: true,
      authMethod: 'api_key',
      statusMessage: 'Codex native runtime ready',
      selectedBackendId: 'codex-native',
      resolvedBackendId: 'codex-native',
      availableBackends: [
        {
          id: 'codex-native',
          label: 'Codex native',
          description: 'Use codex exec JSON mode.',
          selectable: true,
          recommended: false,
          available: true,
          state: 'ready',
          audience: 'internal',
          statusMessage: 'Ready for internal use',
          detailMessage: 'Internal rollout only.',
        },
      ],
      backend: {
        kind: 'codex-native',
        label: 'Codex native',
      },
    });

    expect(formatProviderStatusText(provider)).toBe('Ready for internal use');
  });

  it('surfaces native auth-required state from the selected backend option', () => {
    const provider = createCodexProvider({
      authenticated: false,
      authMethod: null,
      statusMessage: 'Codex native runtime not ready',
      selectedBackendId: 'codex-native',
      resolvedBackendId: null,
      availableBackends: [
        {
          id: 'codex-native',
          label: 'Codex native',
          description: 'Use codex exec JSON mode.',
          selectable: false,
          recommended: false,
          available: false,
          state: 'authentication-required',
          audience: 'internal',
          statusMessage: 'Authentication required',
          detailMessage: 'Set CODEX_API_KEY.',
        },
      ],
      backend: null,
    });

    expect(formatProviderStatusText(provider)).toBe('Authentication required');
  });

  it('surfaces native runtime-missing state from the selected backend option', () => {
    const provider = createCodexProvider({
      authenticated: false,
      authMethod: null,
      statusMessage: 'Codex native runtime not ready',
      selectedBackendId: 'codex-native',
      resolvedBackendId: null,
      availableBackends: [
        {
          id: 'codex-native',
          label: 'Codex native',
          description: 'Use codex exec JSON mode.',
          selectable: false,
          recommended: false,
          available: false,
          state: 'runtime-missing',
          audience: 'internal',
          statusMessage: 'Codex CLI not found',
          detailMessage: 'Install the codex CLI before enabling the lane.',
        },
      ],
      backend: null,
    });

    expect(formatProviderStatusText(provider)).toBe('Codex CLI not found');
  });
});
