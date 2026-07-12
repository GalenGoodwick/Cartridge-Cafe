const logApiCall = (..._args: unknown[]) => Promise.resolve() // budget/telemetry stub — meter with $CART later
import Anthropic from '@anthropic-ai/sdk'
import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages'

// Caller context — set before API calls to track who's spending
let _currentCaller = 'other'
export function setApiCaller(caller: string) { _currentCaller = caller }

const MODEL_MAP: Record<string, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
}

// Shell model — controlled by env var SHELL_MODEL, defaults to 'haiku' to manage costs.
// Set SHELL_MODEL=sonnet in Vercel env to upgrade when revenue supports it.
export const SHELL_MODEL = (process.env.SHELL_MODEL as string) || 'haiku'

let anthropic: Anthropic | null = null

function getClient(): Anthropic {
  if (process.env.AI_DISABLED === '1') {
    throw new Error('AI features are currently disabled')
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured. Add it to .env.local')
  }
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return anthropic
}

export type ToolDefinition = {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export type ToolResult = {
  toolName: string
  toolInput: Record<string, unknown>
}

export type ClaudeResponse = {
  text: string
  toolUse?: ToolResult & { id: string }
  rawContent: unknown[]
  stopReason: string
}

export async function callClaude(
  systemPrompt: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  model: string = 'haiku',
  maxTokens: number = 512
): Promise<string> {
  const result = await callClaudeWithTools(systemPrompt, messages, model, undefined, maxTokens)
  return result.text
}

export async function callClaudeWithTools(
  systemPrompt: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  model: string = 'haiku',
  tools?: ToolDefinition[],
  maxTokens: number = 512
): Promise<ClaudeResponse> {
  const client = getClient()
  const modelId = MODEL_MAP[model] || MODEL_MAP.haiku

  const params: MessageCreateParamsNonStreaming = {
    model: modelId,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  }
  if (tools && tools.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params.tools = tools as any
  }

  const response: Message = await client.messages.create(params)

  // Log cost — fire and forget
  const resolvedModel = Object.entries(MODEL_MAP).find(([, v]) => v === modelId)?.[0] || model
  logApiCall(
    resolvedModel,
    response.usage?.input_tokens || 0,
    response.usage?.output_tokens || 0,
    _currentCaller
  ).catch(() => {})

  const textBlock = response.content.find(block => block.type === 'text')
  const toolBlock = response.content.find(block => block.type === 'tool_use')

  return {
    text: textBlock && 'text' in textBlock ? textBlock.text : '',
    toolUse: toolBlock && 'name' in toolBlock ? {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      id: (toolBlock as any).id || '',
      toolName: toolBlock.name,
      toolInput: toolBlock.input as Record<string, unknown>,
    } : undefined,
    rawContent: response.content as unknown[],
    stopReason: response.stop_reason || 'end_turn',
  }
}

/**
 * Continue a conversation after tool execution.
 * Feeds the assistant's tool_use response + tool_result back to get natural speech.
 * This is what lets the Shell speak AND use tools in the same turn.
 */
export async function continueAfterTool(
  systemPrompt: string,
  priorMessages: { role: 'user' | 'assistant'; content: string }[],
  assistantContent: unknown[],
  toolUseId: string,
  toolResult: string,
  model: string = 'haiku',
  tools?: ToolDefinition[]
): Promise<ClaudeResponse> {
  const client = getClient()
  const modelId = MODEL_MAP[model] || MODEL_MAP.haiku

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    ...priorMessages,
    { role: 'assistant', content: assistantContent },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: toolResult }] },
  ]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = {
    model: modelId,
    max_tokens: 512,
    system: systemPrompt,
    messages,
  }
  if (tools && tools.length > 0) {
    params.tools = tools
  }

  const response: Message = await client.messages.create(params)

  // Log cost — fire and forget
  const resolvedModel = Object.entries(MODEL_MAP).find(([, v]) => v === modelId)?.[0] || model
  logApiCall(
    resolvedModel,
    response.usage?.input_tokens || 0,
    response.usage?.output_tokens || 0,
    _currentCaller
  ).catch(() => {})

  const textBlock = response.content.find(block => block.type === 'text')
  const toolBlock = response.content.find(block => block.type === 'tool_use')

  return {
    text: textBlock && 'text' in textBlock ? textBlock.text : '',
    toolUse: toolBlock && 'name' in toolBlock ? {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      id: (toolBlock as any).id || '',
      toolName: toolBlock.name,
      toolInput: toolBlock.input as Record<string, unknown>,
    } : undefined,
    rawContent: response.content as unknown[],
    stopReason: response.stop_reason || 'end_turn',
  }
}

/**
 * Stream a Claude response via SSE. Calls onDelta with each text chunk.
 * Returns full ClaudeResponse when complete (with tool use if any).
 */
export async function streamClaudeWithTools(
  systemPrompt: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  model: string = 'haiku',
  tools?: ToolDefinition[],
  onDelta?: (text: string) => void,
): Promise<ClaudeResponse> {
  const client = getClient()
  const modelId = MODEL_MAP[model] || MODEL_MAP.haiku

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = {
    model: modelId,
    max_tokens: 512,
    system: systemPrompt,
    messages,
    stream: true,
  }
  if (tools && tools.length > 0) {
    params.tools = tools
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream: any = await client.messages.create(params)

  let fullText = ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contentBlocks: any[] = []
  let inputTokens = 0
  let outputTokens = 0

  for await (const event of stream) {
    if (event.type === 'message_start' && event.message?.usage) {
      inputTokens = event.message.usage.input_tokens || 0
    }
    if (event.type === 'message_delta' && event.usage) {
      outputTokens = event.usage.output_tokens || 0
    }
    if (event.type === 'content_block_start') {
      contentBlocks.push({ ...event.content_block, _rawInput: '' })
    }
    if (event.type === 'content_block_delta') {
      if (event.delta.type === 'text_delta') {
        fullText += event.delta.text
        onDelta?.(event.delta.text)
      }
      if (event.delta.type === 'input_json_delta') {
        const lastBlock = contentBlocks[contentBlocks.length - 1]
        if (lastBlock) lastBlock._rawInput += event.delta.partial_json
      }
    }
  }

  // Parse tool input
  const toolBlock = contentBlocks.find(b => b.type === 'tool_use')
  if (toolBlock?._rawInput) {
    try { toolBlock.input = JSON.parse(toolBlock._rawInput) } catch { toolBlock.input = {} }
  }

  const resolvedModel = Object.entries(MODEL_MAP).find(([, v]) => v === modelId)?.[0] || model
  logApiCall(resolvedModel, inputTokens, outputTokens, _currentCaller).catch(() => {})

  return {
    text: fullText,
    toolUse: toolBlock ? {
      id: toolBlock.id || '',
      toolName: toolBlock.name,
      toolInput: toolBlock.input as Record<string, unknown>,
    } : undefined,
    rawContent: contentBlocks,
    stopReason: 'end_turn',
  }
}
