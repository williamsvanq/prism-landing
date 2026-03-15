const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { requireAuth, supabase } = require('../middleware/auth');

const router = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const FREE_DAILY_LIMIT = 3;

const SYSTEM_PROMPT = `You are PRISM, an elite content strategist and platform expert.
Your task is to repurpose a piece of written content into 5 platform-native formats.
Each format must be authentic, optimized, and ready to publish — not a generic rewrite.

Return ONLY valid JSON matching this exact schema:
{
  "linkedin": "string (≤3000 chars, hook in first line, 3-5 short paragraphs, 3-5 hashtags at end)",
  "twitter": ["tweet1", "tweet2", ...] (5-10 tweets, each ≤280 chars, numbered 1/N format, thread-worthy),
  "newsletter": "string (150-250 words, conversational, curiosity-opening, one clear CTA)",
  "instagram": "string (≤2200 chars, visual-first, 20-30 hashtags at end, line breaks for readability)",
  "seo": {
    "title": "string (≤60 chars, keyword-rich, CTR-optimized)",
    "url": "string (slug format, lowercase hyphenated, ≤60 chars)",
    "description": "string (≤160 chars, action-oriented, includes primary keyword)"
  }
}

Rules:
- LinkedIn: Professional but personal. Start with a bold hook or counterintuitive statement. Use line breaks liberally.
- Twitter: Make it a narrative thread. First tweet is the hook, last tweet has a clear CTA. No filler.
- Newsletter: Write like you're emailing a smart friend. Casual but insightful. End with a single clear next step.
- Instagram: High energy, visual language. Emojis welcome. Hashtag block separated by line break.
- SEO: Think like a searcher. Title should answer a question or promise a result. URL should be memorable.`;

router.post('/', requireAuth, async (req, res) => {
  const { text, tone } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }

  const userId = req.user.id;

  // Fetch user profile to check plan
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', userId)
    .single();

  const isLifetime = profile?.plan === 'lifetime';

  // Check and enforce free tier limit
  if (!isLifetime) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: usage } = await supabase
      .from('usage')
      .select('count')
      .eq('user_id', userId)
      .eq('date', today)
      .single();

    const currentCount = usage?.count ?? 0;
    if (currentCount >= FREE_DAILY_LIMIT) {
      return res.status(429).json({
        error: 'Daily limit reached',
        limit: FREE_DAILY_LIMIT,
        upgradeUrl: '/checkout',
      });
    }
  }

  // Enforce input length limits
  const maxChars = isLifetime ? 200000 : 40000;
  if (text.length > maxChars) {
    return res.status(400).json({
      error: `Input exceeds ${isLifetime ? '50k' : '10k'} word limit`,
    });
  }

  const toneInstruction = tone
    ? `\n\nTone preference: ${tone}. Apply this tone across all formats.`
    : '';

  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Repurpose the following content into all 5 platform formats:${toneInstruction}\n\n---\n${text}\n---`,
        },
      ],
    });

    const raw = message.content[0].text.trim();
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const outputs = JSON.parse(jsonStr);

    // Increment usage counter (fire-and-forget)
    const today = new Date().toISOString().slice(0, 10);
    supabase.rpc('increment_usage', { p_user_id: userId, p_date: today }).then();

    res.json({ outputs });
  } catch (err) {
    console.error('Repurpose error:', err);
    if (err instanceof SyntaxError) {
      return res.status(500).json({ error: 'AI returned malformed response. Please try again.' });
    }
    res.status(500).json({ error: 'Failed to repurpose content. Please try again.' });
  }
});

module.exports = router;
