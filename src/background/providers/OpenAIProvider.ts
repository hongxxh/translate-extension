/* 自定义 OpenAI 兼容接口（DeepSeek / 智谱 / Moonshot / 通义 / 本地 Ollama …） */
import type { Provider } from './types';

export const openaiProvider: Provider = {
  id: 'openai',
  async translate(ctx, settings, onPartial) {
    const cfg = settings.openai || {};
    const base = String(cfg.baseUrl || '').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    const model = cfg.model || 'deepseek-chat';
    if (!base) throw new Error('OPENAI_NO_BASEURL');
    if (!cfg.apiKey) throw new Error('OPENAI_NO_KEY');

    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.apiKey,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        stream: false,
        messages: [
          { role: 'system', content: '你是专业翻译引擎。只输出译文，不要解释、不要前言、不要用引号包裹。' },
          { role: 'user', content: ctx.prompt },
        ],
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (json.error && (json.error.message || json.error.code)) || '自定义模型接口 HTTP ' + res.status;
      throw new Error('自定义模型：' + msg);
    }
    const content = json.choices
      && json.choices[0]
      && json.choices[0].message
      && json.choices[0].message.content;
    if (!content) throw new Error('EMPTY_RESULT');
    if (onPartial) onPartial(content);
    return content;
  },
};
