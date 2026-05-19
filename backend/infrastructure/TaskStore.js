const fs = require('fs');
const path = require('path');

const TASK_HISTORY_FILE = path.join(__dirname, '../../task-history.json');
const TASK_HISTORY_JSONL_FILE = path.join(__dirname, '../../task-history.jsonl');
const MAX_TASKS = 100;
const MAX_EVENTS_PER_TASK = 250;

class TaskStore {
    constructor() {
        this.tasks = new Map();
        this.load();
    }

    load() {
        if (fs.existsSync(TASK_HISTORY_JSONL_FILE)) {
            try {
                const tasks = fs.readFileSync(TASK_HISTORY_JSONL_FILE, 'utf8')
                    .split('\n')
                    .filter(Boolean)
                    .map((line) => JSON.parse(line));
                this.tasks = new Map(tasks.map((task) => [task.taskId, this.trimTask(task)]));
                this.prune();
                return;
            } catch (err) {
                console.error('[TaskStore] Failed to load append-only task history:', err.message);
                this.tasks = new Map();
            }
        }

        if (!fs.existsSync(TASK_HISTORY_FILE)) return;

        try {
            const parsed = JSON.parse(fs.readFileSync(TASK_HISTORY_FILE, 'utf8'));
            const tasks = Array.isArray(parsed) ? parsed : [];
            this.tasks = new Map(tasks.map((task) => [task.taskId, this.trimTask(task)]));
        } catch (err) {
            console.error('[TaskStore] Failed to load task history:', err.message);
            this.tasks = new Map();
        }
    }

    save() {
        const tasks = this.list();
        fs.writeFileSync(TASK_HISTORY_FILE, JSON.stringify(tasks.slice(0, MAX_TASKS), null, 2));
    }

    append(task) {
        fs.appendFileSync(TASK_HISTORY_JSONL_FILE, `${JSON.stringify(task)}\n`);
    }

    list() {
        return Array.from(this.tasks.values()).sort((a, b) => {
            const left = a.updatedAt || a.createdAt || '';
            const right = b.updatedAt || b.createdAt || '';
            return right.localeCompare(left);
        });
    }

    get(taskId) {
        return this.tasks.get(taskId);
    }

    upsert(taskId, patch) {
        const current = this.tasks.get(taskId) || {};
        const task = this.trimTask({
            ...current,
            ...patch,
            taskId,
            updatedAt: new Date().toISOString()
        });

        this.tasks.set(taskId, task);
        this.prune();
        this.append(task);
        this.save();
        return task;
    }

    clear() {
        this.tasks.clear();
        fs.writeFileSync(TASK_HISTORY_JSONL_FILE, '');
        this.save();
    }

    prune() {
        const ordered = this.list();
        this.tasks = new Map(ordered.slice(0, MAX_TASKS).map((task) => [task.taskId, task]));
    }

    trimTask(task) {
        return {
            ...task,
            events: Array.isArray(task.events) ? task.events.slice(-MAX_EVENTS_PER_TASK) : []
        };
    }
}

module.exports = new TaskStore();
