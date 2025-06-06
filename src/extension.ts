import * as vscode from 'vscode';
import * as acorn from 'acorn'; // Import acorn for type assertions
import { ExpressionParser, ExpressionInfo, ParseResult } from './evaluator/parser';
import { SafeEvaluator } from './evaluator/engine';
import { ResultDecorator, EvaluationResultDisplay } from './decorations/resultDecorator';
import { TimeTravelPanel } from './ui/timeTravelPanel';

// Global state for live evaluation
let isLiveEvaluationActive: boolean = false;
let textDocumentChangeDisposable: vscode.Disposable | undefined;
let liveEvaluationStatusBarItem: vscode.StatusBarItem;
let debounceTimer: NodeJS.Timeout | undefined;

// Global diagnostics collection, initialized in activate
let diagnostics: vscode.DiagnosticCollection;

// Time travel debugging state
let isTimeTravelEnabled: boolean = false;
let timeTravelStatusBarItem: vscode.StatusBarItem;

async function evaluateEditor(
    editor: vscode.TextEditor,
    parser: ExpressionParser,
    evaluator: SafeEvaluator,
    resultDecorator: ResultDecorator,
    currentDiagnostics: vscode.DiagnosticCollection
) {
    if (!editor) {
        return;
    }

    if (editor.document.languageId !== 'javascript' && editor.document.languageId !== 'typescript') {
        if (!isLiveEvaluationActive) {
            vscode.window.showInformationMessage('Please use this extension with a JavaScript or TypeScript file.');
        }
        return;
    }

    resultDecorator.clearDecorations(editor);
    currentDiagnostics.clear();

    const document = editor.document;
    const parseOutput: ParseResult = parser.parseDocument(document); // Corrected: pass only document
    const expressions: ExpressionInfo[] = parseOutput.expressions;
    const syntaxDiagnosticsFromParser: vscode.Diagnostic[] = parseOutput.diagnostics;

    if (syntaxDiagnosticsFromParser.length > 0) {
        // Ensure diagnostics are set with the correct source and severity
        const enhancedDiagnostics = syntaxDiagnosticsFromParser.map(diagnostic => ({
            ...diagnostic,
            source: 'JavaScript Evaluator',
            severity: vscode.DiagnosticSeverity.Error
        }));
        
        currentDiagnostics.set(document.uri, enhancedDiagnostics);
        
        // Display syntax errors as inline decorations for better visibility
        resultDecorator.displaySyntaxErrors(editor, enhancedDiagnostics);
        
        if (!isLiveEvaluationActive) {
            vscode.window.showErrorMessage('Syntax errors found. See Problems panel and inline decorations.');
        }
        return;
    }

    if (expressions.length === 0) {
        if (!isLiveEvaluationActive && syntaxDiagnosticsFromParser.length === 0) {
            vscode.window.showInformationMessage('No JavaScript expressions found to evaluate.');
        }
        return;
    }

    const displayableResults: EvaluationResultDisplay[] = [];
    const evaluationContext = evaluator.createContext((logMessage: string, expressionRange?: vscode.Range) => {
        if (expressionRange) {
            displayableResults.push({
                text: logMessage,
                originalRange: expressionRange,
                isLog: true,
            });
        } else {
            console.log(`[Sandbox Log - Unassociated in evaluateEditor]: ${logMessage}`);
        }
    });

    for (const expr of expressions) { // Using for...of for cleaner iteration
        try {
            (evaluationContext as any).__currentExpressionRange = expr.range;
            // Corrected argument order and variable name for evaluation output
            const evaluationOutput = evaluator.evaluate(expr.text, expr.range, evaluationContext);
            delete (evaluationContext as any).__currentExpressionRange;

            if (evaluationOutput.error) {
                displayableResults.push({ text: evaluationOutput.error, originalRange: expr.range, isError: true });
            } else {
                let isConsoleLogCall = false;
                const node = expr.node; // node is acorn.Node
                if (node.type === 'ExpressionStatement') {
                    // Type assertion for ExpressionStatement
                    const expressionStatement = node as acorn.ExpressionStatement;
                    if (expressionStatement.expression.type === 'CallExpression') {
                        // Type assertion for CallExpression
                        const callExpression = expressionStatement.expression as acorn.CallExpression;
                        if (callExpression.callee.type === 'MemberExpression') {
                            // Type assertion for MemberExpression
                            const memberExpression = callExpression.callee as acorn.MemberExpression;
                            if (memberExpression.object.type === 'Identifier') {
                                // Type assertion for Identifier
                                const identifier = memberExpression.object as acorn.Identifier;
                                if (identifier.name === 'console') {
                                    isConsoleLogCall = true;
                                }
                            }
                        }
                    }
                }

                if (evaluationOutput.result !== undefined && !isConsoleLogCall) {
                    displayableResults.push({ text: String(evaluationOutput.result), originalRange: expr.range });
                }
            }
        } catch (e: any) {
            console.error(`[evaluateEditor] Error evaluating expression '${expr.text}':`, e);
            delete (evaluationContext as any).__currentExpressionRange; // Ensure cleanup on error too
            displayableResults.push({ text: e.message || 'Unknown evaluation error', originalRange: expr.range, isError: true });
        }
    }

    if (displayableResults.length > 0) {
        displayableResults.sort((a, b) => a.originalRange.start.line - b.originalRange.start.line);
        resultDecorator.displayResults(editor, displayableResults);
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "vscode-js-evaluator" is now active!');

    diagnostics = vscode.languages.createDiagnosticCollection("javascriptEvaluator");
    context.subscriptions.push(diagnostics);

    const parser = new ExpressionParser();
    const evaluator = new SafeEvaluator();
    const resultDecorator = new ResultDecorator();

    liveEvaluationStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(liveEvaluationStatusBarItem);

    // Initialize time travel status bar item
    timeTravelStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    timeTravelStatusBarItem.command = 'jsEvaluator.showTimeTravelPanel';
    context.subscriptions.push(timeTravelStatusBarItem);

    // Enhanced text document change handler with time travel integration
    const enhancedTextDocumentChange = (event: vscode.TextDocumentChangeEvent) => {
        if (isLiveEvaluationActive && event.document === vscode.window.activeTextEditor?.document) {
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
            debounceTimer = setTimeout(async () => {
                const currentEditor = vscode.window.activeTextEditor;
                if (currentEditor) {
                    await evaluateEditor(currentEditor, parser, evaluator, resultDecorator, diagnostics);
                    
                    // Update time travel panel if open
                    if (TimeTravelPanel.currentPanel && isTimeTravelEnabled) {
                        TimeTravelPanel.currentPanel.update();
                    }
                }
            }, 500);
        }
    };

    const evaluateSelectionCommand = vscode.commands.registerCommand('jsEvaluator.evaluateSelection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            await evaluateEditor(editor, parser, evaluator, resultDecorator, diagnostics);
        }
    });

    const startLiveEvaluationCommand = vscode.commands.registerCommand('jsEvaluator.startLiveEvaluation', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('Open a JavaScript/TypeScript file to start live evaluation.');
            return;
        }
        if (editor.document.languageId !== 'javascript' && editor.document.languageId !== 'typescript') {
            vscode.window.showInformationMessage('Live evaluation only works for JavaScript/TypeScript files.');
            return;
        }

        isLiveEvaluationActive = true;
        liveEvaluationStatusBarItem.text = "$(zap) JS Live";
        liveEvaluationStatusBarItem.tooltip = "JavaScript Live Evaluation is Active";
        liveEvaluationStatusBarItem.show();
        
        console.log('Starting live evaluation...');
        await evaluateEditor(editor, parser, evaluator, resultDecorator, diagnostics);

        if (textDocumentChangeDisposable) {
            textDocumentChangeDisposable.dispose();
        }
        textDocumentChangeDisposable = vscode.workspace.onDidChangeTextDocument(enhancedTextDocumentChange);
        context.subscriptions.push(textDocumentChangeDisposable);
        vscode.window.showInformationMessage('JavaScript Live Evaluation Started.');
    });

    const stopLiveEvaluationCommand = vscode.commands.registerCommand('jsEvaluator.stopLiveEvaluation', () => {
        console.log('Stopping live evaluation...');
        isLiveEvaluationActive = false;
        liveEvaluationStatusBarItem.hide();
        
        if (textDocumentChangeDisposable) {
            textDocumentChangeDisposable.dispose();
            textDocumentChangeDisposable = undefined;
        }
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = undefined;
        }
        
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            resultDecorator.clearDecorations(editor);
            diagnostics.clear(); 
        }
        vscode.window.showInformationMessage('JavaScript Live Evaluation Stopped.');
    });
    
    const clearAllResultsCommand = vscode.commands.registerCommand('jsEvaluator.clearAllResults', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            resultDecorator.clearDecorations(editor);
            diagnostics.clear();
            vscode.window.showInformationMessage('All evaluation results and diagnostics cleared.');
        } else {
            vscode.window.showInformationMessage('No active editor to clear results from.');
        }
    });

    // Time Travel Debugging Commands
    const toggleTimeTravelCommand = vscode.commands.registerCommand('jsEvaluator.toggleTimeTravel', () => {
        isTimeTravelEnabled = !isTimeTravelEnabled;
        
        if (isTimeTravelEnabled) {
            evaluator.enableTimeTravel();
            timeTravelStatusBarItem.text = "$(history) Time Travel";
            timeTravelStatusBarItem.tooltip = "Time Travel Debugging is Active - Click to open panel";
            timeTravelStatusBarItem.show();
            vscode.window.showInformationMessage('Time Travel Debugging enabled! Start coding to see execution history.');
            
            // Auto-open the time travel panel
            TimeTravelPanel.createOrShow(context.extensionUri, evaluator.getTimeTravelDebugger());
        } else {
            evaluator.disableTimeTravel();
            timeTravelStatusBarItem.hide();
            vscode.window.showInformationMessage('Time Travel Debugging disabled.');
        }
    });

    const showTimeTravelPanelCommand = vscode.commands.registerCommand('jsEvaluator.showTimeTravelPanel', () => {
        if (!isTimeTravelEnabled) {
            vscode.window.showInformationMessage('Enable Time Travel Debugging first.');
            return;
        }
        TimeTravelPanel.createOrShow(context.extensionUri, evaluator.getTimeTravelDebugger());
    });

    const clearTimeTravelHistoryCommand = vscode.commands.registerCommand('jsEvaluator.clearTimeTravelHistory', () => {
        evaluator.clearTimeTravelHistory();
        vscode.window.showInformationMessage('Time travel history cleared.');
        
        // Update the panel if it's open
        if (TimeTravelPanel.currentPanel) {
            TimeTravelPanel.currentPanel.update();
        }
    });


    context.subscriptions.push(
        evaluateSelectionCommand, 
        startLiveEvaluationCommand, 
        stopLiveEvaluationCommand,
        clearAllResultsCommand,
        toggleTimeTravelCommand,
        showTimeTravelPanelCommand,
        clearTimeTravelHistoryCommand
    );
}

export function deactivate() {
    console.log('Your extension "vscode-js-evaluator" is now deactivated.');
    if (textDocumentChangeDisposable) {
        textDocumentChangeDisposable.dispose();
    }
    if (liveEvaluationStatusBarItem) {
        liveEvaluationStatusBarItem.dispose();
    }
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
}
