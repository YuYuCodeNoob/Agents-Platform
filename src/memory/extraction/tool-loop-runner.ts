export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export interface ToolLoopConfig {
  llmApiUrl: string;
  llmApiKey: string;
  llmModel: string;
  maxIterations?: number;
}

export interface ToolLoopResult {
  text: string;
  toolCallsMade: number;
}

export class ToolLoopRunner {
  private maxIterations: number;

  constructor(private config: ToolLoopConfig) {
    this.maxIterations = config.maxIterations ?? 20;
  }

  async run(
    systemPrompt: string,
    userPrompt: string,
    tools: ToolDefinition[]
  ): Promise<ToolLoopResult> {
    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const toolDefs = tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const toolMap = new Map(tools.map((t) => [t.name, t]));
    let toolCallsMade = 0;

    for (let iter = 0; iter < this.maxIterations; iter++) {
      const response = await fetch(`${this.config.llmApiUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.llmApiKey}`,
        },
        body: JSON.stringify({
          model: this.config.llmModel,
          messages,
          tools: toolDefs,
          tool_choice: 'auto',
          temperature: 0.1,
          max_tokens: 8192,
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`LLM API error: ${response.status} ${response.statusText} — ${errText}`);
      }

      const data = await response.json() as {
        choices: Array<{
          message: {
            role: string;
            content: string | null;
            tool_calls?: Array<{
              id: string;
              type: string;
              function: { name: string; arguments: string };
            }>;
          };
          finish_reason: string;
        }>;
      };

      const choice = data.choices[0];
      if (!choice) break;

      const msg = choice.message;
      messages.push({ role: 'assistant', content: msg.content, tool_calls: msg.tool_calls });

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return {
          text: msg.content ?? '',
          toolCallsMade,
        };
      }

      for (const call of msg.tool_calls) {
        toolCallsMade++;
        const tool = toolMap.get(call.function.name);
        let result: string;

        if (!tool) {
          result = `Error: unknown tool "${call.function.name}"`;
        } else {
          try {
            const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
            result = await tool.execute(args);
          } catch (err) {
            result = `Error executing tool ${call.function.name}: ${String(err)}`;
          }
        }

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result,
        });
      }
    }

    return {
      text: messages[messages.length - 1]?.content ?? '',
      toolCallsMade,
    };
  }
}
