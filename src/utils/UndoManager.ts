/**
 * Simple undo/redo manager that stores snapshots of Float32Array data (heightmap).
 */
export class UndoManager {
    private stack: Float32Array[] = [];
    private pointer = -1;
    private maxSteps: number;

    constructor(maxSteps = 50) {
        this.maxSteps = maxSteps;
    }

    /** Push a new snapshot (cloned). */
    push(data: Float32Array) {
        // Remove any redo history after current pointer
        this.stack = this.stack.slice(0, this.pointer + 1);
        this.stack.push(new Float32Array(data));
        if (this.stack.length > this.maxSteps) {
            this.stack.shift();
        }
        this.pointer = this.stack.length - 1;
    }

    /** Undo — return previous snapshot or null. */
    undo(): Float32Array | null {
        if (this.pointer <= 0) return null;
        this.pointer--;
        return new Float32Array(this.stack[this.pointer]);
    }

    /** Redo — return next snapshot or null. */
    redo(): Float32Array | null {
        if (this.pointer >= this.stack.length - 1) return null;
        this.pointer++;
        return new Float32Array(this.stack[this.pointer]);
    }

    get canUndo(): boolean {
        return this.pointer > 0;
    }

    get canRedo(): boolean {
        return this.pointer < this.stack.length - 1;
    }

    clear() {
        this.stack = [];
        this.pointer = -1;
    }
}
