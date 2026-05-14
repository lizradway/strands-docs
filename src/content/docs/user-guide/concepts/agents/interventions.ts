import { Agent, FunctionTool, InterventionHandler, InterventionActions } from '@strands-agents/sdk'
import type { OnError } from '@strands-agents/sdk'
import {
  BeforeInvocationEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
} from '@strands-agents/sdk'

// Mock tools for examples
const searchTool = new FunctionTool({
  name: 'search',
  description: 'Search for information',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  callback: async (input: unknown) => 'search results',
})

const calculatorTool = new FunctionTool({
  name: 'calculator',
  description: 'Perform calculations',
  inputSchema: { type: 'object', properties: { expression: { type: 'string' } } },
  callback: async (input: unknown) => '42',
})

const sendEmailTool = new FunctionTool({
  name: 'send_email',
  description: 'Send an email',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string' },
      body: { type: 'string' },
    },
  },
  callback: async (input: unknown) => 'email sent',
})

// =====================
// Basic Usage
// =====================

async function basicUsageExample() {
  // --8<-- [start:basic_usage]
  class ApiKeyAuth extends InterventionHandler {
    readonly name = 'api-key-auth'

    override beforeInvocation(event: BeforeInvocationEvent) {
      const apiKey = event.invocationState.apiKey as string | undefined
      if (!apiKey) {
        return InterventionActions.deny('Missing API key')
      }
      return InterventionActions.proceed()
    }
  }

  const agent = new Agent({
    tools: [searchTool],
    interventions: [new ApiKeyAuth()],
  })

  const result = await agent.invoke('Find information about Strands', {
    invocationState: { apiKey: 'sk-123' },
  })
  // --8<-- [end:basic_usage]
}

// =====================
// Action Types
// =====================

async function actionTypesExample() {
  // --8<-- [start:action_types]
  class DemoHandler extends InterventionHandler {
    readonly name = 'demo'

    override beforeToolCall(event: BeforeToolCallEvent) {
      const toolName = event.toolUse.name

      // proceed() — allow the operation to continue
      if (toolName === 'search') {
        return InterventionActions.proceed()
      }

      // deny(reason) — block the operation, short-circuits remaining handlers
      if (toolName === 'dangerous_tool') {
        return InterventionActions.deny('This tool is not allowed')
      }

      // guide(feedback) — cancel and provide feedback for the model to retry
      if (toolName === 'send_email' && !event.toolUse.input.to) {
        return InterventionActions.guide('You must specify a recipient')
      }

      // interrupt(prompt) — pause for human approval
      if (toolName === 'delete_database') {
        return InterventionActions.interrupt('Approve database deletion?')
      }

      // transform(apply) — modify event content in-place
      if (toolName === 'calculator') {
        return InterventionActions.transform((e) => {
          const toolEvent = e as BeforeToolCallEvent
          ;(toolEvent.toolUse.input as Record<string, unknown>).precision = 2
        })
      }

      return InterventionActions.proceed()
    }
  }
  // --8<-- [end:action_types]
}

// =====================
// Short-Circuiting
// =====================

async function shortCircuitingExample() {
  // --8<-- [start:short_circuiting]
  class RateLimiter extends InterventionHandler {
    readonly name = 'rate-limiter'
    private callCount = 0

    override beforeToolCall(event: BeforeToolCallEvent) {
      this.callCount++
      if (this.callCount > 10) {
        // deny() short-circuits: handlers registered after this one are skipped
        return InterventionActions.deny('Rate limit exceeded')
      }
      return InterventionActions.proceed()
    }
  }

  class ToneSteeringHandler extends InterventionHandler {
    readonly name = 'tone-steering'

    override afterModelCall(event: AfterModelCallEvent) {
      // This handler never runs for denied tool calls
      return InterventionActions.guide('Use a more professional tone.')
    }
  }

  // Handlers evaluate in registration order
  const agent = new Agent({
    tools: [searchTool],
    interventions: [
      new RateLimiter(),         // Evaluates first
      new ToneSteeringHandler(), // Skipped if RateLimiter denies
    ],
  })
  // --8<-- [end:short_circuiting]
}

// =====================
// Error Handling
// =====================

async function errorHandlingExample() {
  // --8<-- [start:error_handling]
  // 'proceed' — if this handler throws, continue as if proceed() was returned
  class BestEffortLogger extends InterventionHandler {
    readonly name = 'best-effort-logger'
    readonly onError: OnError = 'proceed'

    override beforeToolCall(event: BeforeToolCallEvent) {
      // If the logging service is unreachable, the agent continues normally
      console.log(`Tool called: ${event.toolUse.name}`)
      return InterventionActions.proceed()
    }
  }

  // 'deny' — if this handler throws, treat it as a deny (fail-closed)
  class StrictAuth extends InterventionHandler {
    readonly name = 'strict-auth'
    readonly onError: OnError = 'deny'

    override beforeToolCall(event: BeforeToolCallEvent) {
      // If the auth service is down (throws), the operation is denied
      if (!this.checkPermission(event.toolUse.name)) {
        return InterventionActions.deny('Unauthorized')
      }
      return InterventionActions.proceed()
    }

    private checkPermission(toolName: string): boolean {
      // ... call external auth service
      return true
    }
  }

  // 'throw' (default) — errors propagate and fail the invocation
  class CriticalValidator extends InterventionHandler {
    readonly name = 'critical-validator'
    // onError defaults to 'throw'

    override beforeToolCall(event: BeforeToolCallEvent) {
      // If this throws, the entire invocation fails
      return InterventionActions.proceed()
    }
  }
  // --8<-- [end:error_handling]
}

// =====================
// Composed Example
// =====================

async function composedExample() {
  // --8<-- [start:composed_example]
  // Authorization: only allow specific tools per user
  class ToolAuthorization extends InterventionHandler {
    readonly name = 'tool-authorization'
    readonly onError: OnError = 'deny'

    private allowedTools: Record<string, string[]>

    constructor(allowedTools: Record<string, string[]>) {
      super()
      this.allowedTools = allowedTools
    }

    override beforeToolCall(event: BeforeToolCallEvent) {
      const userId = event.invocationState.userId as string
      const allowed = this.allowedTools[userId] ?? []

      if (!allowed.includes(event.toolUse.name)) {
        return InterventionActions.deny(
          `User '${userId}' is not authorized for tool '${event.toolUse.name}'`
        )
      }
      return InterventionActions.proceed()
    }
  }

  // Steering: guide the model's tone
  class ProfessionalTone extends InterventionHandler {
    readonly name = 'professional-tone'

    override beforeModelCall(event: BeforeModelCallEvent) {
      return InterventionActions.guide(
        'Respond in a professional, concise manner. Avoid casual language.'
      )
    }
  }

  // PII redaction: transform tool inputs to remove sensitive data
  class PiiRedactor extends InterventionHandler {
    readonly name = 'pii-redactor'

    override beforeToolCall(event: BeforeToolCallEvent) {
      if (event.toolUse.name === 'send_email') {
        return InterventionActions.transform((e) => {
          const toolEvent = e as BeforeToolCallEvent
          const input = toolEvent.toolUse.input as Record<string, string>
          input.body = this.redact(input.body)
        })
      }
      return InterventionActions.proceed()
    }

    private redact(text: string): string {
      return text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED-SSN]')
    }
  }

  // Compose all interventions on a single agent
  const agent = new Agent({
    tools: [searchTool, calculatorTool, sendEmailTool],
    interventions: [
      // Authorization runs first — denies short-circuit the pipeline
      new ToolAuthorization({
        alice: ['search', 'calculator', 'send_email'],
        bob: ['search', 'calculator'],
      }),
      // PII redaction runs next — transforms tool inputs
      new PiiRedactor(),
      // Tone steering runs last — guides model behavior
      new ProfessionalTone(),
    ],
  })

  const result = await agent.invoke('Send an email to the client', {
    invocationState: { userId: 'alice' },
  })
  // --8<-- [end:composed_example]
}

// Suppress unused function warnings
void basicUsageExample
void actionTypesExample
void shortCircuitingExample
void errorHandlingExample
void composedExample
