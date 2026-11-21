import {z} from 'zod';

export const modelSchema = z.discriminatedUnion('provider', [
  z.object({provider: z.literal('openai'), model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/),
    size: z.enum(['1536x1024', '1024x1024', '1024x1536', 'auto']), quality: z.enum(['low', 'medium', 'high', 'auto'])}).strict(),
  z.object({provider: z.literal('ark'), model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/),
    size: z.enum(['2K', '4K']), quality: z.literal('standard')}).strict(),
]);
export type ModelConfig = z.infer<typeof modelSchema>;
export function defaultModel(env: Record<string, any>): ModelConfig {
  return env.ARK_API_KEY ? {provider: 'ark', model: env.ARK_IMAGE_MODEL || 'doubao-seedream-4-5-251128', size: '2K', quality: 'standard'}
    : {provider: 'openai', model: env.OPENAI_IMAGE_MODEL || 'gpt-image-2', size: '1536x1024', quality: 'medium'};
}
export function credentialReady(config: ModelConfig, env: Record<string, any>) {
  return !!env[config.provider === 'openai' ? 'OPENAI_API_KEY' : 'ARK_API_KEY'];
}
