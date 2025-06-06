import * as vscode from 'vscode';
import { TimeTravelDebugger, ExecutionStep } from '../evaluator/timeTravel';

export class TimeTravelPanel {
    public static currentPanel: TimeTravelPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private timeTravelDebugger: TimeTravelDebugger;

    public static createOrShow(extensionUri: vscode.Uri, timeTravelDebugger: TimeTravelDebugger) {
        const column = vscode.ViewColumn.Two;

        // If we already have a panel, show it
        if (TimeTravelPanel.currentPanel) {
            TimeTravelPanel.currentPanel._panel.reveal(column);
            TimeTravelPanel.currentPanel.timeTravelDebugger = timeTravelDebugger;
            TimeTravelPanel.currentPanel._update();
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'timeTravelDebugger',
            'Time Travel Debugger',
            column,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
            }
        );

        TimeTravelPanel.currentPanel = new TimeTravelPanel(panel, extensionUri, timeTravelDebugger);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, timeTravelDebugger: TimeTravelDebugger) {
        this._panel = panel;
        this.timeTravelDebugger = timeTravelDebugger;

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'stepBack':
                        this.stepBack();
                        return;
                    case 'stepForward':
                        this.stepForward();
                        return;
                    case 'goToStep':
                        this.goToStep(message.index);
                        return;
                    case 'clearHistory':
                        this.clearHistory();
                        return;
                    case 'toggleTimeTravel':
                        this.toggleTimeTravel();
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    private stepBack() {
        const step = this.timeTravelDebugger.stepBack();
        if (step) {
            this._update();
            this._highlightStep(step);
        }
    }

    private stepForward() {
        const step = this.timeTravelDebugger.stepForward();
        if (step) {
            this._update();
            this._highlightStep(step);
        }
    }

    private goToStep(index: number) {
        const step = this.timeTravelDebugger.goToStep(index);
        if (step) {
            this._update();
            this._highlightStep(step);
        }
    }

    private clearHistory() {
        this.timeTravelDebugger.clearHistory();
        this._update();
    }

    private toggleTimeTravel() {
        // This will be handled by the main extension
        vscode.commands.executeCommand('jsEvaluator.toggleTimeTravel');
    }

    private _highlightStep(step: ExecutionStep) {
        // Highlight the expression in the editor
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            editor.selection = new vscode.Selection(step.expressionRange.start, step.expressionRange.end);
            editor.revealRange(step.expressionRange, vscode.TextEditorRevealType.InCenter);
        }
    }

    public update() {
        this._update();
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.title = 'Time Travel Debugger';
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const steps = this.timeTravelDebugger.getAllSteps();
        const currentIndex = this.timeTravelDebugger.getCurrentStepIndex();
        const currentStep = this.timeTravelDebugger.getCurrentStep();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Time Travel Debugger</title>
    <style>
        body {
            padding: 20px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }
        
        .controls {
            margin-bottom: 20px;
            padding: 15px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 5px;
        }
        
        .control-group {
            display: flex;
            gap: 10px;
            align-items: center;
            margin-bottom: 10px;
        }
        
        button {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
        }
        
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .step-info {
            margin-bottom: 20px;
            padding: 15px;
            background: var(--vscode-textBlockQuote-background);
            border-left: 4px solid var(--vscode-textBlockQuote-border);
            border-radius: 3px;
        }
        
        .step-timeline {
            max-height: 400px;
            overflow-y: auto;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 3px;
        }
        
        .step-item {
            padding: 10px;
            border-bottom: 1px solid var(--vscode-widget-border);
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .step-item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        
        .step-item.current {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }
        
        .step-content {
            flex: 1;
        }
        
        .step-expression {
            font-family: var(--vscode-editor-font-family);
            font-size: 0.9em;
            background: var(--vscode-textCodeBlock-background);
            padding: 4px 8px;
            border-radius: 3px;
            margin-bottom: 5px;
        }
        
        .step-result {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
        }
        
        .step-variables {
            margin-top: 10px;
        }
        
        .variable-item {
            display: flex;
            justify-content: space-between;
            padding: 2px 0;
            font-family: var(--vscode-editor-font-family);
            font-size: 0.85em;
        }
        
        .variable-changed {
            background: var(--vscode-diffEditor-insertedTextBackground);
            padding: 1px 4px;
            border-radius: 2px;
        }
        
        .step-timestamp {
            font-size: 0.75em;
            color: var(--vscode-descriptionForeground);
        }
        
        .no-history {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="controls">
        <div class="control-group">
            <button onclick="stepBack()" ${!this.timeTravelDebugger.canStepBack() ? 'disabled' : ''}>⬅ Step Back</button>
            <button onclick="stepForward()" ${!this.timeTravelDebugger.canStepForward() ? 'disabled' : ''}>Step Forward ➡</button>
            <span>Step ${currentIndex + 1} of ${steps.length}</span>
        </div>
        <div class="control-group">
            <button onclick="clearHistory()">🗑 Clear History</button>
            <button onclick="toggleTimeTravel()">⏱ Toggle Time Travel</button>
        </div>
    </div>

    ${currentStep ? `
    <div class="step-info">
        <h3>Current Step</h3>
        <div class="step-expression">${this._escapeHtml(currentStep.expressionText)}</div>
        <div class="step-result">
            ${currentStep.error ? 
                `<span style="color: var(--vscode-errorForeground);">Error: ${this._escapeHtml(currentStep.error)}</span>` :
                `Result: ${this._escapeHtml(this._formatValue(currentStep.result))}`
            }
        </div>
        ${currentStep.variableStates.length > 0 ? `
        <div class="step-variables">
            <strong>Variables:</strong>
            ${currentStep.variableStates.map(variable => `
                <div class="variable-item ${variable.changed ? 'variable-changed' : ''}">
                    <span>${variable.name}:</span>
                    <span>${this._escapeHtml(this._formatValue(variable.value))}</span>
                </div>
            `).join('')}
        </div>
        ` : ''}
    </div>
    ` : ''}

    <div class="step-timeline">
        ${steps.length === 0 ? `
        <div class="no-history">
            No execution history available. Start coding to see time travel debugging in action!
        </div>
        ` : steps.map((step, index) => `
        <div class="step-item ${index === currentIndex ? 'current' : ''}" onclick="goToStep(${index})">
            <div class="step-content">
                <div class="step-expression">${this._escapeHtml(step.expressionText)}</div>
                <div class="step-result">
                    ${step.error ? 
                        `<span style="color: var(--vscode-errorForeground);">Error: ${this._escapeHtml(step.error)}</span>` :
                        `${this._escapeHtml(this._formatValue(step.result))}`
                    }
                </div>
            </div>
            <div class="step-timestamp">
                ${new Date(step.timestamp).toLocaleTimeString()}
            </div>
        </div>
        `).join('')}
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function stepBack() {
            vscode.postMessage({ command: 'stepBack' });
        }

        function stepForward() {
            vscode.postMessage({ command: 'stepForward' });
        }

        function goToStep(index) {
            vscode.postMessage({ command: 'goToStep', index: index });
        }

        function clearHistory() {
            vscode.postMessage({ command: 'clearHistory' });
        }

        function toggleTimeTravel() {
            vscode.postMessage({ command: 'toggleTimeTravel' });
        }
    </script>
</body>
</html>`;
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private _formatValue(value: any): string {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (typeof value === 'string') return `"${value}"`;
        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch {
                return '[Object]';
            }
        }
        return String(value);
    }

    public dispose() {
        TimeTravelPanel.currentPanel = undefined;

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}