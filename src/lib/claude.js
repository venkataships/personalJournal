import Anthropic from '@anthropic-ai/sdk';

const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;

if (!apiKey) {
  throw new Error(
    'Missing VITE_ANTHROPIC_API_KEY. Add it to .env and restart `npm run dev`.',
  );
}

// dangerouslyAllowBrowser: yes, the key is in the browser bundle.
// Mitigations: spend limit set in Anthropic console, .env in .gitignore.
export const anthropic = new Anthropic({
  apiKey,
  dangerouslyAllowBrowser: true,
});

export const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';
