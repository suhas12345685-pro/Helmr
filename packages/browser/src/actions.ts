import { z } from 'zod';

const HttpUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), {
    message: 'url must use http or https',
  });

const SelectorSchema = z.string().min(1).max(512);

export const NavigateActionSchema = z.object({
  kind: z.literal('navigate'),
  url: HttpUrlSchema,
});

export const ClickActionSchema = z.object({
  kind: z.literal('click'),
  selector: SelectorSchema,
});

export const TypeActionSchema = z.object({
  kind: z.literal('type'),
  selector: SelectorSchema,
  text: z.string().max(10_000),
});

export const ExtractTextActionSchema = z.object({
  kind: z.literal('extractText'),
  selector: SelectorSchema.optional(),
});

export const WaitForActionSchema = z.object({
  kind: z.literal('waitFor'),
  selector: SelectorSchema,
  timeoutMs: z.number().int().min(0).max(120_000).optional(),
});

export const ScreenshotActionSchema = z.object({
  kind: z.literal('screenshot'),
  path: z.string().min(1).max(1024).optional(),
  fullPage: z.boolean().optional(),
});

export const BrowserActionSchema = z.discriminatedUnion('kind', [
  NavigateActionSchema,
  ClickActionSchema,
  TypeActionSchema,
  ExtractTextActionSchema,
  WaitForActionSchema,
  ScreenshotActionSchema,
]);

export type BrowserAction = z.infer<typeof BrowserActionSchema>;
export type BrowserActionKind = BrowserAction['kind'];

export function parseBrowserAction(input: unknown): BrowserAction {
  return BrowserActionSchema.parse(input);
}

/** Actions that mutate page state or an authenticated session carry more risk. */
const MUTATING_KINDS = new Set<BrowserActionKind>(['click', 'type']);

export function browserActionRisk(action: BrowserAction): 'low' | 'medium' {
  return MUTATING_KINDS.has(action.kind) ? 'medium' : 'low';
}
