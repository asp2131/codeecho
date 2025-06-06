import * as vm from 'vm';
import * as vscode from 'vscode';
import { TimeTravelDebugger, ExecutionStep } from './timeTravel';

/**
 * Safely evaluates JavaScript expressions in a sandboxed environment with time travel debugging support.
 */
export class SafeEvaluator {
  private timeTravelDebugger: TimeTravelDebugger;
  private isTimeTravelEnabled: boolean = false;

  constructor() {
    this.timeTravelDebugger = new TimeTravelDebugger();
  }

  // Time travel control methods
  enableTimeTravel(): void {
    this.isTimeTravelEnabled = true;
  }

  disableTimeTravel(): void {
    this.isTimeTravelEnabled = false;
  }

  getTimeTravelDebugger(): TimeTravelDebugger {
    return this.timeTravelDebugger;
  }

  clearTimeTravelHistory(): void {
    this.timeTravelDebugger.clearHistory();
  }

  public createContext(logOutput?: (message: string, expressionRange?: vscode.Range) => void): vm.Context {
    // Create a basic context with a custom console.log if a logger is provided
    const sandbox: any = {
      console: {
        log: (message: any, ...optionalParams: any[]) => {
          const output = [message, ...optionalParams].map(m => {
            if (typeof m === 'object') {
              try {
                return JSON.stringify(m, null, 2);
              } catch (e) {
                return '[Unserializable Object]';
              }
            }
            return String(m);
          }).join(' ');

          if (logOutput) {
            // Retrieve the range of the expression that triggered this log
            // It's stored on the 'sandbox' (the VM context) object itself.
            const currentExpressionRange = sandbox.__currentExpressionRange as vscode.Range | undefined;
            logOutput(output, currentExpressionRange);
          } else {
            // Fallback to actual console.log if no custom logger, for internal debugging
            // In a real scenario, direct console.log from sandbox might be restricted
            console.log('[Sandbox]:', output);
          }
        },
        // We can add more console methods (error, warn, etc.) as needed
      },
      // You can add other globals here that you want to be available in the sandbox
      // e.g., setTimeout, clearTimeout, etc. but be careful about security.
    };
    return vm.createContext(sandbox);
  }

  /**
   * Evaluates a given JavaScript expression string in a sandboxed context.
   * @param expression The JavaScript expression string to evaluate.
   * @param onLogMessage A callback to handle messages from console.log within the sandbox.
   * @returns The result of the evaluation or an error object if evaluation fails.
   */
  /**
   * Evaluates a given JavaScript expression string in the provided sandboxed context.
   * @param expressionText The JavaScript expression string to evaluate.
   * @param expressionRange The range of this expression in the original document.
   * @param context The V8 VM context to execute the code in.
   * @returns The result of the evaluation or an error object if evaluation fails.
   */
  public evaluate(expressionText: string, expressionRange: vscode.Range, context: vm.Context): any {
    // Store the current expression's range on the context so the sandbox logger can access it
    (context as any).__currentExpressionRange = expressionRange;

    let result: any;
    let error: string | undefined;

    try {
      const script = new vm.Script(expressionText);
      result = script.runInContext(context, { timeout: 1000 }); // 1 second timeout
    } catch (e: any) {
      error = e.message || String(e);
    } finally {
      // Clean up the temporary range property
      delete (context as any).__currentExpressionRange;
    }

    // Record execution step for time travel debugging if enabled
    if (this.isTimeTravelEnabled) {
      console.log('[TimeTravelDebugger] Recording step for:', expressionText);
      this.timeTravelDebugger.recordStep(
        expressionText,
        expressionRange,
        result,
        context,
        error
      );
    }

    return error ? { error } : { result };
  }
}
