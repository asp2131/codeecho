import * as vscode from 'vscode';

// Core interfaces for time travel debugging
export interface ExecutionStep {
    id: string;
    timestamp: number;
    expressionText: string;
    expressionRange: vscode.Range;
    result: any;
    error?: string;
    variableStates: VariableSnapshot[];
    contextSnapshot: ContextSnapshot;
}

export interface VariableSnapshot {
    name: string;
    value: any;
    type: string;
    changed: boolean; // True if this variable changed in this step
    declarationRange?: vscode.Range;
}

export interface ContextSnapshot {
    variables: Map<string, any>;
    globals: Map<string, any>;
    scopeLevel: number;
}

export interface TimeTravelState {
    steps: ExecutionStep[];
    currentStepIndex: number;
    maxHistorySize: number;
}

export class TimeTravelDebugger {
    private state: TimeTravelState;
    private previousContext: ContextSnapshot | null = null;

    constructor(maxHistorySize: number = 100) {
        this.state = {
            steps: [],
            currentStepIndex: -1,
            maxHistorySize
        };
    }

    // Record a new execution step
    recordStep(
        expressionText: string,
        expressionRange: vscode.Range,
        result: any,
        context: any,
        error?: string
    ): ExecutionStep {
        const contextSnapshot = this.captureContextSnapshot(context);
        const variableStates = this.extractVariableStates(contextSnapshot);
        
        const step: ExecutionStep = {
            id: this.generateStepId(),
            timestamp: Date.now(),
            expressionText,
            expressionRange,
            result,
            error,
            variableStates,
            contextSnapshot
        };

        // Mark variables that changed since the last step
        this.markChangedVariables(step);

        // Add step to history
        this.addStep(step);
        
        this.previousContext = contextSnapshot;
        return step;
    }

    private captureContextSnapshot(context: any): ContextSnapshot {
        const variables = new Map<string, any>();
        const globals = new Map<string, any>();
        
        // Extract variables from context
        for (const key in context) {
            if (key.startsWith('__') || typeof context[key] === 'function') {
                continue; // Skip internal properties and functions
            }
            
            try {
                const value = this.deepClone(context[key]);
                variables.set(key, value);
            } catch (e) {
                variables.set(key, '[Unserializable]');
            }
        }

        return {
            variables,
            globals,
            scopeLevel: 0 // TODO: Implement proper scope tracking
        };
    }

    private extractVariableStates(contextSnapshot: ContextSnapshot): VariableSnapshot[] {
        const states: VariableSnapshot[] = [];
        
        contextSnapshot.variables.forEach((value, name) => {
            states.push({
                name,
                value,
                type: this.getValueType(value),
                changed: false // Will be set by markChangedVariables
            });
        });

        return states;
    }

    private markChangedVariables(step: ExecutionStep): void {
        if (!this.previousContext) {
            // First step - all variables are "new"
            step.variableStates.forEach(variable => {
                variable.changed = true;
            });
            return;
        }

        step.variableStates.forEach(variable => {
            const previousValue = this.previousContext!.variables.get(variable.name);
            variable.changed = !this.deepEqual(previousValue, variable.value);
        });
    }

    private addStep(step: ExecutionStep): void {
        // If we're not at the end of history, truncate from current position
        if (this.state.currentStepIndex < this.state.steps.length - 1) {
            this.state.steps = this.state.steps.slice(0, this.state.currentStepIndex + 1);
        }

        this.state.steps.push(step);
        this.state.currentStepIndex = this.state.steps.length - 1;

        // Enforce max history size
        if (this.state.steps.length > this.state.maxHistorySize) {
            this.state.steps.shift();
            this.state.currentStepIndex--;
        }
    }

    // Navigation methods
    canStepBack(): boolean {
        return this.state.currentStepIndex > 0;
    }

    canStepForward(): boolean {
        return this.state.currentStepIndex < this.state.steps.length - 1;
    }

    stepBack(): ExecutionStep | null {
        if (this.canStepBack()) {
            this.state.currentStepIndex--;
            return this.getCurrentStep();
        }
        return null;
    }

    stepForward(): ExecutionStep | null {
        if (this.canStepForward()) {
            this.state.currentStepIndex++;
            return this.getCurrentStep();
        }
        return null;
    }

    goToStep(index: number): ExecutionStep | null {
        if (index >= 0 && index < this.state.steps.length) {
            this.state.currentStepIndex = index;
            return this.getCurrentStep();
        }
        return null;
    }

    getCurrentStep(): ExecutionStep | null {
        if (this.state.currentStepIndex >= 0 && this.state.currentStepIndex < this.state.steps.length) {
            return this.state.steps[this.state.currentStepIndex];
        }
        return null;
    }

    getAllSteps(): ExecutionStep[] {
        return [...this.state.steps];
    }

    getCurrentStepIndex(): number {
        return this.state.currentStepIndex;
    }

    // Clear history
    clearHistory(): void {
        this.state.steps = [];
        this.state.currentStepIndex = -1;
        this.previousContext = null;
    }

    // Get variables that changed in a specific step
    getChangedVariables(stepIndex: number): VariableSnapshot[] {
        const step = this.state.steps[stepIndex];
        return step ? step.variableStates.filter(v => v.changed) : [];
    }

    // Get the history of a specific variable
    getVariableHistory(variableName: string): Array<{step: ExecutionStep, value: any}> {
        const history: Array<{step: ExecutionStep, value: any}> = [];
        
        this.state.steps.forEach(step => {
            const variable = step.variableStates.find(v => v.name === variableName);
            if (variable) {
                history.push({ step, value: variable.value });
            }
        });

        return history;
    }

    // Utility methods
    private generateStepId(): string {
        return `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private getValueType(value: any): string {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        if (Array.isArray(value)) return 'array';
        return typeof value;
    }

    private deepClone(obj: any): any {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }
        
        if (obj instanceof Date) {
            return new Date(obj.getTime());
        }
        
        if (Array.isArray(obj)) {
            return obj.map(item => this.deepClone(item));
        }
        
        const cloned: any = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                cloned[key] = this.deepClone(obj[key]);
            }
        }
        
        return cloned;
    }

    private deepEqual(a: any, b: any): boolean {
        if (a === b) return true;
        
        if (a === null || b === null || a === undefined || b === undefined) {
            return a === b;
        }
        
        if (typeof a !== typeof b) return false;
        
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (!this.deepEqual(a[i], b[i])) return false;
            }
            return true;
        }
        
        if (typeof a === 'object') {
            const keysA = Object.keys(a);
            const keysB = Object.keys(b);
            
            if (keysA.length !== keysB.length) return false;
            
            for (const key of keysA) {
                if (!keysB.includes(key)) return false;
                if (!this.deepEqual(a[key], b[key])) return false;
            }
            return true;
        }
        
        return false;
    }
}